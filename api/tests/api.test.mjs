/** ネットワークAIを呼ばず、認証・公開契約・写真処理・費用上限を検証する。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createApp } from '../src/app.mjs';
import { loadConfig } from '../src/config.mjs';
import { normalizeDecision, OpenAIAdapter } from '../src/openai-adapter.mjs';
import { generateTextChallenge } from '../src/text-agent.mjs';

const TOKEN = 'test-service-token-0000000000000000000000';
const result = { title: '赤いマグカップ', description: '赤い実物を探そう', criteria: ['マグカップである', '赤い部分がある'], durationSeconds: 120 };

/** 使い捨てHTTPサーバーをloopbackで立て、必ず終了する。 */
async function fixture(t, options = {}) {
  const ai = options.ai || { available: true, generate: async () => result, judge: async () => ({ outcome: 'pass' }) };
  const server = createServer(createApp({ ai, token: TOKEN, ...options }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  /** サービス認証を付けてテスト対象ルートを呼ぶ。 */
  const call = (path, init = {}) => fetch(base + path, { ...init, headers: { authorization: `Bearer ${TOKEN}`, ...init.headers } });
  /** 公開契約でお題を生成する。 */
  const generate = (body = { requestId: randomUUID(), context: {} }) => call('/api/v1/ai/challenges', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { base, call, generate };
}

/** JPEGをmultipart形式へ組み立てる。 */
function multipart(challengeId, bytes, type = 'image/jpeg') {
  const data = new FormData();
  data.set('challengeId', challengeId);
  if (bytes) data.set('photo', new Blob([bytes], { type }), 'photo.jpg');
  return data;
}

test('healthは秘密を含まず未認証で利用でき、AIルートは認証を要求する', async t => {
  const { base } = await fixture(t);
  assert.deepEqual(await (await fetch(base + '/health')).json(), { service: 'karimono-ai', configured: true });
  const response = await fetch(base + '/api/v1/ai/challenges', { method: 'POST' });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'UNAUTHORIZED');
});

test('キーがなくても起動でき、お題は固定503を返す', async t => {
  const { base, generate } = await fixture(t, { ai: { available: false } });
  assert.equal((await (await fetch(base + '/health')).json()).configured, false);
  const response = await generate();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'NOT_CONFIGURED');
});

test('トークン未設定ではAI呼出しを許可しない', async t => {
  const { base, generate } = await fixture(t, { token: undefined });
  assert.equal((await (await fetch(base + '/health')).json()).configured, false);
  assert.equal((await generate()).status, 401);
});

test('クロスオリジン・偽Hostを拒否しCORSを公開しない', async t => {
  const { base, call } = await fixture(t);
  const response = await call('/health', { headers: { origin: 'https://example.org' } });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  const status = await new Promise((resolve, reject) => {
    const req = request(base + '/health', { headers: { host: 'rebind.example.org' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(status, 403);
});

test('不正なUUID・履歴・人数・追加フィールド・JSONを拒否する', async t => {
  const { generate, call } = await fixture(t);
  for (const body of [null, {}, { requestId: 'invalid' }, { requestId: randomUUID(), context: { history: [{}] } },
    { requestId: randomUUID(), context: { playerCount: 101 } }, { requestId: randomUUID(), token: 'ignored' }]) {
    assert.equal((await generate(body)).status, 400);
  }
  assert.equal((await call('/api/v1/ai/challenges', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await generate({ requestId: randomUUID(), context: { history: ['x'.repeat(9000)] } })).status, 413);
});

test('お題公開契約と同一requestId再送の冪等性を守る', async t => {
  let calls = 0;
  const { generate } = await fixture(t, { ai: { available: true, generate: async () => { calls++; return { ...result, apiKey: 'DO_NOT_LEAK' }; } } });
  const body = { requestId: randomUUID(), context: { playerCount: 2, history: ['ペン'] } };
  const first = await generate(body), a = await first.json();
  assert.equal(first.status, 201);
  assert.match(a.data.challengeId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(a.data.criteria, result.criteria);
  assert.equal(a.data.apiKey, undefined);
  assert.equal(Number.isNaN(Date.parse(a.serverTime)), false);
  const second = await generate(body);
  assert.equal(second.status, 200);
  assert.deepEqual((await second.json()).data, a.data);
  assert.equal(calls, 1);
  assert.equal((await generate({ ...body, context: {} })).status, 409);
});

test('認証された参考写真の取得と20分の破棄を確認する', async t => {
  let time = Date.now();
  const bytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'red' } }).jpeg().toBuffer();
  const { generate, call, base } = await fixture(t, { now: () => time, ai: { available: true, generate: async () => ({ ...result,
    reference: { author: 'Author', license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Example.jpg' },
    referenceAsset: { bytes, mime: 'image/jpeg' },
  }) } });
  const data = (await (await generate()).json()).data;
  assert.equal(data.reference.author, 'Author');
  assert.equal((await fetch(base + data.reference.url)).status, 401);
  const image = await call(data.reference.url);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), bytes);
  time += 20 * 60 * 1000;
  assert.equal((await call(data.reference.url)).status, 404);
});

test('正常なJPEGを正規化して判定し、得点やSDK内部値を返さない', async t => {
  let received;
  const { generate, call } = await fixture(t, { ai: { available: true, generate: async () => result,
    judge: async (_challenge, photo) => { received = await sharp(photo).metadata(); return { outcome: 'pass', score: 999, secret: 'DO_NOT_LEAK' }; } } });
  const id = (await (await generate()).json()).data.challengeId;
  const bytes = await sharp({ create: { width: 1200, height: 600, channels: 3, background: 'red' } }).jpeg().toBuffer();
  const response = await call('/api/v1/ai/judgments', { method: 'POST', body: multipart(id, bytes) });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, { outcome: 'pass', reasonCode: 'CRITERIA_MET', provider: 'Decisions API' });
  assert.equal(received.width, 960);
  assert.equal(received.exif, undefined);
});

test('欠損・偽装・壊れたJPEG・2MiB超えの写真はAIへ渡さない', async t => {
  let judged = 0;
  const { generate, call } = await fixture(t, { ai: { available: true, generate: async () => result, judge: async () => { judged++; } } });
  const id = (await (await generate()).json()).data.challengeId;
  const valid = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'blue' } }).jpeg().toBuffer();
  for (const body of [multipart(id), multipart(id, new Uint8Array([1, 2, 3, 4])), multipart(id, valid, 'image/png'), multipart(id, new Uint8Array([255, 216, 1, 1, 255, 217]))]) {
    assert.equal((await call('/api/v1/ai/judgments', { method: 'POST', body })).status, 400);
  }
  assert.equal((await call('/api/v1/ai/judgments', { method: 'POST', body: multipart(id, Buffer.alloc(2 * 1024 * 1024 + 1)) })).status, 413);
  assert.equal(judged, 0);
});

test('生成ロックが並行した有料呼出しを防ぐ', async t => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const { generate } = await fixture(t, { ai: { available: true, generate: async () => { entered(); await pending; return result; } } });
  const first = generate();
  await ready;
  assert.equal((await generate()).status, 409);
  release();
  assert.equal((await first).status, 201);
});

test('生成上限20件を超えると追加の有料呼出しを防ぐ', async t => {
  let calls = 0;
  const { generate } = await fixture(t, { ai: { available: true, generate: async () => { calls++; return result; } } });
  for (let i = 0; i < 20; i++) assert.equal((await generate()).status, 201);
  assert.equal((await generate()).status, 429);
  assert.equal(calls, 20);
});

test('SDK例外と不正上流レスポンスを固定エラーへ変換する', async t => {
  const events = [];
  const { generate } = await fixture(t, { onFailure: event => events.push(event), ai: { available: true, generate: async () => { throw Error('DO_NOT_LEAK sk-proj-secret'); } } });
  const response = await generate();
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /DO_NOT_LEAK|sk-proj/);
  assert.deepEqual(events, [{ operation: 'generate', code: 'UPSTREAM_FAILED' }]);
});

test('Decisionsの拒否・欠損は技術エラー、中間確率はuncertainとして区別する', () => {
  const questions = [{ name: 'a' }, { name: 'b' }];
  /** 指定確率の回答を生成する。 */
  const decision = (...values) => ({ answers: values.map((probability, index) => ({ type: 'predicate', name: questions[index].name, probability })) });
  assert.equal(normalizeDecision(questions, decision(.9, .95)).outcome, 'pass');
  assert.equal(normalizeDecision(questions, decision(.1, .9)).outcome, 'fail');
  assert.equal(normalizeDecision(questions, decision(.6, .9)).outcome, 'uncertain');
  assert.throws(() => normalizeDecision(questions, decision(.9)), /decision_unavailable/);
  assert.throws(() => normalizeDecision(questions, { answers: [{ name: 'a', type: 'refusal' }] }), /decision_unavailable/);
});

test('Decisionsアダプターが見本と提出を順序付きで送信し15秒・自動再試行なしを指定する', async () => {
  let sent, requestOptions;
  const client = { decisions: { create: async (body, options) => {
    sent = body; requestOptions = options;
    return { answers: body.questions.map(question => ({ name: question.name, type: 'predicate', probability: .95 })) };
  } } };
  const adapter = new OpenAIAdapter({}, client);
  const photo = new Uint8Array([255, 216, 255, 217]);
  const judged = await adapter.judge({ ...result, referenceAsset: { bytes: photo, mime: 'image/jpeg' } }, photo);
  assert.equal(judged.outcome, 'pass');
  assert.equal(sent.input[0].content.filter(part => part.type === 'input_image').length, 2);
  assert.equal(sent.questions.length, 4);
  assert.deepEqual(requestOptions, { timeout: 15000, maxRetries: 0 });
});

test('キーの明示的なファイルと引用dotenvを読み、兄弟フォルダへフォールバックしない', () => {
  const folder = mkdtempSync(join(tmpdir(), 'karimono-config-'));
  try {
    const keyFile = join(folder, 'key.env'), tokenFile = join(folder, 'token');
    writeFileSync(keyFile, 'export OPENAI_API_KEY="test-not-real-key"\nOTHER="ignored"\n');
    writeFileSync(tokenFile, TOKEN + '\n');
    const config = loadConfig({ OPENAI_KEY_FILE: keyFile, API_SERVICE_TOKEN_FILE: tokenFile });
    assert.equal(config.apiKey, 'test-not-real-key');
    assert.equal(config.token, TOKEN);
    assert.equal(loadConfig({}).apiKey, undefined);
    assert.equal(loadConfig({ OPENAI_API_KEY: 'explicit', OPENAI_KEY_FILE: keyFile }).apiKey, 'explicit');
    assert.equal(loadConfig({ API_SERVICE_TOKEN: 'short' }).token, undefined);
    assert.equal(loadConfig({}).referencePhotos, false);
    assert.equal(loadConfig({ AI_REFERENCE_PHOTOS: 'true' }).referencePhotos, true);
    assert.equal(loadConfig({ AI_REFERENCE_PHOTOS: 'false' }).referencePhotos, false);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('既定のResponses生成は厳格スキーマと保存なしを指定し、お題だけを返す', async () => {
  const calls = [];
  const client = { responses: { create: async (body, options) => {
    calls.push({ body, options });
    return { status: 'completed', output_text: JSON.stringify(result), output: [] };
  } } };
  const adapter = new OpenAIAdapter({}, client);
  const generated = await adapter.generate({ history: [], playerCount: 2 });
  assert.deepEqual(generated.criteria, result.criteria);
  assert.equal(generated.reference, undefined);
  assert.equal(generated.provider, 'Responses API');
  assert.equal(calls[0].body.text.format.type, 'json_schema');
  assert.equal(calls[0].body.text.format.strict, true);
  assert.equal(calls[0].body.store, false);
  assert.equal(calls[0].body.max_output_tokens, 2048);
  assert.equal(calls[0].options.maxRetries, 0);
  assert.equal(calls[0].options.timeout, 20000);
});

test('Responsesの失敗・未完了・拒否は固定エラーになり、プリセットで置き換えない', async () => {
  for (const response of [{ status: 'failed' }, { status: 'incomplete', output_text: '{}' },
    { status: 'completed', output_text: JSON.stringify(result), output: [{ content: [{ type: 'refusal' }] }] }]) {
    const client = { responses: { create: async () => response } };
    await assert.rejects(generateTextChallenge(client, {}), /text_response_incomplete/);
  }
  const client = { responses: { create: async () => { throw Object.assign(new Error('DO_NOT_LEAK'), { status: 403 }); } } };
  await assert.rejects(generateTextChallenge(client, {}), /^Error: text_response_http_403$/);
});

test('ResponsesのJSON・型・条件・時間の異常を拒否し、生の応答を返さない', async () => {
  for (const output_text of ['not-json', '{}', JSON.stringify({ ...result, criteria: ['one'] }),
    JSON.stringify({ ...result, durationSeconds: 10 })]) {
    const client = { responses: { create: async () => ({ status: 'completed', output_text }) } };
    await assert.rejects(generateTextChallenge(client, {}), /text_response_(?:failed|invalid_challenge)/);
  }
});
