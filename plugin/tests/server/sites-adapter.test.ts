/** 実通信を行わずSitesのCookie分離・実AIモード・現行ラウンド操作を検証する。 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SitesHostAdapter } from '../../src/server/sites-adapter.js';
import { readHostState } from '../../src/ui/bridge.js';

const roomId = '11111111111111111111111111111111';
const cookieToken = 'private-cookie-token-never-shown-111111111111111111111111';
const gateToken = 'private-gate-token-never-shown-11111111111111111111111111';
const baseUrl = 'https://karimono.example';

/** 現Sites実装の集計DTOを模し、未知の秘密フィールドも置いて除外を検証する。 */
function cloudFixture() {
  return {
    room: { id: roomId, name: 'テスト会場' }, isHost: true, mode: 'demo', aiAvailable: true,
    serverTime: Date.parse('2026-10-18T00:00:00Z'), generating: false, preparing: false, prepared: false, preparationError: null,
    lobby: { deadline: null as number | null, startedAt: null as number | null, status: 'empty' },
    players: [] as Array<{ id: string; name: string }>, ranks: [] as Array<{ id: string; name: string; wins: number; totalMs: number }>,
    round: null as null | { id: string; number: number; mode: string; status: string; challenge: { title: string; description: string }; startedAt: number; endsAt: number },
    stats: { pending: 0 }, privateToken: cookieToken,
  };
}

/** モックAPIで認証ヘッダーとルートの呼び出しを記録する。 */
function mockService() {
  const cloud = cloudFixture();
  const calls: Array<{ path: string; init: RequestInit }> = [];
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, init: init! });
    assert.equal(init!.redirect, 'error');
    assert.ok(init!.signal);
    if (path === '/api/rooms') {
      assert.equal(init!.method, 'POST');
      assert.deepEqual(JSON.parse(String(init!.body)), { name: 'カリモノ / ONE LEASE' });
      return Response.json({ id: roomId, joinUrl: 'https://malicious.example/join', hostToken: cookieToken }, { status: 201, headers: { 'set-cookie': `host_${roomId}=${cookieToken}; Path=/api/rooms/${roomId}; HttpOnly; Secure; SameSite=Strict` } });
    }
    assert.equal((init!.headers as Record<string, string>).Cookie, `host_${roomId}=${cookieToken}`);
    assert.equal((init!.headers as Record<string, string>).Authorization, undefined);
    if (path.endsWith('/state')) return Response.json(cloud);
    if (path.endsWith('/host/mode')) { cloud.mode = JSON.parse(String(init!.body)).mode; return Response.json({ ok: true }); }
    if (path.endsWith('/host/prepare')) { cloud.prepared = true; return Response.json({ prepared: true }, { status: 202 }); }
    if (path.endsWith('/host/start-now') || path.endsWith('/host/start')) {
      cloud.round = { id: `round-${(cloud.round?.number ?? 0) + 1}`, number: (cloud.round?.number ?? 0) + 1, mode: cloud.mode, status: 'active', challenge: { title: '赤くて丸いもの', description: '会場内で撮影してください。' }, startedAt: cloud.serverTime, endsAt: cloud.serverTime + 120000 };
      cloud.prepared = false;
      return Response.json({ ok: true });
    }
    if (path.endsWith('/host/end')) { cloud.round!.status = 'closed'; return Response.json({ ok: true }); }
    throw new Error(`unexpected ${path}`);
  };
  return { cloud, calls, fetch };
}

test('Sites mode validates configuration and performs no network on initial open', async () => {
  let calls = 0;
  const fetch: typeof globalThis.fetch = async () => { calls++; throw new Error('must not fetch'); };
  for (const url of ['http://remote.example', 'https://user:secret@example.com', 'https://example.com/?token=secret', 'https://example.com/#secret', 'https://example.com/subpath']) {
    const adapter = new SitesHostAdapter({ baseUrl: url, fetch });
    await assert.rejects(adapter.execute('open', {}), /URL/);
  }
  const initial = await new SitesHostAdapter({ baseUrl, fetch }).execute('open', {});
  assert.equal(initial.mode, 'sites');
  assert.equal(initial.snapshot, null);
  assert.equal(calls, 0);
});

test('Sites creates a room, keeps HttpOnly cookie server-side and separates private gate auth', async () => {
  const mock = mockService();
  const directory = await mkdtemp(join(tmpdir(), 'karimono-site-test-'));
  const tokenFile = join(directory, 'service-token');
  try {
    await writeFile(tokenFile, gateToken);
    const adapter = new SitesHostAdapter({ baseUrl, accessTokenFile: tokenFile, fetch: mock.fetch });
    const operationId = randomUUID();
    const created = await adapter.execute('create_room', { operationId });
    assert.equal(created.mode, 'sites');
    assert.equal(created.snapshot!.sites!.gameMode, 'ai');
    assert.equal(created.snapshot!.room.joinUrl, `${baseUrl}/rooms/${roomId}/join`);
    assert.equal(created.snapshot!.room.roundCount, null);
    assert.deepEqual(readHostState({ content: [], structuredContent: created as unknown as Record<string, unknown> }), created);
    for (const call of mock.calls) assert.equal((call.init.headers as Record<string, string>)['OAI-Sites-Authorization'], `Bearer ${gateToken}`);
    const replay = await adapter.execute('create_room', { operationId });
    assert.deepEqual(replay, created);
    assert.equal(mock.calls.filter(call => call.path === '/api/rooms').length, 1);
    assert.doesNotMatch(JSON.stringify(created), /private-cookie|private-gate|malicious|hostToken|Set-Cookie|Cookie/);
    assert.equal((await adapter.execute('open', {})).snapshot!.room.roomId, roomId);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Sites without AI never publishes joinURL or falls back to demo preparation', async () => {
  const mock = mockService(); mock.cloud.aiAvailable = false;
  const adapter = new SitesHostAdapter({ baseUrl, fetch: mock.fetch });
  const created = await adapter.execute('create_room', { operationId: randomUUID() });
  assert.equal(created.snapshot!.room.joinUrl, undefined);
  assert.equal(created.snapshot!.sites!.canStart, false);
  await assert.rejects(adapter.execute('prepare_topics', { roomId, source: 'ai', operationId: randomUUID() }), /AI接続が未設定/);
  assert.equal(mock.calls.some(call => call.path.endsWith('/host/prepare')), false);
  assert.equal(mock.calls.some(call => call.path.endsWith('/host/mode')), false);
});

test('Sites lifecycle maps real wins, permits unlimited later rounds, and ends only current reception', async () => {
  const mock = mockService();
  const adapter = new SitesHostAdapter({ baseUrl, fetch: mock.fetch });
  await adapter.execute('create_room', { operationId: randomUUID() });
  mock.cloud.players.push({ id: 'player1', name: '参加者1' });
  mock.cloud.ranks.push({ id: 'player1', name: '参加者1', wins: 2, totalMs: 8900 });
  let state = await adapter.execute('get_room', { roomId });
  assert.equal(state.snapshot!.room.scoreUnit, 'wins');
  assert.deepEqual(state.snapshot!.room.leaderboard[0], { teamId: 'player1', name: '参加者1', score: 2, rank: 1, totalMs: 8900 });
  assert.equal(state.snapshot!.teams[0]!.lastSeenAt, null);
  assert.equal(state.snapshot!.teams[0]!.latestSubmission, null);
  const preparationId = randomUUID();
  state = await adapter.execute('prepare_topics', { roomId, source: 'ai', operationId: preparationId });
  assert.equal(state.snapshot!.topicsStatus, 'ready');
  await adapter.execute('prepare_topics', { roomId, source: 'ai', operationId: preparationId });
  assert.equal(mock.calls.filter(call => call.path.endsWith('/host/prepare')).length, 1);
  state = await adapter.execute('start', { roomId, expectedVersion: state.snapshot!.room.version, operationId: randomUUID() });
  assert.equal(state.snapshot!.room.currentRound!.status, 'active');
  mock.cloud.round!.status = 'closed'; mock.cloud.stats.pending = 1;
  state = await adapter.execute('get_room', { roomId });
  assert.equal(state.snapshot!.room.currentRound!.status, 'closing');
  assert.equal(state.snapshot!.sites!.canAdvance, false);
  mock.cloud.stats.pending = 0;
  state = await adapter.execute('get_room', { roomId });
  assert.equal(state.snapshot!.sites!.canAdvance, true);
  state = await adapter.execute('advance', { roomId, expectedVersion: state.snapshot!.room.version, operationId: randomUUID() });
  assert.equal(state.snapshot!.room.currentRound!.number, 2);
  state = await adapter.execute('finish', { roomId, expectedVersion: state.snapshot!.room.version, operationId: randomUUID() });
  assert.equal(state.snapshot!.room.status, 'playing');
  assert.equal(state.snapshot!.room.currentRound!.status, 'result');
  assert.match(state.notice, /部屋全体の終了ではありません/);
  await assert.rejects(adapter.execute('purge_images', { roomId, operationId: randomUUID() }), /未実装/);
});

test('Sites rejects stale controls, wrong-room auth and restart restoration', async () => {
  const mock = mockService();
  const adapter = new SitesHostAdapter({ baseUrl, fetch: mock.fetch });
  const created = await adapter.execute('create_room', { operationId: randomUUID() });
  mock.cloud.players.push({ id: 'player1', name: '参加者' });
  await assert.rejects(adapter.execute('start', { roomId, expectedVersion: created.snapshot!.room.version, operationId: randomUUID() }), /状態が変わりました/);
  assert.equal(mock.calls.some(call => call.path.endsWith('/host/start-now')), false);
  await assert.rejects(adapter.execute('get_room', { roomId: 'other-room' }), /このMCPプロセス/);
  await assert.rejects(new SitesHostAdapter({ baseUrl, fetch: mock.fetch }).execute('get_room', { roomId }), /再起動後/);
  mock.cloud.isHost = false;
  await assert.rejects(adapter.execute('get_room', { roomId }), /ホスト状態/);
});

test('Sites failures sanitize raw secrets and never retry uncertain mutations', async () => {
  let calls = 0;
  const adapter = new SitesHostAdapter({ baseUrl, fetch: async () => { calls++; return new Response(`secret:${cookieToken}:${gateToken}`, { status: 403 }); } });
  const operationId = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(adapter.execute('create_room', { operationId }), error => {
    assert.doesNotMatch(String(error), /private-cookie|private-gate/); return true;
  });
  assert.equal(calls, 1);
  const unsafe = new SitesHostAdapter({ baseUrl, fetch: async () => { throw new Error(`network ${cookieToken}`); } });
  await assert.rejects(unsafe.execute('create_room', { operationId: randomUUID() }), error => { assert.doesNotMatch(String(error), /private-cookie/); return true; });
});
