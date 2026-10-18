/** 登録用marketplace・実行バンドル・導入手順を秘密なしの共有用tar.gzへまとめる。 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
const artifacts = path.join(root, 'artifacts');
const source = path.join(artifacts, 'local-marketplace');
const stage = await mkdtemp(path.join(tmpdir(), 'karimono-share-'));
try {
  const folder = path.join(stage, 'karimono-local');
  // sourceに手動追加された.env等も取り込まないよう、共有時にも許可リストを適用する。
  for (const file of [
    '.agents/plugins/marketplace.json', 'INSTALL.md',
    'plugin/plugin.json', 'plugin/mcp.json', 'plugin/README.md', 'plugin/INSTALL.md',
    'plugin/dist/server.mjs', 'plugin/dist/widget.html',
  ]) {
    const destination = path.join(folder, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(source, file), destination);
  }
  await mkdir(artifacts, { recursive: true });
  const name = `karimono-host-share-${version}.tar.gz`;
  const archive = path.join(artifacts, name);
  execFileSync('tar', ['-czf', archive, '-C', stage, 'karimono-local']);
  const hash = createHash('sha256').update(await readFile(archive)).digest('hex');
  await writeFile(`${archive}.sha256`, `${hash}  ${name}\n`);
  console.log(`Share package: ${archive}`);
  console.log(`SHA-256: ${archive}.sha256`);
} finally {
  await rm(stage, { recursive: true, force: true });
}
