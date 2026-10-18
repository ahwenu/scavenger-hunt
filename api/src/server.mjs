/** 秘密値や外部SDKエラーをログに出さず、ローカル専用HTTPサーバーを起動する。 */
import { createServer } from 'node:http';
import { createApp } from './app.mjs';
import { loadConfig } from './config.mjs';
import { OpenAIAdapter } from './openai-adapter.mjs';

const config = loadConfig();
const app = createApp({ ai: new OpenAIAdapter(config), token: config.token,
  onFailure: event => console.error(JSON.stringify({ event: 'ai_failure', ...event })),
});
const server = createServer({ requestTimeout: 15000, headersTimeout: 10000, maxHeaderSize: 16384 }, app);
server.timeout = 45000;
server.listen(config.port, '127.0.0.1', () => {
  console.log(`カリモノ AI API: http://127.0.0.1:${config.port}（${app.locals.configured ? '設定済み' : '未設定'}）`);
});
server.on('error', () => { console.error('APIサーバーを起動できません。ポート設定を確認してください。'); process.exitCode = 1; });

/** 終了シグナルで受付を停止し、処理の停止を最大5秒待つ。 */
function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
