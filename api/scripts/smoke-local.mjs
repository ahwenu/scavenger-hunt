/** 明示実行時だけ実AIを1回生成・任意で1回判定し、秘密なしの結果を保存する。 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

const base = `http://127.0.0.1:${Number(process.env.PORT || 4318)}`;
const token = (process.env.API_SERVICE_TOKEN || (process.env.API_SERVICE_TOKEN_FILE ? await readFile(process.env.API_SERVICE_TOKEN_FILE, 'utf8') : '')).trim();
if (!token) throw new Error('サービス用トークンの設定が必要です。');
const headers = { Authorization: `Bearer ${token}` };
const report = { checkedAt: new Date().toISOString(), health: false, generation: false, judgment: null };
try {
  const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) });
  report.health = health.ok && (await health.json()).configured === true;
  if (!report.health) throw new Error('APIの設定確認に失敗しました。');
  const generated = await fetch(`${base}/api/v1/ai/challenges`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: randomUUID(), context: {} }), signal: AbortSignal.timeout(35000),
  });
  const result = await generated.json();
  if (!generated.ok) throw new Error(`生成失敗: HTTP ${generated.status} / ${result.error?.code || 'UNKNOWN'}`);
  report.generation = true;
  report.challenge = { challengeId: result.data.challengeId, title: result.data.title, criteria: result.data.criteria, hasReference: Boolean(result.data.reference) };
  if (process.env.API_SMOKE_PHOTO_FILE) {
    const photo = await sharp(process.env.API_SMOKE_PHOTO_FILE, { limitInputPixels: 12000000 }).rotate()
      .resize({ width: 960, height: 960, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    const form = new FormData();
    form.set('challengeId', result.data.challengeId);
    form.set('photo', new Blob([photo], { type: 'image/jpeg' }), 'verification.jpg');
    const judged = await fetch(`${base}/api/v1/ai/judgments`, { method: 'POST', headers, body: form, signal: AbortSignal.timeout(20000) });
    const response = await judged.json();
    if (!judged.ok) throw new Error(`判定失敗: HTTP ${judged.status} / ${response.error?.code || 'UNKNOWN'}`);
    if (!['pass', 'fail', 'uncertain'].includes(response.data?.outcome)) throw new Error('判定結果の形式が不正です。');
    report.judgment = { outcome: response.data.outcome, reasonCode: response.data.reasonCode, provider: response.data.provider };
  }
} catch (error) {
  report.error = /^生成失敗: HTTP \d+ \/ [A-Z_]+$|^判定失敗: HTTP \d+ \/ [A-Z_]+$/.test(error.message)
    ? error.message : '実接続の検証を完了できませんでした。';
  process.exitCode = 1;
}
await mkdir('.local', { recursive: true, mode: 0o700 });
await writeFile('.local/verification.json', JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify(report));
