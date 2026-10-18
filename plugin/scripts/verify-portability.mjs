/** 配布物を親ソース・node_modulesのない別パスへ展開し、stdio MCPを確認する。 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
const shared = process.argv.includes('--share');
const archive = path.join(root, 'artifacts', `karimono-host-${shared ? 'share-' : ''}${version}.tar.gz`);
const stage = await mkdtemp(path.join(tmpdir(), 'karimono moved '));
try {
  execFileSync('tar', ['-xzf', archive, '-C', stage]);
  const files = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
  assert(!files.some(name => /node_modules|\.env|preview\.html|src\//.test(name)), '開発用ファイルや秘密設定が含まれています。');
  const runtime = shared ? path.join(stage, 'karimono-local/plugin') : path.join(stage, 'karimono-host');
  if (shared) {
    const checksum = await readFile(`${archive}.sha256`, 'utf8');
    assert.equal(checksum.split(/\s+/)[0], createHash('sha256').update(await readFile(archive)).digest('hex'));
    const catalog = JSON.parse(await readFile(path.join(stage, 'karimono-local/.agents/plugins/marketplace.json'), 'utf8'));
    assert.equal(catalog.name, 'karimono-local');
    assert.equal(catalog.plugins[0].source.path, './plugin');
    assert.equal(catalog.plugins[0].name, 'karimono-host');
    assert((await readFile(path.join(stage, 'karimono-local/INSTALL.md'), 'utf8')).includes('codex plugin add'));
    const allowed = new Set([
      'karimono-local/.agents/plugins/marketplace.json', 'karimono-local/INSTALL.md',
      ...['plugin.json', 'mcp.json', 'README.md', 'INSTALL.md', 'dist/server.mjs', 'dist/widget.html'].map(file => `karimono-local/plugin/${file}`),
    ]);
    assert(files.filter(file => !file.endsWith('/')).every(file => allowed.has(file)), '共有用許可リスト外のファイルがあります。');
  }
  for (const mode of ['unconfigured', 'demo']) {
    const client = new Client({ name: 'karimono-portability-check', version });
    const transport = new StdioClientTransport({
      command: process.execPath,
      // 実行cwdも元ソースから分離し、空白を含むパスから起動する。
      args: [path.join(runtime, 'dist', 'server.mjs')],
      cwd: stage,
      env: { PATH: process.env.PATH ?? '', KARIMONO_MODE: mode },
    });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      assert.equal(tools.tools.length, 11);
      const resource = await client.readResource({ uri: 'ui://scavenger-hunt/host-v0.3.1' });
      assert.match(resource.contents[0].text, /カリモノ/);
      const opened = await client.callTool({ name: 'host_open', arguments: {} });
      assert.equal(opened.structuredContent.mode, mode);
      const created = await client.callTool({ name: 'host_create_room', arguments: { operationId: crypto.randomUUID() } });
      if (mode === 'unconfigured') {
        assert.equal(created.isError, true);
        assert.match(created.content[0].text, /NOT_CONFIGURED/);
      } else {
        assert.equal(created.structuredContent.snapshot.room.status, 'lobby');
      }
    } finally { await client.close(); }
  }
  console.log(`${shared ? 'Share archive (marketplace + guide + checksum)' : 'Portable archive'} verified: moved path, unrelated cwd, no node_modules, both modes, 11 MCP tools + UI.`);
} finally { await rm(stage, { recursive: true, force: true }); }
