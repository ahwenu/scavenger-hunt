/** 設定と自己完結バンドルだけを許可リストで配布アーカイブにする。 */
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
const stage = await mkdtemp(path.join(tmpdir(), 'karimono-package-'));
const artifacts = path.join(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
try {
  const folder = path.join(stage, 'karimono-host');
  await mkdir(path.join(folder, 'dist'), { recursive: true });
  for (const name of ['plugin.json', 'mcp.json', 'README.md']) {
    await cp(path.join(root, name), path.join(folder, name));
  }
  for (const name of ['server.mjs', 'widget.html']) {
    await cp(path.join(root, 'dist', name), path.join(folder, 'dist', name));
  }
  const artifact = path.join(artifacts, `karimono-host-${version}.tar.gz`);
  execFileSync('tar', ['-czf', artifact, '-C', stage, 'karimono-host']);
  console.log(`Packaged ${artifact}`);
} finally {
  await rm(stage, { recursive: true, force: true });
}
