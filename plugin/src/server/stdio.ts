/** 配布用stdioエントリ。stdoutはMCP専用にし、エラーはstderrへ送る。 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

try {
  const server = createServer();
  await server.connect(new StdioServerTransport());
} catch {
  console.error('カリモノMCPサーバーの起動に失敗しました。ビルドとKARIMONO_MODEを確認してください。');
  process.exitCode = 1;
}
