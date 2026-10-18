/** 配布物を親ソース・node_modulesのない別パスへ展開し、stdio MCPを確認する。 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
const archive = path.join(root, 'artifacts', `karimono-host-${version}.tar.gz`);
const stage = await mkdtemp(path.join(tmpdir(), 'karimono moved '));
try {
  execFileSync('tar', ['-xzf', archive, '-C', stage]);
  const files = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
  assert(!files.some(name => /node_modules|\.env|preview\.html|src\//.test(name)), '開発用ファイルや秘密設定が含まれています。');
  for (const mode of ['unconfigured', 'demo']) {
    const client = new Client({ name: 'karimono-portability-check', version: '0.1.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      // 実行cwdも元ソースから分離し、空白を含むパスから起動する。
      args: [path.join(stage, 'karimono-host', 'dist', 'server.mjs')],
      cwd: stage,
      env: { PATH: process.env.PATH ?? '', KARIMONO_MODE: mode },
    });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      assert.equal(tools.tools.length, 10);
      const resource = await client.readResource({ uri: 'ui://scavenger-hunt/host-v1' });
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
  console.log('Portable archive verified: moved path, unrelated cwd, no node_modules, both modes, 10 MCP tools + UI.');
} finally { await rm(stage, { recursive: true, force: true }); }
