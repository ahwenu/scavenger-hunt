/** AI API境界の認証・呼び出し回数・秘密値非公開をモック通信だけで検証する。 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AiServiceClient, AiServiceError } from '../../src/server/ai-client.js';
import { createServer } from '../../src/server/server.js';

const serviceToken = 'test-service-token-that-is-not-an-openai-key';
const challenge = {
  data: { challengeId: 'challenge-test', title: '赤くて丸いもの', description: '会場内で探して撮影してください。', criteria: ['赤い', '丸い'], durationSeconds: 120 },
  serverTime: '2026-10-18T00:00:00.000Z',
};

/** JSONの成功レスポンスを作る。 */
function json(data: unknown): Response {
  return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
}

test('AI unconfigured has no network or automatic sibling token lookup', async () => {
  const api = new AiServiceClient({ fetch: async () => { throw new Error('must not fetch'); } });
  assert.deepEqual(await api.status(), { configured: false, available: false, notice: 'AI APIの接続先とサービス用トークンを設定してください。' });
  await assert.rejects(api.generateChallenge(randomUUID()), (error: unknown) => error instanceof AiServiceError && error.code === 'NOT_CONFIGURED');
});

test('AI uses unauthenticated health and exactly one authenticated generation with requestId', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const requestId = randomUUID();
  const api = new AiServiceClient({ baseUrl: 'http://127.0.0.1:4318', token: serviceToken, fetch: async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return calls.length === 1 ? json({ service: 'karimono-ai', configured: true, internalSecret: serviceToken }) : json({ ...challenge, privateToken: serviceToken });
  } });
  const status = await api.status();
  assert.equal(status.available, true);
  assert.equal(calls[0]!.url, 'http://127.0.0.1:4318/health');
  assert.equal(calls[0]!.init.headers, undefined);
  assert.deepEqual(await api.generateChallenge(requestId), challenge);
  assert.equal(calls.length, 2);
  assert.equal(calls[1]!.url, 'http://127.0.0.1:4318/api/v1/ai/challenges');
  assert.deepEqual(calls[1]!.init.headers, { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceToken}` });
  assert.deepEqual(JSON.parse(String(calls[1]!.init.body)), { requestId, context: {} });
  assert.equal(calls[1]!.init.redirect, 'error');
  assert.ok(calls[1]!.init.signal);
  assert.doesNotMatch(JSON.stringify(status), /internalSecret|test-service-token/);
});

test('AI validates URLs and tokens before any network call', async () => {
  for (const baseUrl of ['http://example.com', 'https://user:password@example.com', 'https://example.com/?secret=abc', 'https://example.com/#secret', 'file:///tmp/test', 'not a URL']) {
    let count = 0;
    const api = new AiServiceClient({ baseUrl, token: serviceToken, fetch: async () => { count++; return json(challenge); } });
    await assert.rejects(api.generateChallenge(randomUUID()), (error: unknown) => error instanceof AiServiceError && error.code === 'INVALID_CONFIG');
    assert.equal(count, 0);
  }
  const badToken = new AiServiceClient({ baseUrl: 'https://api.example.com', token: `${serviceToken}\nAuthorization: attack` });
  await assert.rejects(badToken.generateChallenge(randomUUID()), /接続設定/);
});

test('AI reads only explicitly configured service token file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'karimono-ai-token-'));
  const tokenFile = join(directory, 'service-token');
  try {
    await writeFile(tokenFile, `${serviceToken}\n`);
    const api = new AiServiceClient({ baseUrl: 'http://localhost:4318', tokenFile, fetch: async (_url, init) => {
      assert.equal((init!.headers as Record<string, string>).Authorization, `Bearer ${serviceToken}`);
      return json(challenge);
    } });
    assert.deepEqual(await api.generateChallenge(randomUUID()), challenge);
    const missing = new AiServiceClient({ baseUrl: 'http://localhost:4318', tokenFile: join(directory, 'not-found') });
    const status = await missing.status();
    assert.equal(status.available, false);
    assert.doesNotMatch(JSON.stringify(status), /karimono-ai-token-|ENOENT/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('AI failures are sanitized, never retried, and reject non-success before parsing', async () => {
  for (const status of [302, 401, 403, 409, 422, 429, 500, 503]) {
    let count = 0;
    const api = new AiServiceClient({ baseUrl: 'https://api.example.com', token: serviceToken, fetch: async () => {
      count++;
      return new Response(`secret:${serviceToken} upstream=https://secret.example`, { status });
    } });
    await assert.rejects(api.generateChallenge(randomUUID()), (error: unknown) => {
      assert.ok(error instanceof AiServiceError);
      assert.doesNotMatch(String(error), /test-service-token|secret.example/);
      return true;
    });
    assert.equal(count, 1);
  }
  const api = new AiServiceClient({ baseUrl: 'https://api.example.com', token: serviceToken, fetch: async () => { throw new Error(`timeout ${serviceToken}`); } });
  await assert.rejects(api.generateChallenge(randomUUID()), (error: unknown) => error instanceof AiServiceError && error.code === 'UNAVAILABLE' && !String(error).includes(serviceToken));
});

test('AI rejects malformed responses and preserves API not-ready state', async () => {
  const api = new AiServiceClient({ baseUrl: 'https://api.example.com', token: serviceToken, fetch: async url => String(url).endsWith('/health') ? json({ service: 'karimono-ai', configured: false }) : json({ data: { secret: serviceToken } }) });
  assert.equal((await api.status()).available, false);
  await assert.rejects(api.generateChallenge(randomUUID()), (error: unknown) => error instanceof AiServiceError && error.code === 'INVALID_RESPONSE');
  const maliciousLink = new AiServiceClient({ baseUrl: 'https://api.example.com', token: serviceToken, fetch: async () => json({ ...challenge, data: { ...challenge.data, reference: { url: 'javascript:alert(1)', author: 'a', licenseName: 'CC0', licenseUrl: 'https://example.com/license', sourcePageUrl: 'https://example.com' } } }) });
  await assert.rejects(maliciousLink.generateChallenge(randomUUID()), /正しい応答/);
  const withReference = { ...challenge, data: { ...challenge.data, reference: { url: '/api/v1/references/reference-test', author: 'Example Author', licenseName: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', sourcePageUrl: 'https://commons.wikimedia.org/wiki/File:Example.jpg' } } };
  const referenceApi = new AiServiceClient({ baseUrl: 'https://api.example.com', token: serviceToken, fetch: async () => json(withReference) });
  assert.deepEqual(await referenceApi.generateChallenge(randomUUID()), withReference);
});

test('AI MCP envelopes do not overwrite demo HostState or expose service credentials', async () => {
  const server = createServer({ mode: 'demo', ai: { baseUrl: 'http://localhost:4318', token: serviceToken, fetch: async url => String(url).endsWith('/health') ? json({ service: 'karimono-ai', configured: true }) : json(challenge) } });
  const client = new Client({ name: 'karimono-ai-tests', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await client.callTool({ name: 'host_create_room', arguments: { operationId: randomUUID() } });
    const before = await client.callTool({ name: 'host_open', arguments: {} });
    const status = await client.callTool({ name: 'ai_status', arguments: {} });
    assert.equal((status.structuredContent as { aiStatus: { available: boolean } }).aiStatus.available, true);
    const generated = await client.callTool({ name: 'ai_generate_challenge', arguments: { requestId: randomUUID() } });
    assert.deepEqual(generated.structuredContent, { aiResult: challenge });
    assert.equal('snapshot' in generated.structuredContent!, false);
    const after = await client.callTool({ name: 'host_open', arguments: {} });
    assert.deepEqual((before.structuredContent as { snapshot: unknown }).snapshot, (after.structuredContent as { snapshot: unknown }).snapshot);
    assert.doesNotMatch(JSON.stringify([status, generated]), /test-service-token/);
    const aiTools = (await client.listTools()).tools.filter(tool => tool.name.startsWith('ai_'));
    for (const tool of aiTools) assert.deepEqual((tool._meta?.ui as { visibility: string[] }).visibility, ['app']);
  } finally {
    await client.close();
    await server.close();
  }
});
