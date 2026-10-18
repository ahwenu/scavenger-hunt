/** 実際のMCPクライアント経由で、未接続・デモ・操作契約を確認する。 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { HostState } from '../../src/shared/contracts.js';
import { createServer, HOST_RESOURCE_URI, type ServerOptions } from '../../src/server/server.js';

/** 移動したHTMLとテスト用時計を注入してMCPセッションを開く。 */
async function session(options: ServerOptions, run: (client: Client) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'karimono-mcp-'));
  const htmlPath = join(directory, 'moved-widget.html');
  await writeFile(htmlPath, '<!doctype html><title>カリモノ test resource</title>');
  const server = createServer({ ...options, htmlPath });
  const client = new Client({ name: 'karimono-tests', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await run(client);
  } finally {
    await client.close();
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
}

/** 成功したツールの安全な状態DTOを取り出す。 */
async function state(client: Client, name: string, args: Record<string, unknown> = {}): Promise<HostState> {
  const response = await client.callTool({ name, arguments: args });
  assert.notEqual(response.isError, true, JSON.stringify(response));
  assert.ok(response.structuredContent);
  return response.structuredContent as unknown as HostState;
}

test('unconfigured serves a portable UI resource and explicitly refuses room creation', async () => {
  await session({ mode: 'unconfigured' }, async client => {
    const capabilities = client.getServerCapabilities();
    assert.ok(capabilities?.tools);
    assert.ok(capabilities?.resources);
    assert.equal(capabilities?.experimental?.['openai/settings'], undefined);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(tool => tool.name).sort(), [
      'host_open', 'host_create_room', 'host_get_room', 'host_prepare_topics',
      'host_start', 'host_advance', 'host_finish', 'host_purge_images', 'host_set_hint',
      'ai_status', 'ai_generate_challenge',
    ].sort());
    const open = tools.tools.find(tool => tool.name === 'host_open')!;
    const hint = tools.tools.find(tool => tool.name === 'host_set_hint')!;
    assert.deepEqual(hint._meta?.ui, { visibility: ['app'] });
    assert.equal(hint.annotations?.readOnlyHint, false);
    assert.deepEqual(open._meta?.['openai/ui'], { entrypoints: [{ type: 'global' }, { type: 'thread' }] });
    const resource = await client.readResource({ uri: HOST_RESOURCE_URI });
    assert.equal(resource.contents[0]?.mimeType, 'text/html;profile=mcp-app');
    const html = resource.contents[0]!;
    assert.ok('text' in html);
    assert.match(html.text, /カリモノ test resource/);
    const initial = await state(client, 'host_open');
    assert.equal(initial.mode, 'unconfigured');
    assert.equal(initial.snapshot, null);
    const mutation = await client.callTool({ name: 'host_create_room', arguments: { operationId: randomUUID() } });
    assert.equal(mutation.isError, true);
    assert.match(JSON.stringify(mutation.structuredContent), /NOT_CONFIGURED/);
    const hintMutation = await client.callTool({ name: 'host_set_hint', arguments: { roomId: 'room', roundId: 'round-1', text: 'ヒント', expectedVersion: 1, operationId: randomUUID() } });
    assert.equal(hintMutation.isError, true);
    assert.match(JSON.stringify(hintMutation.structuredContent), /NOT_CONFIGURED/);
    assert.equal((mutation.structuredContent as unknown as HostState).snapshot, null);
    assert.doesNotMatch(JSON.stringify(mutation), /hostToken|HOST_SERVICE_TOKEN/);
  });
});

test('demo follows create, prepare, start and rejects stale or premature controls', async () => {
  let now = Date.parse('2026-10-18T00:00:00Z');
  await session({ mode: 'demo', now: () => now }, async client => {
    const operationId = randomUUID();
    const created = await state(client, 'host_create_room', { operationId });
    assert.equal(created.mode, 'demo');
    assert.match(created.notice, /サンプル/);
    const roomId = created.snapshot!.room.roomId;
    assert.ok(roomId.startsWith('demo_'));
    assert.equal(created.snapshot!.room.teams.length, 3);
    assert.deepEqual(await state(client, 'host_create_room', { operationId }), created);
    assert.equal(created.snapshot!.topicsStatus, 'empty');
    const hint = await client.callTool({ name: 'host_set_hint', arguments: { roomId, roundId: 'round-1', text: null, expectedVersion: 1, operationId: randomUUID() } });
    assert.equal(hint.isError, true);
    assert.match(JSON.stringify(hint.structuredContent), /UNSUPPORTED_OPERATION/);
    const ai = await client.callTool({ name: 'host_prepare_topics', arguments: { roomId, source: 'ai', operationId: randomUUID() } });
    assert.equal(ai.isError, true);
    assert.match(JSON.stringify(ai.structuredContent), /NOT_CONFIGURED/);
    const prepared = await state(client, 'host_prepare_topics', { roomId, source: 'preset', operationId: randomUUID() });
    assert.equal(prepared.snapshot!.topicsStatus, 'ready');
    const stale = await client.callTool({ name: 'host_start', arguments: { roomId, expectedVersion: 1, operationId: randomUUID() } });
    assert.equal(stale.isError, true);
    assert.match(JSON.stringify(stale.structuredContent), /VERSION_CONFLICT/);
    const startInput = { roomId, expectedVersion: prepared.snapshot!.room.version, operationId: randomUUID() };
    const started = await state(client, 'host_start', startInput);
    assert.equal(started.snapshot!.room.currentRound!.number, 1);
    assert.equal(started.snapshot!.room.currentRound!.status, 'active');
    assert.deepEqual(await state(client, 'host_start', startInput), started);
    const conflict = await client.callTool({ name: 'host_start', arguments: { ...startInput, expectedVersion: 999 } });
    assert.equal(conflict.isError, true);
    assert.match(JSON.stringify(conflict.structuredContent), /IDEMPOTENCY_CONFLICT/);
    const premature = await client.callTool({ name: 'host_advance', arguments: { roomId, expectedVersion: started.snapshot!.room.version, operationId: randomUUID() } });
    assert.equal(premature.isError, true);
    assert.match(JSON.stringify(premature.structuredContent), /INVALID_STATE/);
    now += 15_001;
    const result = await state(client, 'host_get_room', { roomId });
    assert.equal(result.snapshot!.room.currentRound!.status, 'result');
    assert.equal(result.snapshot!.room.leaderboard[0]!.score, 30);
    const advanced = await state(client, 'host_advance', { roomId, expectedVersion: result.snapshot!.room.version, operationId: randomUUID() });
    assert.equal(advanced.snapshot!.room.currentRound!.number, 2);
    now += 15_001;
    const secondResult = await state(client, 'host_get_room', { roomId });
    await state(client, 'host_advance', { roomId, expectedVersion: secondResult.snapshot!.room.version, operationId: randomUUID() });
    now += 15_001;
    const finalResult = await state(client, 'host_get_room', { roomId });
    assert.equal(finalResult.snapshot!.room.currentRound!.number, 3);
    const finalAdvance = await client.callTool({ name: 'host_advance', arguments: { roomId, expectedVersion: finalResult.snapshot!.room.version, operationId: randomUUID() } });
    assert.equal(finalAdvance.isError, true);
    assert.match(JSON.stringify(finalAdvance.structuredContent), /INVALID_STATE/);
    const finished = await state(client, 'host_finish', { roomId, expectedVersion: finalResult.snapshot!.room.version, operationId: randomUUID() });
    assert.equal(finished.snapshot!.room.status, 'finished');
    const purged = await state(client, 'host_purge_images', { roomId, operationId: randomUUID() });
    assert.match(purged.notice, /写真保存には接続せず/);
    const missing = await client.callTool({ name: 'host_get_room', arguments: { roomId: 'someone-elses-room' } });
    assert.equal(missing.isError, true);
    assert.match(JSON.stringify(missing.structuredContent), /ROOM_NOT_FOUND/);
  });
});

test('MCP validates operation IDs and restart discards all demo rooms', async () => {
  let previousRoomId = '';
  await session({ mode: 'demo' }, async client => {
    const invalid = await client.callTool({ name: 'host_create_room', arguments: { operationId: 'not-a-uuid' } });
    assert.equal(invalid.isError, true);
    const created = await state(client, 'host_create_room', { operationId: randomUUID() });
    previousRoomId = created.snapshot!.room.roomId;
  });
  await session({ mode: 'demo' }, async client => {
    assert.equal((await state(client, 'host_open')).snapshot, null);
    const prior = await client.callTool({ name: 'host_get_room', arguments: { roomId: previousRoomId } });
    assert.equal(prior.isError, true);
  });
});
