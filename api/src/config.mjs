/** 明示的な環境設定だけから秘密値を読み、ファイル内容を出力しない。 */
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

/** 設定されたファイルのみを上限付きで読み、失敗時は未設定とする。 */
function readSecretFile(filename) {
  if (!filename) return undefined;
  try {
    const content = readFileSync(filename, { encoding: 'utf8' });
    return Buffer.byteLength(content) <= 65536 ? content : undefined;
  } catch { return undefined; }
}

/** OPENAI_KEY_FILE は dotenv 形式、API_SERVICE_TOKEN_FILE は値だけの形式。 */
export function loadConfig(env = process.env) {
  let apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey && env.OPENAI_KEY_FILE) {
    try { apiKey = parseEnv(readSecretFile(env.OPENAI_KEY_FILE) ?? '').OPENAI_API_KEY?.trim(); }
    catch { apiKey = undefined; }
  }
  const token = (env.API_SERVICE_TOKEN || readSecretFile(env.API_SERVICE_TOKEN_FILE))?.trim();
  const port = Number(env.PORT || 4318);
  return {
    apiKey: apiKey && !/[\r\n]/.test(apiKey) ? apiKey : undefined,
    token: token && token.length >= 32 && token.length <= 512 && !/\s/.test(token) ? token : undefined,
    port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : 4318,
    agentsModel: env.AGENTS_MODEL || 'gpt-6-luna',
    challengeModel: env.CHALLENGE_MODEL || 'gpt-6-luna',
    decisionsModel: env.DECISIONS_MODEL || 'gpt-6-luna',
    referencePhotos: env.AI_REFERENCE_PHOTOS === 'true',
  };
}
