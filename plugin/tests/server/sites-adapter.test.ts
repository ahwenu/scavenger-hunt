/** 実通信を行わずSitesのCookie分離・実AIモード・現行ラウンド操作を検証する。 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
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
    lobby: { deadline: null as number | null, startedAt: null as number | null, status: 'empty', autoStart: false },
    game: undefined as undefined | { status: 'lobby' | 'playing' | 'finished'; totalRounds: number },
    stages: undefined as undefined | Array<{ number: number; status: 'completed' | 'active' | 'locked'; title?: string }>,
    players: [] as Array<{ id: string; name: string }>, ranks: [] as Array<{ id: string; name: string; wins: number; totalMs: number; score?: number; rank?: number }>,
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
      assert.deepEqual(JSON.parse(String(init!.body)), { name: 'カリモノ / ONE LEASE', autoStart: false });
      return Response.json({ id: roomId, joinUrl: 'https://malicious.example/join', hostToken: cookieToken }, { status: 201, headers: { 'set-cookie': `host_${roomId}=${cookieToken}; Path=/api/rooms/${roomId}; HttpOnly; Secure; SameSite=Strict` } });
    }
    assert.equal((init!.headers as Record<string, string>).Cookie, `host_${roomId}=${cookieToken}`);
    assert.equal((init!.headers as Record<string, string>).Authorization, undefined);
    if (path.endsWith('/state')) return Response.json(cloud);
    if (path.endsWith('/host/mode')) { cloud.mode = JSON.parse(String(init!.body)).mode; return Response.json({ ok: true }); }
    if (path.endsWith('/host/prepare')) { cloud.prepared = true; return Response.json({ prepared: true }, { status: 202 }); }
    if (path.endsWith('/host/hint')) {
      const input = JSON.parse(String(init!.body));
      return Response.json({ roundId: input.roundId, text: input.text, available: input.text !== null, privateToken: cookieToken });
    }
    if (path.endsWith('/host/start-now') || path.endsWith('/host/start')) {
      cloud.round = { id: `round-${(cloud.round?.number ?? 0) + 1}`, number: (cloud.round?.number ?? 0) + 1, mode: cloud.mode, status: 'active', challenge: { title: '赤くて丸いもの', description: '会場内で撮影してください。' }, startedAt: cloud.serverTime, endsAt: cloud.serverTime + 120000 };
      cloud.prepared = false;
      return Response.json({ ok: true });
    }
    if (path.endsWith('/host/end')) {
      cloud.round!.status = 'closed';
      if (cloud.game && cloud.round!.number === cloud.game.totalRounds && cloud.stats.pending === 0) cloud.game.status = 'finished';
      return Response.json({ ok: true });
    }
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

test('an invalid environment URL stays a tool error and does not stop the MCP constructor', async () => {
  const previousUrl = process.env.SITES_API_BASE_URL;
  const previousFile = process.env.KARIMONO_HOST_SESSION_FILE;
  try {
    process.env.SITES_API_BASE_URL = 'https://review.example/not-origin';
    delete process.env.KARIMONO_HOST_SESSION_FILE;
    let adapter!: SitesHostAdapter;
    assert.doesNotThrow(() => { adapter = new SitesHostAdapter(); });
    await assert.rejects(adapter.execute('open', {}), /SitesのURL/);
  } finally {
    if (previousUrl === undefined) delete process.env.SITES_API_BASE_URL; else process.env.SITES_API_BASE_URL = previousUrl;
    if (previousFile === undefined) delete process.env.KARIMONO_HOST_SESSION_FILE; else process.env.KARIMONO_HOST_SESSION_FILE = previousFile;
  }
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
  assert.equal(created.snapshot!.sites!.stages, undefined);
    assert.deepEqual(readHostState({ content: [], structuredContent: created as unknown as Record<string, unknown> }), created);
    for (const call of mock.calls) assert.equal((call.init.headers as Record<string, string>)['OAI-Sites-Authorization'], `Bearer ${gateToken}`);
    const replay = await adapter.execute('create_room', { operationId });
    assert.deepEqual(replay, created);
    assert.equal(mock.calls.filter(call => call.path === '/api/rooms').length, 1);
    assert.doesNotMatch(JSON.stringify(created), /private-cookie|private-gate|malicious|hostToken|Set-Cookie|Cookie/);
    assert.equal((await adapter.execute('open', {})).snapshot!.room.roomId, roomId);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Sites keeps an advance invitation on the same room across an adapter restart without exporting host rights', async () => {
  const mock = mockService();
  const directory = await mkdtemp(join(tmpdir(), 'karimono-session-test-'));
  const sessionFile = join(directory, 'state', 'host.json');
  try {
    const first = new SitesHostAdapter({ baseUrl, sessionFile, fetch: mock.fetch });
    const created = await first.execute('create_room', { operationId: randomUUID() });
    assert.equal((await stat(sessionFile)).mode & 0o777, 0o600);
    assert.equal((await stat(join(directory, 'state'))).mode & 0o777, 0o700);
    assert.match(await readFile(sessionFile, 'utf8'), /private-cookie/);
    mock.cloud.players.push({ id: 'player1', name: '事前参加者' });
    const before = mock.calls.length;
    const restored = await new SitesHostAdapter({ baseUrl, sessionFile, fetch: mock.fetch }).execute('open', {});
    assert.equal(restored.snapshot!.room.roomId, created.snapshot!.room.roomId);
    assert.equal(restored.snapshot!.room.joinUrl, created.snapshot!.room.joinUrl);
    assert.equal(restored.snapshot!.room.status, 'lobby');
    assert.equal(restored.snapshot!.room.currentRound, null);
    assert.equal(restored.snapshot!.sites!.automaticLobbyStart, false);
    assert.equal(restored.snapshot!.teams.length, 1);
    assert.deepEqual(mock.calls.slice(before).map(call => call.path), [`/api/rooms/${roomId}/state`]);
    assert.doesNotMatch(JSON.stringify(restored), /private-cookie|host_|Cookie|\.json/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('parallel MCP adapters merge credentials saved after their initial open, including simultaneous writes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'karimono-parallel-session-'));
  const sessionFile = join(directory, 'host.json');
  let sequence = 0;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === '/api/rooms') {
      const id = `parallel-room-${++sequence}`;
      return Response.json({ id }, { headers: { 'set-cookie': `host_${id}=${cookieToken}; HttpOnly; Secure` } });
    }
    const id = path.split('/')[3]!;
    assert.equal((init!.headers as Record<string, string>).Cookie, `host_${id}=${cookieToken}`);
    return Response.json({ ...cloudFixture(), room: { id, name: '並行部屋' }, mode: 'ai' });
  };
  try {
    const adapters = Array.from({ length: 6 }, () => new SitesHostAdapter({ baseUrl, sessionFile, fetch }));
    await Promise.all(adapters.map(adapter => adapter.execute('open', {})));
    const created = [];
    created.push(await adapters[0]!.execute('create_room', { operationId: randomUUID() }));
    created.push(await adapters[1]!.execute('create_room', { operationId: randomUUID() }));
    created.push(...await Promise.all(adapters.slice(2).map(adapter => adapter.execute('create_room', { operationId: randomUUID() }))));
    const restored = new SitesHostAdapter({ baseUrl, sessionFile, fetch });
    for (const state of created) {
      const roomId = state.snapshot!.room.roomId;
      assert.equal((await restored.execute('get_room', { roomId })).snapshot!.room.joinUrl, state.snapshot!.room.joinUrl);
    }
    const saved = JSON.parse(await readFile(sessionFile, 'utf8'));
    assert.equal(saved.rooms.length, 6);
    assert.equal((await stat(sessionFile)).mode & 0o777, 0o600);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Sites refuses broad permissions, symlinks, wrong origins and malformed stored room credentials', async () => {
  const mock = mockService();
  const directory = await mkdtemp(join(tmpdir(), 'karimono-invalid-session-'));
  const sessionFile = join(directory, 'host.json');
  const valid = { format: 1, origin: baseUrl, currentRoomId: roomId, rooms: [{ roomId, cookie: `host_${roomId}=${cookieToken}` }] };
  try {
    const variants = [
      { value: valid, mode: 0o644 },
      { value: { ...valid, origin: 'https://another.example' }, mode: 0o600 },
      { value: { ...valid, rooms: [{ roomId, cookie: `host_other=${cookieToken}` }] }, mode: 0o600 },
      { value: { ...valid, currentRoomId: 'other' }, mode: 0o600 },
    ];
    for (const variant of variants) {
      await writeFile(sessionFile, JSON.stringify(variant.value)); await chmod(sessionFile, variant.mode);
      const before = mock.calls.length;
      const state = await new SitesHostAdapter({ baseUrl, sessionFile, fetch: mock.fetch }).execute('open', {});
      assert.equal(state.snapshot, null); assert.match(state.notice, /安全に復元できません/);
      assert.equal(mock.calls.length, before);
      assert.doesNotMatch(JSON.stringify(state), /private-cookie|host\.json|another\.example/);
    }
    await rm(sessionFile); await writeFile(join(directory, 'target'), JSON.stringify(valid), { mode: 0o600 });
    await symlink(join(directory, 'target'), sessionFile);
    assert.equal((await new SitesHostAdapter({ baseUrl, sessionFile, fetch: mock.fetch }).execute('open', {})).snapshot, null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Sites warns about a failed credential save while keeping the successfully created invitation usable', async () => {
  const mock = mockService();
  const directory = await mkdtemp(join(tmpdir(), 'karimono-write-session-'));
  try {
    const state = await new SitesHostAdapter({ baseUrl, sessionFile: directory, fetch: mock.fetch }).execute('create_room', { operationId: randomUUID() });
    assert.equal(state.snapshot!.room.joinUrl, `${baseUrl}/rooms/${roomId}/join`);
    assert.match(state.notice, /保存できませんでした/);
    assert.doesNotMatch(JSON.stringify(state), /private-cookie|karimono-write-session/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Sites tells an existing automatic lobby apart before its first participant arrives', async () => {
  const mock = mockService(); mock.cloud.lobby.autoStart = true;
  const state = await new SitesHostAdapter({ baseUrl, fetch: mock.fetch }).execute('create_room', { operationId: randomUUID() });
  assert.equal(state.snapshot!.sites!.automaticLobbyStart, true);
  assert.match(state.notice, /既存部屋はSites側の自動開始/);
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

test('Sites new contract preserves server points, ranks and ten-round progress without calculating scores', async () => {
  const mock = mockService();
  mock.cloud.game = { status: 'lobby', totalRounds: 10 };
  mock.cloud.stages = Array.from({ length: 10 }, (_, index) => ({ number: index + 1, status: 'locked' as const, title: '未来の秘密のお題' }));
  const adapter = new SitesHostAdapter({ baseUrl, fetch: mock.fetch });
  const created = await adapter.execute('create_room', { operationId: randomUUID() });
  assert.equal(created.snapshot!.room.status, 'lobby');
  assert.equal(created.snapshot!.room.roundCount, 10);
  assert.equal(created.snapshot!.room.scoreUnit, 'points');
  assert.deepEqual(created.snapshot!.sites!.stages, Array.from({ length: 10 }, (_, index) => ({ number: index + 1, status: 'locked' })));
  assert.doesNotMatch(JSON.stringify(created), /未来の秘密/);
  mock.cloud.game.status = 'playing';
  mock.cloud.stages[0]!.status = 'completed'; mock.cloud.stages[1]!.status = 'active';
  mock.cloud.players.push({ id: 'player1', name: '参加者1' }, { id: 'player2', name: '参加者2' });
  // 応答の配列順や勝数から再計算せず、正本のscore/rankをそのまま採用する。
  mock.cloud.ranks.push(
    { id: 'player1', name: '参加者1', wins: 9, score: 500, rank: 2, totalMs: 8900 },
    { id: 'player2', name: '参加者2', wins: 1, score: 1000, rank: 1, totalMs: 4500 },
  );
  const state = await adapter.execute('get_room', { roomId });
  assert.equal(state.snapshot!.room.status, 'playing');
  assert.deepEqual(state.snapshot!.sites!.stages!.slice(0, 3), [{ number: 1, status: 'completed' }, { number: 2, status: 'active' }, { number: 3, status: 'locked' }]);
  assert.deepEqual(state.snapshot!.room.leaderboard, [
    { teamId: 'player1', name: '参加者1', score: 500, rank: 2, totalMs: 8900 },
    { teamId: 'player2', name: '参加者2', score: 1000, rank: 1, totalMs: 4500 },
  ]);
  assert.match(state.notice, /順位は得点/);
  assert.deepEqual(readHostState({ content: [], structuredContent: state as unknown as Record<string, unknown> }), state);
});

test('Sites final round stays playing while judgments are pending and finishes only when server confirms', async () => {
  const mock = mockService();
  mock.cloud.game = { status: 'playing', totalRounds: 10 };
  mock.cloud.players.push({ id: 'player1', name: '参加者1' });
  mock.cloud.ranks.push({ id: 'player1', name: '参加者1', wins: 1, score: 500, rank: 1, totalMs: 8900 });
  mock.cloud.round = { id: 'round-10', number: 10, mode: 'ai', status: 'active', challenge: { title: '最後のお題', description: '会場内で撮影してください。' }, startedAt: mock.cloud.serverTime, endsAt: mock.cloud.serverTime + 120000 };
  mock.cloud.stats.pending = 1;
  const adapter = new SitesHostAdapter({ baseUrl, fetch: mock.fetch });
  let state = await adapter.execute('create_room', { operationId: randomUUID() });
  state = await adapter.execute('finish', { roomId, expectedVersion: state.snapshot!.room.version, operationId: randomUUID() });
  assert.equal(state.snapshot!.room.status, 'playing');
  assert.equal(state.snapshot!.room.currentRound!.status, 'closing');
  assert.equal(state.snapshot!.sites!.canAdvance, false);
  mock.cloud.stats.pending = 0;
  mock.cloud.game.status = 'finished';
  mock.cloud.stages = Array.from({ length: 10 }, (_, index) => ({ number: index + 1, status: 'completed' }));
  state = await adapter.execute('get_room', { roomId });
  assert.equal(state.snapshot!.room.status, 'finished');
  assert.equal(state.snapshot!.sites!.stages!.length, 10);
  assert.ok(state.snapshot!.sites!.stages!.every(stage => stage.status === 'completed'));
  assert.equal(state.snapshot!.room.currentRound!.status, 'result');
  assert.equal(state.snapshot!.room.roundCount, 10);
  assert.match(state.notice, /全10競技が終了/);
  const controls = state.snapshot!.sites!;
  assert.equal(controls.canPrepare, false);
  assert.equal(controls.canStart, false);
  assert.equal(controls.canAdvance, false);
  assert.equal(controls.canEndRound, false);
  assert.equal(controls.automaticLobbyStart, false);
  const mutationsBefore = mock.calls.filter(call => call.init.method === 'POST').length;
  for (const action of ['prepare_topics', 'start', 'advance', 'finish'] as const) {
    await assert.rejects(adapter.execute(action, { roomId, source: 'ai', expectedVersion: state.snapshot!.room.version, operationId: randomUUID() }), /全競技が終了/);
  }
  assert.equal(mock.calls.filter(call => call.init.method === 'POST').length, mutationsBefore);
});

test('Sites current-round end can observe completed game without invoking a game-wide finish endpoint', async () => {
  const mock = mockService();
  mock.cloud.game = { status: 'playing', totalRounds: 10 };
  mock.cloud.round = { id: 'round-10', number: 10, mode: 'ai', status: 'active', challenge: { title: '最後のお題', description: '会場内で撮影してください。' }, startedAt: mock.cloud.serverTime, endsAt: mock.cloud.serverTime + 120000 };
  const adapter = new SitesHostAdapter({ baseUrl, fetch: mock.fetch });
  let state = await adapter.execute('create_room', { operationId: randomUUID() });
  const before = mock.calls.length;
  state = await adapter.execute('finish', { roomId, expectedVersion: state.snapshot!.room.version, operationId: randomUUID() });
  assert.equal(state.snapshot!.room.status, 'finished');
  assert.match(state.notice, /Sitesで全競技の終了が確認/);
  assert.doesNotMatch(state.notice, /部屋全体の終了ではありません/);
  assert.deepEqual(mock.calls.slice(before).filter(call => call.init.method === 'POST').map(call => call.path), [`/api/rooms/${roomId}/host/end`]);
});

test('Sites rejects stale controls and rooms without a saved host session', async () => {
  const mock = mockService();
  const adapter = new SitesHostAdapter({ baseUrl, fetch: mock.fetch });
  const created = await adapter.execute('create_room', { operationId: randomUUID() });
  mock.cloud.players.push({ id: 'player1', name: '参加者' });
  await assert.rejects(adapter.execute('start', { roomId, expectedVersion: created.snapshot!.room.version, operationId: randomUUID() }), /状態が変わりました/);
  assert.equal(mock.calls.some(call => call.path.endsWith('/host/start-now')), false);
  await assert.rejects(adapter.execute('get_room', { roomId: 'other-room' }), /ホスト権限/);
  await assert.rejects(new SitesHostAdapter({ baseUrl, fetch: mock.fetch }).execute('get_room', { roomId }), /ホスト権限/);
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

test('Sites common hint saves 500 characters and deletes with host cookie, without AI or participant GET', async () => {
  const mock = mockService();
  const adapter = new SitesHostAdapter({ baseUrl, fetch: mock.fetch });
  await adapter.execute('create_room', { operationId: randomUUID() });
  mock.cloud.round = { id: 'round-1', number: 1, mode: 'ai', status: 'active', challenge: { title: 'お題', description: '会場で撮影' }, startedAt: mock.cloud.serverTime, endsAt: mock.cloud.serverTime + 120000 };
  let state = await adapter.execute('get_room', { roomId });
  assert.equal(state.snapshot!.sites!.canSetHint, true);
  assert.equal(state.snapshot!.room.currentRound!.hint, undefined);
  const input = { roomId, roundId: 'round-1', text: 'あ'.repeat(500), expectedVersion: state.snapshot!.room.version, operationId: randomUUID() };
  const before = mock.calls.length;
  state = await adapter.execute('set_hint', input);
  assert.equal(state.snapshot!.room.currentRound!.hint, input.text);
  assert.deepEqual(readHostState({ content: [], structuredContent: state as unknown as Record<string, unknown> }), state);
  assert.doesNotMatch(JSON.stringify(state), /private-cookie|privateToken|Cookie/);
  assert.match(state.notice, /保存しました/);
  assert.deepEqual(mock.calls.slice(before).filter(call => call.init.method === 'POST').map(call => call.path), [`/api/rooms/${roomId}/host/hint`]);
  const posted = mock.calls.find(call => call.path.endsWith('/host/hint'))!;
  assert.deepEqual(JSON.parse(String(posted.init.body)), { roundId: 'round-1', text: input.text });
  assert.equal((posted.init.headers as Record<string, string>).Cookie, `host_${roomId}=${cookieToken}`);
  assert.deepEqual(await adapter.execute('set_hint', input), state);
  assert.equal(mock.calls.filter(call => call.path.endsWith('/host/hint')).length, 1);
  await assert.rejects(adapter.execute('set_hint', { ...input, text: '変更' }), /異なる入力/);
  state = await adapter.execute('set_hint', { roomId, roundId: 'round-1', text: null, expectedVersion: state.snapshot!.room.version, operationId: randomUUID() });
  assert.equal(state.snapshot!.room.currentRound!.hint, null);
  assert.match(state.notice, /削除しました/);
  assert.deepEqual(JSON.parse(String(mock.calls.filter(call => call.path.endsWith('/host/hint'))[1]!.init.body)), { roundId: 'round-1', text: null });
  // 他クライアントで更新されたかのような偽の読取結果を作らず、次競技は未取得へ戻す。
  mock.cloud.round.id = 'round-2';
  state = await adapter.execute('get_room', { roomId });
  assert.equal(state.snapshot!.room.currentRound!.hint, undefined);
  assert.equal(mock.calls.some(call => call.path.endsWith('/hint') && call.init.method === 'GET'), false);
});

test('Sites common hint rejects invalid text, stale round, closed round and expired reception without POST', async () => {
  const mock = mockService();
  const adapter = new SitesHostAdapter({ baseUrl, fetch: mock.fetch });
  await adapter.execute('create_room', { operationId: randomUUID() });
  mock.cloud.round = { id: 'round-1', number: 1, mode: 'ai', status: 'active', challenge: { title: 'お題', description: '会場で撮影' }, startedAt: mock.cloud.serverTime, endsAt: mock.cloud.serverTime + 120000 };
  let state = await adapter.execute('get_room', { roomId });
  for (const text of ['', '   ', 'あ'.repeat(501), undefined]) {
    await assert.rejects(adapter.execute('set_hint', { roomId, roundId: 'round-1', text, expectedVersion: state.snapshot!.room.version, operationId: randomUUID() }), /1〜500文字/);
  }
  await assert.rejects(adapter.execute('set_hint', { roomId, roundId: 'other-round', text: 'ヒント', expectedVersion: state.snapshot!.room.version, operationId: randomUUID() }), /受付中/);
  mock.cloud.round.status = 'closed';
  state = await adapter.execute('get_room', { roomId });
  assert.equal(state.snapshot!.sites!.canSetHint, false);
  await assert.rejects(adapter.execute('set_hint', { roomId, roundId: 'round-1', text: null, expectedVersion: state.snapshot!.room.version, operationId: randomUUID() }), /受付中/);
  mock.cloud.round.status = 'active'; mock.cloud.round.endsAt = mock.cloud.serverTime;
  state = await adapter.execute('get_room', { roomId });
  assert.equal(state.snapshot!.sites!.canSetHint, false);
  await assert.rejects(adapter.execute('set_hint', { roomId, roundId: 'round-1', text: 'ヒント', expectedVersion: state.snapshot!.room.version, operationId: randomUUID() }), /受付中/);
  assert.equal(mock.calls.some(call => call.path.endsWith('/host/hint')), false);
});

test('Sites common hint sanitizes uncertain failures and suppresses retries of the same operation', async () => {
  const mock = mockService();
  let hintPosts = 0;
  const fetch: typeof globalThis.fetch = async (url, init) => {
    if (new URL(String(url)).pathname.endsWith('/host/hint')) {
      hintPosts++;
      return new Response(`private-cookie ${cookieToken}`, { status: 403 });
    }
    return mock.fetch(url, init);
  };
  const adapter = new SitesHostAdapter({ baseUrl, fetch });
  await adapter.execute('create_room', { operationId: randomUUID() });
  mock.cloud.round = { id: 'round-1', number: 1, mode: 'ai', status: 'active', challenge: { title: 'お題', description: '会場で撮影' }, startedAt: mock.cloud.serverTime, endsAt: mock.cloud.serverTime + 120000 };
  const state = await adapter.execute('get_room', { roomId });
  const input = { roomId, roundId: 'round-1', text: 'ヒント', expectedVersion: state.snapshot!.room.version, operationId: randomUUID() };
  for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(adapter.execute('set_hint', input), error => {
    assert.match(String(error), /ホスト認証/); assert.doesNotMatch(String(error), /private-cookie/); return true;
  });
  assert.equal(hintPosts, 1);
  assert.equal((await adapter.execute('get_room', { roomId })).snapshot!.room.currentRound!.hint, undefined);
});
