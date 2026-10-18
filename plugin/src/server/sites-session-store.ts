/** ホスト権限を配布物の外へ保存し、同一Sitesの部屋だけ再起動後に復元する。 */
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';

const id = z.string().regex(/^[a-zA-Z0-9-]{1,200}$/);
const sessionSchema = z.object({
  format: z.literal(1), origin: z.string().url(), currentRoomId: id,
  rooms: z.array(z.object({ roomId: id, cookie: z.string().max(500) })).min(1).max(100),
});
export type SavedSitesSessions = z.infer<typeof sessionSchema>;

/** 接続先ごとに保管先を分け、再インストールしても同じユーザーの権限を使う。 */
export function defaultSitesSessionFile(origin: string): string {
  const key = createHash('sha256').update(origin).digest('hex').slice(0, 24);
  return join(homedir(), '.local', 'state', 'karimono-host', `sites-${key}.json`);
}

/** 他ユーザーが読めるファイル・リンク・異なる接続先の認証情報は取り込まない。 */
export async function loadSitesSessions(file: string, origin: string): Promise<SavedSitesSessions | null> {
  let handle;
  try { handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('session_storage_unavailable'); }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 131072 || stat.mode & 0o077 || typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error();
    const data = sessionSchema.parse(JSON.parse(await handle.readFile('utf8')));
    if (data.origin !== origin || !data.rooms.some(room => room.roomId === data.currentRoomId) || new Set(data.rooms.map(room => room.roomId)).size !== data.rooms.length) throw new Error();
    for (const room of data.rooms) if (!new RegExp(`^host_${room.roomId}=[A-Za-z0-9_-]{32,256}$`).test(room.cookie)) throw new Error();
    return data;
  } catch { throw new Error('session_storage_invalid'); }
  finally { await handle.close(); }
}

/** 終了済みプロセスのマーカーだけを除き、別プロセスが取得し直したロックを消さない。 */
async function clearAbandonedLock(directory: string): Promise<void> {
  try {
    const stat = await lstat(directory);
    if (!stat.isDirectory() || typeof process.getuid === 'function' && stat.uid !== process.getuid()) return;
    const files = await readdir(directory);
    if (!files.length && Date.now() - stat.mtimeMs > 60000) { await rmdir(directory); return; }
    if (files.length !== 1) return;
    const owner = /^owner-(\d+)-[0-9a-f-]{36}$/.exec(files[0]!);
    if (!owner) return;
    try { process.kill(Number(owner[1]), 0); return; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return; }
    await unlink(join(directory, files[0]!));
    await rmdir(directory);
  } catch { /* 消去競合や生きた所有者のロックは取得ループで待つ。 */ }
}

/** 複数MCPからの保存を直列化し、最新ファイルの読込から置換までを一単位にする。 */
async function withSessionLock<T>(file: string, action: () => Promise<T>): Promise<T> {
  const directory = `${file}.lock`;
  const marker = join(directory, `owner-${process.pid}-${randomUUID()}`);
  for (let attempt = 0; attempt < 80; attempt++) {
    try { await mkdir(directory, { mode: 0o700 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new Error('session_storage_unavailable');
      await clearAbandonedLock(directory); await delay(25); continue;
    }
    try {
      await writeFile(marker, '', { flag: 'wx', mode: 0o600 });
      return await action();
    } finally { await rm(marker, { force: true }); await rmdir(directory); }
  }
  throw new Error('session_storage_busy');
}

/** 完成した0600ファイルだけを原子的に置き換え、途中の秘密ファイルを残さない。 */
async function writeSessions(file: string, data: SavedSitesSessions): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(data)); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}

/** 保存直前の最新権限と統合し、並行MCPが作った別部屋の認証を失わせない。 */
export async function saveSitesSessions(file: string, data: SavedSitesSessions): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await withSessionLock(file, async () => {
    const previous = await loadSitesSessions(file, data.origin);
    const rooms = new Map(previous?.rooms.map(room => [room.roomId, room]) ?? []);
    for (const room of data.rooms) rooms.set(room.roomId, room);
    await writeSessions(file, { ...data, rooms: [...rooms.values()].slice(-100) });
  });
}
