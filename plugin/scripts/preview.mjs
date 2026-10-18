/** ループバック限定で、明示した接続モードのMCPを通した開発用UIを配信する。 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const html = await readFile(new URL('../dist/preview.html', import.meta.url));
const mcp = new Client({ name: 'karimono-local-preview', version: '0.4.0' });
const mode = process.env.KARIMONO_MODE || 'demo';
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('../dist/server.mjs', import.meta.url))],
  env: { ...process.env, KARIMONO_MODE: mode },
});
await mcp.connect(transport);
const allowed = new Set(['host_open', 'host_create_room', 'host_get_room', 'host_prepare_topics', 'host_start', 'host_advance', 'host_finish', 'host_set_hint', 'ai_status', 'ai_generate_challenge']);
const server = createServer(async (req, res) => {
  // localhost以外のHost/DNS rebindingと、別オリジンからの操作を拒否する。
  const origin = `http://127.0.0.1:${server.address().port}`;
  if (req.headers.host !== `127.0.0.1:${server.address().port}` || (req.headers.origin && req.headers.origin !== origin)) {
    res.writeHead(403).end(); return;
  }
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html); return;
  }
  if (req.method !== 'POST' || req.url !== '/tool' || req.headers['content-type'] !== 'application/json') {
    res.writeHead(404).end(); return;
  }
  try {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 8192) throw new Error('リクエストが大きすぎます。');
    }
    const input = JSON.parse(body);
    if (!allowed.has(input.name)) throw new Error('未対応の操作です。');
    const result = await mcp.callTool({ name: input.name, arguments: input.arguments ?? {} }, undefined, { timeout: 70000 });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(result));
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ isError: true, content: [{ type: 'text', text: 'プレビュー操作に失敗しました。' }] }));
  }
});
server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => {
  console.log(`開発用プレビュー: http://127.0.0.1:${server.address().port}/ (${mode})`);
});
/** プレビューと子MCPを終了する。 */
async function shutdown() {
  server.close();
  await mcp.close();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
