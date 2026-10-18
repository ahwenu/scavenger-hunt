/** 秘密設定を含めず、公式CLIへ渡すローカル登録用の実行パッケージを作る。 */
import { cp, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = path.join(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
const stage = await mkdtemp(path.join(artifacts, '.marketplace-'));
const destination = path.join(artifacts, 'local-marketplace');
try {
  await mkdir(path.join(stage, 'plugin/dist'), { recursive: true });
  await mkdir(path.join(stage, '.agents/plugins'), { recursive: true });
  for (const file of ['plugin.json', 'mcp.json', 'README.md', 'INSTALL.md', 'dist/server.mjs', 'dist/widget.html']) {
    await cp(path.join(root, file), path.join(stage, 'plugin', file));
  }
  await cp(path.join(root, 'INSTALL.md'), path.join(stage, 'INSTALL.md'));
  const catalog = {
    name: 'karimono-local',
    interface: { displayName: 'カリモノ / ローカル開発' },
    plugins: [{
      name: 'karimono-host', source: { source: 'local', path: './plugin' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity',
    }],
  };
  await writeFile(path.join(stage, '.agents/plugins/marketplace.json'), JSON.stringify(catalog, null, 2) + '\n');
  // このスクリプト専用の生成先だけを置換し、インストール済み設定には触れない。
  await rm(destination, { recursive: true, force: true });
  await rename(stage, destination);
  console.log('Prepared local marketplace (no env files): ' + destination);
} finally {
  await rm(stage, { recursive: true, force: true });
}
