import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import QRCode from 'qrcode';

const base = (process.env.TARGET_BASE_URL || 'https://ai-karimono-race.ahwenu.chatgpt.site').replace(/\/$/, '');
const reportPath = path.resolve(process.env.SMOKE_REPORT || 'docs/public-smoke.json');
const report = { testedAt: new Date().toISOString(), target: base, mode: 'demo', checks: [], errors: [] };
report.authentication = {"platformAuthentication": "none", "platformCookiesSent": false, "sitesBypassUsed": false, "cookieJar": "none (Node fetch)", "anonymousRequests": ["GET /", "POST /api/rooms", "GET /rooms/:id/host", "GET /rooms/:id/join", "GET /api/rooms/:id/qr.png", "POST /api/rooms/:id/join", "GET /api/rooms/:id/state"], "gameHostCookie": "Only the newly created room host cookie is used for host operations and host-scoped state checks", "gameParticipantBearer": "Only newly registered room participant tokens are used for own-photo submissions and own-state synchronization"};
const rooms = [];

/** Make an API request without printing response bodies or credentials on failure. */
async function request(route, { method = 'GET', body, token, cookie, status = 200 } = {}) {
  const response = await fetch(base + route, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal(response.status, status, `${method} ${route}: expected HTTP ${status}, got ${response.status}`);
  return response;
}

/** Save a named successful assertion while omitting secrets from the report. */
function checked(name) { report.checks.push(name); }

/** Create a room using its public API and keep host credentials only in memory. */
async function createRoom(label) {
  const response = await request('/api/rooms', { method: 'POST', body: { name: `公開確認${label} ${new Date().toISOString()}` }, status: 201 });
  const room = await response.json();
  assert.match(room.id, /^[a-zA-Z0-9_-]{20,}$/);
  assert.equal(room.hostUrl, `/rooms/${room.id}/host`);
  assert.equal(room.joinUrl, `${base}/rooms/${room.id}/join`);
  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie?.includes(`host_${room.id}=`) && cookie.includes(`Path=/api/rooms/${room.id}`) && /HttpOnly/i.test(cookie));
  const result = { ...room, api: `/api/rooms/${room.id}`, cookie: cookie.split(';')[0] };
  rooms.push(result);
  return result;
}

/** Register a player directly from a room URL without any hand-entered code. */
async function join(room, name, profile = '') {
  return (await request(`${room.api}/join`, { method: 'POST', body: { name, profile } })).json();
}

/** Verify the rendered PNG encodes this exact room join link using its QR modules. */
async function verifyQR(room) {
  const response = await request(`${room.api}/qr.png?download=1`);
  assert.match(response.headers.get('content-type'), /image\/png/);
  assert.match(response.headers.get('content-disposition'), /attachment/);
  const { data, info } = await sharp(Buffer.from(await response.arrayBuffer())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.ok(info.width >= 200);
  const dark = (x, y) => data[(y * info.width + x) * info.channels] < 128;
  let left = info.width, right = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (dark(x, y)) { left = Math.min(left, x); right = Math.max(right, x); }
  const qr = QRCode.create(room.joinUrl).modules;
  const scale = (right - left + 1) / qr.size;
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) {
    assert.equal(dark(Math.floor(left + (x + 0.5) * scale), Math.floor(left + (y + 0.5) * scale)), Boolean(qr.get(y, x)), 'PNG QR must encode this room join URL');
  }
}

/** Submit a real JPEG payload while retaining HTTP receipt timing separately from judgment. */
async function submit(room, player, roundId, requestId, bytes, expected = 202) {
  const body = new FormData();
  body.set('roundId', roundId);
  body.set('requestId', requestId);
  body.set('demoResult', 'pass');
  body.set('photo', new Blob([bytes], { type: 'image/jpeg' }), 'smoke-photo.jpg');
  const started = performance.now();
  const response = await fetch(`${base}${room.api}/submit`, { method: 'POST', headers: { Authorization: `Bearer ${player.token}` }, body });
  assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status), `Upload expected HTTP ${expected}, got ${response.status}`);
  return { data: await response.json(), receiptHttpMs: Math.round(performance.now() - started) };
}

/** Observe background challenge readiness without exposing its content. */
async function ready(room) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const state = await (await request(`${room.api}/state`, { cookie: room.cookie })).json();
    if (state.prepared) {
      assert.equal(typeof state.prepared, 'boolean');
      assert.equal(state.preparing, false);
      assert.equal(state.round, null, 'Preparation must keep next challenge hidden');
      return state;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Prepared challenge did not become ready');
}

/** Let participant polling alone drive the real persisted 30 second first-round deadline. */
async function automaticStart(room, token, deadline, firstJoinedAt) {
  for (let attempt = 0; attempt < 90; attempt++) {
    const state = await (await request(`${room.api}/state`, { token })).json();
    assert.equal(state.lobby.deadline, deadline, 'Participant reconnects must not reset the lobby countdown');
    if (state.round?.status === 'active') {
      assert.equal(state.lobby.status, 'started');
      assert.ok(state.round.startedAt >= deadline, 'Automatic start must not reveal the challenge before its server deadline');
      report.lobby = { firstJoinedAt, deadline, countdownMs: deadline - firstJoinedAt, startedAt: state.round.startedAt, serverStartLagMs: state.round.startedAt - deadline, observedStartLagMs: Date.now() - deadline, drivenByParticipantPolling: true, hostStartRequestUsed: false };
      return state;
    }
    assert.equal(state.round, null);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('First round did not automatically start after the persisted 30 second lobby');
}

/** Wait for a terminal verdict via authenticated polling instead of unsupported cloud SSE. */
async function settled(room, player, id) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const state = await (await request(`${room.api}/state`, { token: player.token })).json();
    const mine = state.mine.find(s => s.id === id);
    if (mine && ['accepted', 'rejected', 'error'].includes(mine.status) && (mine.status !== 'accepted' || state.events?.some(event => event.submissionId === id))) return { mine, state };
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Photo judgment did not become visible within 60 polling attempts');
}

try {
  await request('/');
  await request('/api/rooms/not-a-room/state', { status: 404 });
  const a = await createRoom('A'), b = await createRoom('B');
  assert.notEqual(a.id, b.id);
  report.roomIds = [a.id, b.id];
  checked('Public room creation returns distinct unguessable IDs, room-specific host and join links, scoped HttpOnly host cookies');
  for (const room of [a, b]) {
    await request(room.hostUrl);
    await request(`/rooms/${room.id}/join`);
    await verifyQR(room);
    const state = await (await request(`${room.api}/state`)).json();
    assert.equal(state.mode, 'demo', 'Refusing smoke uploads outside explicit demo mode');
    assert.equal(state.isHost, false);
    assert.equal(state.lobby.deadline, null, 'Creating a room does not start its clock');
    assert.equal(state.lobby.status, 'empty');
    assert.equal((await (await request(`${room.api}/state`, { cookie: room.cookie })).json()).isHost, true);
  }
  checked('Host/join pages render, exact room URLs are encoded in downloadable PNG QR, host status requires its cookie');
  const alice = await join(a, 'SmokeAlice', '非公開プロフィールA');
  await request(`${a.api}/host/prepare`, { method: 'POST', status: 403 });
  await request(`${a.api}/host/prepare`, { method: 'POST', cookie: b.cookie, status: 403 });
  const firstJoinState = await (await request(`${a.api}/state`, { token: alice.token })).json();
  const firstDeadline = firstJoinState.lobby.deadline;
  assert.ok(Number.isFinite(firstDeadline));
  const firstJoinedAt = firstJoinState.players.find(player => player.id === alice.id).joinedAt;
  assert.equal(firstDeadline - firstJoinedAt, 30000, 'The actual first registration sets exactly a 30 second deadline');
  assert.ok(firstDeadline > firstJoinState.serverTime);
  await ready(a);
  assert.equal((await (await request(`${a.api}/state`, { token: alice.token })).json()).round, null);
  assert.equal((await (await request(`${b.api}/state`)).json()).prepared, false);
  const bob = await join(a, 'SmokeBob');
  const laterJoinState = await (await request(`${a.api}/state`)).json();
  assert.equal(laterJoinState.prepared, true, 'Initial generation context stays frozen while other participants join');
  assert.equal(laterJoinState.lobby.deadline, firstDeadline, 'Second join does not reset the first-join clock');
  const carol = await join(b, 'SmokeCarol', '非公開プロフィールB');
  const bDeadline = (await (await request(`${b.api}/state`)).json()).lobby.deadline;
  await request(`${b.api}/host/extend-lobby`, { method: 'POST', status: 403 });
  await request(`${b.api}/host/start-now`, { method: 'POST', cookie: a.cookie, status: 403 });
  await request(`${b.api}/host/extend-lobby`, { method: 'POST', cookie: b.cookie });
  assert.equal((await (await request(`${b.api}/state`)).json()).lobby.deadline, bDeadline + 10000);
  checked('Room creation alone leaves its clock empty; first join starts the timer, later joins preserve it, and scoped host extension adds exactly ten seconds');
  checked('Direct room join needs name/profile only; no room code input');
  await request(`${b.api}/state`, { token: alice.token, status: 401 });
  await request(`${a.api}/state`, { token: carol.token, status: 401 });
  await request(`${b.api}/submit`, { method: 'POST', token: alice.token, status: 401 });
  await request(`${b.api}/host/end`, { method: 'POST', cookie: a.cookie, status: 403 });
  await request(`${a.api}/host/start`, { method: 'POST', status: 403 });
  checked('Foreign player credentials return401, foreign or absent host credentials return403');
  const stateA = await (await request(`${a.api}/state`)).json();
  const stateB = await (await request(`${b.api}/state`)).json();
  assert.deepEqual(stateA.players.map(p => p.name).sort(), ['SmokeAlice', 'SmokeBob']);
  assert.deepEqual(stateB.players.map(p => p.name), ['SmokeCarol']);
  assert.ok(!JSON.stringify(stateA).includes('非公開プロフィール'));
  for (const player of [alice, bob, carol]) assert.ok(!JSON.stringify(stateA).includes(player.token));
  checked('Room membership, ranks, private profiles and participant tokens remain isolated');
  // Keep the comparison room waiting throughout later network checks as well.
  await request(`${b.api}/host/extend-lobby`, { method: 'POST', cookie: b.cookie });
  assert.equal((await (await request(`${b.api}/state`)).json()).lobby.deadline, bDeadline + 20000);
  const activeA = await automaticStart(a, alice.token, firstDeadline, firstJoinedAt);
  checked('First join automatically prepares a hidden shared challenge with frozen input; participant polling alone starts exactly one first round after the real 30 second deadline');
  assert.equal(activeA.round.mode, 'demo');
  assert.equal(activeA.prepared, false);
  await request(`${a.api}/host/prepare`, { method: 'POST', cookie: a.cookie, status: 409 });
  const unaffectedB = await (await request(`${b.api}/state`)).json();
  assert.equal(unaffectedB.round, null);
  assert.equal(unaffectedB.stats.answered, 0);
  checked('Room A automatic start leaves room B on its independent extended countdown with no challenge or submissions');
  const bytes = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#cf4747' } }).jpeg({ quality: 80 }).toBuffer();
  const receipt = await submit(a, alice, activeA.round.id, 'smoke-alice', bytes);
  assert.equal(receipt.data.status, 'queued');
  assert.ok(Number.isFinite(receipt.data.receivedAt));
  const accepted = await settled(a, alice, receipt.data.id);
  assert.equal(accepted.mine.status, 'accepted');
  assert.equal(accepted.mine.verdict.provider, 'デモ判定');
  assert.equal(accepted.state.ranks[0].name, 'SmokeAlice');
  assert.equal(accepted.state.ranks[0].wins, 1);
  const ownPassEvent = accepted.state.events.find(event => event.submissionId === receipt.data.id);
  assert.ok(ownPassEvent);
  assert.equal(accepted.mine.passEventId, ownPassEvent.id);
  assert.equal(ownPassEvent.rank, 1);
  assert.equal(ownPassEvent.provisional, false);
  const replay = await submit(a, alice, activeA.round.id, 'smoke-alice', bytes, [200, 202]);
  assert.equal(replay.data.id, receipt.data.id);
  assert.equal(replay.data.duplicate, true);
  const afterReplay = await (await request(`${a.api}/state`, { token: alice.token })).json();
  assert.deepEqual(afterReplay.events.map(event => event.id), accepted.state.events.map(event => event.id));
  assert.equal(afterReplay.mine.find(sub => sub.id === receipt.data.id).passEventId, ownPassEvent.id);
  report.passEvent = { id: ownPassEvent.id, rank: ownPassEvent.rank, provisional: ownPassEvent.provisional, stableAcrossReplayAndPolling: true };
  checked('Confirmed demo judgment has one durable own pass event with a stable ID; replay and polling do not create another celebration');
  report.demoUpload = { bytes: bytes.length, receiptHttpMs: receipt.receiptHttpMs, terminalStatus: accepted.mine.status, provider: accepted.mine.verdict.provider };
  checked('Actual JPEG bytes receive HTTP202 queued and become accepted with a visibly labelled demo verdict and ranking via polling');
  await submit(a, bob, activeA.round.id, 'smoke-copied', bytes, 409);
  await request(`${b.api}/host/start-now`, { method: 'POST', cookie: b.cookie });
  const activeB = await (await request(`${b.api}/state`)).json();
  const otherReceipt = await submit(b, carol, activeB.round.id, 'smoke-carol', bytes);
  const otherAccepted = await settled(b, carol, otherReceipt.data.id);
  assert.equal(otherAccepted.mine.status, 'accepted');
  assert.deepEqual(otherAccepted.state.ranks.map(p => p.name), ['SmokeCarol']);
  assert.equal(otherAccepted.state.finishers[0].name, 'SmokeCarol');
  assert.ok(otherAccepted.state.events.every(event => event.playerId === carol.id));
  assert.ok(!otherAccepted.state.events.some(event => event.id === ownPassEvent.id));
  const finalA = await (await request(`${a.api}/state`)).json();
  assert.deepEqual(finalA.finishers.map(p => p.name), ['SmokeAlice']);
  checked('Identical image is refused within one room and allowed across rooms; final rankings and finishers remain separate');
  report.success = true;
} catch (error) {
  report.success = false;
  report.errors.push({ message: error.message });
} finally {
  for (const room of rooms) {
    try { await request(`${room.api}/host/end`, { method: 'POST', cookie: room.cookie }); } catch {}
  }
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (!report.success) process.exitCode = 1;
}
