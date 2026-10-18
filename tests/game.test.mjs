import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import QRCode from 'qrcode';

const root = path.resolve(import.meta.dirname, '..');

/** Reserve a local port without interfering with the user's preview. */
async function availablePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

/** Produce real, deterministic image bytes for upload and duplicate checks. */
const image = color => sharp({ create: { width: 40, height: 40, channels: 3, background: color } }).png().toBuffer();

test('rooms isolate authorization, events, game state and durable fair rankings', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'karimono-rooms-'));
  const port = await availablePort();
  const base = `http://127.0.0.1:${port}`;
  let child;
  let logs = '';
  const secrets = [];
  const streams = [];

  /** Boot with key loading disabled so integration tests never call an AI service. */
  async function boot() {
    child = spawn(process.execPath, ['apps/server/index.mjs'], {
      cwd: root,
      env: { ...process.env, PORT: String(port), DATA_DIR: directory, PUBLIC_URL: base, OPENAI_API_KEY: '', OPENAI_KEY_FILE: path.join(directory, 'nonexistent.env') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { logs += b; });
    child.stderr.on('data', b => { logs += b; });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error('Test server exited before becoming ready');
      try { if ((await fetch(base)).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error('Test server startup timed out');
  }

  /** Stop the child before reading the database or exercising restart recovery. */
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }

  /** Make explicit authenticated requests without a shared browser cookie jar. */
  async function request(route, { method = 'GET', body, token, cookie, status = 200, headers = {} } = {}) {
    const response = await fetch(base + route, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal(response.status, status, `${method} ${route}: ${await response.clone().text()}`);
    return response;
  }

  /** Create a room and retain only its scoped host credential for later requests. */
  async function room(name) {
    const response = await request('/api/rooms', { method: 'POST', body: { name }, status: 201 });
    const created = await response.json();
    assert.match(created.id, /^[a-zA-Z0-9_-]{20,}$/);
    assert.equal(created.hostUrl, `/rooms/${created.id}/host`);
    assert.equal(created.joinUrl, `${base}/rooms/${created.id}/join`);
    const setCookie = response.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/i);
    assert.ok(setCookie.includes(`Path=/api/rooms/${created.id}`));
    const cookie = setCookie.split(';')[0];
    assert.ok(cookie.startsWith(`host_${created.id}=`));
    secrets.push(cookie.split('=')[1]);
    return { ...created, cookie, api: `/api/rooms/${created.id}` };
  }

  /** Join directly from a room link, without asking for a room code. */
  async function join(room, name, profile = '') {
    const p = await (await request(`${room.api}/join`, { method: 'POST', body: { name, profile } })).json();
    secrets.push(p.token);
    return p;
  }

  /** Upload actual image bytes to a room using an individual participant token. */
  async function submit(room, player, roundId, requestId, color, demoResult = 'pass', status = 202) {
    const form = new FormData();
    form.set('roundId', roundId);
    form.set('requestId', requestId);
    form.set('demoResult', demoResult);
    form.set('photo', new Blob([await image(color)], { type: 'image/png' }), 'fixture.png');
    const response = await fetch(`${base}${room.api}/submit`, { method: 'POST', headers: { Authorization: `Bearer ${player.token}` }, body: form });
    assert.equal(response.status, status, await response.clone().text());
    const data = await response.json();
    if (status !== 202 || data.duplicate) return data;
    assert.ok(['queued', 'processing'].includes(data.status));
    return await settled(room, player, data.id);
  }

  /** Observe queued work through private state until its durable verdict settles. */
  async function settled(room, player, submissionId) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const state = await (await request(`${room.api}/state`, { token: player.token })).json();
      const submission = state.mine.find(s => s.id === submissionId);
      if (submission && ['accepted', 'rejected', 'error'].includes(submission.status)) return submission;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error('Background judgment did not settle');
  }

  /** Inspect durable confirmation events without relying only on UI snapshots. */
  function passEvents(submissionId) {
    const db = new DatabaseSync(path.join(directory, 'game.sqlite'), { readOnly: true });
    try { return db.prepare('SELECT * FROM pass_events WHERE submissionId=?').all(submissionId); }
    finally { db.close(); }
  }

  /** Observe preparation readiness without revealing the cached challenge to clients. */
  async function prepared(room) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const state = await (await request(`${room.api}/state`, { cookie: room.cookie })).json();
      if (state.prepared) {
        assert.equal(state.preparing, false);
        return state;
      }
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error('Challenge preparation did not become ready');
  }

  /** Open an independent browser's event stream and consume its initial event. */
  async function events(room) {
    const controller = new AbortController();
    streams.push(controller);
    const response = await fetch(`${base}${room.api}/events`, { signal: controller.signal });
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    const reader = response.body.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /data: update/);
    return { controller, reader };
  }

  t.after(async () => { streams.forEach(c => c.abort()); await stop(); await rm(directory, { recursive: true, force: true }); });
  await boot();
  const a = await room('赤組');
  const b = await room('青組');
  assert.notEqual(a.id, b.id);
  await request('/api/rooms/not-a-room/state', { status: 404 });
  for (const r of [a, b]) {
    const state = await (await request(`${r.api}/state`)).json();
    assert.deepEqual(state.room, { id: r.id, name: r === a ? '赤組' : '青組' });
    assert.equal(state.aiAvailable, false);
    assert.equal(state.mode, 'demo');
    assert.equal(state.players.length, 0);
    assert.equal(state.isHost, false);
    assert.equal(state.joinUrl, r.joinUrl);
    assert.equal((await (await request(`${r.api}/state`, { cookie: r.cookie })).json()).isHost, true);
    await request(r.hostUrl);
    await request(`/rooms/${r.id}/join`);
    const svg = await request(`${r.api}/qr.svg`);
    assert.match(svg.headers.get('content-type'), /svg/);
    const png = await request(`${r.api}/qr.png?download=1`);
    assert.match(png.headers.get('content-type'), /image\/png/);
    assert.match(png.headers.get('content-disposition'), /attachment/);
    const pngBytes = Buffer.from(await png.arrayBuffer());
    const metadata = await sharp(pngBytes).metadata();
    assert.ok(metadata.width >= 200);
    const { data: pixels, info } = await sharp(pngBytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const dark = (x, y) => pixels[(y * info.width + x) * info.channels] < 128;
    let left = info.width, right = 0;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      if (dark(x, y)) { left = Math.min(left, x); right = Math.max(right, x); }
    }
    // Compare actual QR pixels with the encoder's matrix for the exact room URL.
    // This verifies the payload without adding a QR decoder dependency.
    const expectedQR = QRCode.create(r.joinUrl).modules;
    const moduleWidth = (right - left + 1) / expectedQR.size;
    for (let y = 0; y < expectedQR.size; y++) for (let x = 0; x < expectedQR.size; x++) {
      assert.equal(dark(Math.floor(left + (x + 0.5) * moduleWidth), Math.floor(left + (y + 0.5) * moduleWidth)), Boolean(expectedQR.get(y, x)), 'QR pixels encode this room join URL');
    }
    await request(`${r.api}/host/start`, { method: 'POST', status: 403 });
    await request(`${r.api}/submit`, { method: 'POST', status: 401 });
    await request(`${r.api}/host/start`, { method: 'POST', cookie: r.cookie, status: 400 });
    await request(`${r.api}/host/mode`, { method: 'POST', cookie: r.cookie, body: { mode: 'ai' }, status: 400 });
  }
  await request(`${b.api}/host/start`, { method: 'POST', cookie: a.cookie, status: 403 });
  await request(`${a.api}/host/end`, { method: 'POST', cookie: a.cookie, headers: { Origin: 'https://untrusted.example' }, status: 403 });
  const streamA = await events(a);
  const streamA2 = await events(a);
  const streamB = await events(b);
  const otherRoomRead = streamB.reader.read();
  const alice = await join(a, 'Alice', '赤い帽子');
  await Promise.all([streamA, streamA2].map(async ({ reader }) => assert.match(new TextDecoder().decode((await reader.read()).value), /data: update/)));
  const noForeignEvent = Symbol('no event');
  assert.equal(await Promise.race([otherRoomRead, new Promise(resolve => setTimeout(() => resolve(noForeignEvent), 150))]), noForeignEvent, 'room A change must not notify room B');
  streamA.controller.abort();
  streamA2.controller.abort();
  const carol = await join(b, 'Carol', '青い靴');
  assert.match(new TextDecoder().decode((await otherRoomRead).value), /data: update/);
  streamB.controller.abort();
  await request(`${a.api}/host/prepare`, { method: 'POST', status: 403 });
  await request(`${a.api}/host/prepare`, { method: 'POST', cookie: b.cookie, status: 403 });
  await request(`${a.api}/host/prepare`, { method: 'POST', cookie: a.cookie, status: 202 });
  const onePlayerReady = await prepared(a);
  assert.equal(onePlayerReady.round, null, 'Preparation must not start or reveal the next round');
  assert.equal((await (await request(`${a.api}/state`, { token: alice.token })).json()).round, null);
  assert.equal((await (await request(`${b.api}/state`)).json()).round, null, 'A preparation must not start room B');
  const bob = await join(a, 'Bob', '青いシャツ');
  const invalidated = await (await request(`${a.api}/state`, { cookie: a.cookie })).json();
  assert.equal(invalidated.prepared, true, 'Initial lobby context stays frozen when another participant joins');
  const preparedDb = new DatabaseSync(path.join(directory, 'game.sqlite'), { readOnly: true });
  const cachedChallenge = JSON.parse(preparedDb.prepare('SELECT preparedChallenge FROM rooms WHERE id=?').get(a.id).preparedChallenge);
  preparedDb.close();
  const waitingParticipantState = await (await request(`${a.api}/state`, { token: alice.token })).json();
  assert.equal(typeof waitingParticipantState.prepared, 'boolean');
  assert.ok(!JSON.stringify(waitingParticipantState).includes(cachedChallenge.title), 'Cached challenge remains hidden until start');
  await request(`${b.api}/state`, { token: alice.token, status: 401 });
  await request(`${a.api}/state`, { token: carol.token, status: 401 });
  await request(`${b.api}/events`, { token: alice.token, status: 401 });
  await request(`${b.api}/submit`, { method: 'POST', token: alice.token, status: 401 });
  const preparedStart = await (await request(`${a.api}/host/start`, { method: 'POST', cookie: a.cookie })).json();
  assert.equal(preparedStart.usedPrepared, true, 'Prepared start must reuse the ready challenge rather than generate again');
  await request(`${b.api}/host/start`, { method: 'POST', cookie: b.cookie });
  const activeA = await (await request(`${a.api}/state`)).json();
  const activeB = await (await request(`${b.api}/state`)).json();
  assert.equal(activeA.round.mode, 'demo');
  assert.equal(activeA.round.status, 'active');
  assert.deepEqual(activeA.round.challenge, cachedChallenge);
  assert.equal(activeA.round.challenge.provider, 'デモ生成');
  assert.equal(activeA.prepared, false, 'Start consumes the prepared challenge');
  assert.equal(activeA.preparing, false);
  await request(`${a.api}/host/prepare`, { method: 'POST', cookie: a.cookie, status: 409 });
  assert.notEqual(activeA.round.id, activeB.round.id);
  await request(`${a.api}/host/start`, { method: 'POST', cookie: a.cookie, status: 409 });
  await request(`${a.api}/host/mode`, { method: 'POST', cookie: a.cookie, body: { mode: 'demo' }, status: 409 });
  const first = await submit(a, alice, activeA.round.id, 'alice-one', '#ff0000');
  assert.equal(first.status, 'accepted');
  assert.equal(first.verdict.provider, 'デモ判定');
  assert.equal(passEvents(first.id).length, 1, 'An accepted judgment creates exactly one durable pass event');
  const retry = await submit(a, alice, activeA.round.id, 'alice-one', '#ff0000', 'pass', 202);
  assert.equal(retry.id, first.id);
  assert.equal(retry.duplicate, true);
  assert.equal(passEvents(first.id).length, 1, 'Replaying the same request must not create a new celebration event');
  await submit(a, alice, activeA.round.id, 'alice-two', '#00ff00', 'pass', 409);
  await submit(a, bob, activeA.round.id, 'copied-photo', '#ff0000', 'pass', 409);
  const sharedAcrossRooms = await submit(b, carol, activeB.round.id, 'same-image-other-room', '#ff0000');
  assert.equal(sharedAcrossRooms.status, 'accepted');
  const failedJudgment = await submit(a, bob, activeA.round.id, 'bob-rejected', '#0000ff', 'fail');
  assert.equal(failedJudgment.status, 'rejected');
  assert.equal(passEvents(failedJudgment.id).length, 0, 'A rejected judgment must never publish a pass event');
  await submit(a, bob, activeA.round.id, 'bob-good', '#ffff00');
  const publicA = await (await request(`${a.api}/state`)).json();
  const publicB = await (await request(`${b.api}/state`)).json();
  assert.deepEqual(publicA.ranks.map(p => p.name), ['Alice', 'Bob']);
  assert.deepEqual(publicB.ranks.map(p => p.name), ['Carol']);
  assert.equal(publicA.events.length, 2);
  assert.equal(publicB.events.length, 1);
  assert.ok(publicA.events.every(event => [alice.id, bob.id].includes(event.playerId)), 'Only room A pass events are visible in room A');
  assert.ok(publicB.events.every(event => event.playerId === carol.id));
  const eventIds = publicA.events.map(event => event.id);
  assert.deepEqual((await (await request(`${a.api}/state`)).json()).events.map(event => event.id), eventIds, 'Refreshing a snapshot preserves event IDs');
  assert.ok(publicA.eventCursor >= Math.max(...eventIds));
  assert.deepEqual(publicA.ranks.map(p => p.wins), [1, 1]);
  assert.ok(publicA.ranks[0].totalMs < publicA.ranks[1].totalMs);
  assert.deepEqual(publicA.finishers.map(p => p.rank), [1, 2]);
  assert.equal(publicA.stats.answered, 2);
  assert.equal(publicA.stats.accepted, 2);
  assert.deepEqual(publicA.mine, []);
  assert.ok(!JSON.stringify(publicA).includes('赤い帽子'));
  assert.ok(!JSON.stringify(publicA).includes('Carol'));
  for (const secret of secrets) assert.ok(!JSON.stringify(publicA).includes(secret));
  const privateA = await (await request(`${a.api}/state`, { token: alice.token })).json();
  assert.equal(privateA.mine.length, 1);
  assert.equal(privateA.mine[0].playerId, alice.id);
  await request(`${a.api}/host/end`, { method: 'POST', cookie: a.cookie });
  assert.equal((await (await request(`${b.api}/state`)).json()).round.status, 'active');
  await submit(a, bob, activeA.round.id, 'ended', '#555555', 'pass', 409);
  await request(`${a.api}/host/start`, { method: 'POST', cookie: a.cookie });
  const secondRound = (await (await request(`${a.api}/state`)).json()).round.id;
  const late = await join(a, 'Late');
  await submit(a, late, secondRound, 'late-entry', '#555555', 'pass', 409);
  const invalidPhoto = new FormData();
  invalidPhoto.set('roundId', secondRound);
  invalidPhoto.set('requestId', 'invalid-image');
  invalidPhoto.set('photo', new Blob(['not an image'], { type: 'image/png' }), 'fake.png');
  const invalidResponse = await fetch(`${base}${a.api}/submit`, { method: 'POST', headers: { Authorization: `Bearer ${alice.token}` }, body: invalidPhoto });
  assert.equal(invalidResponse.status, 400);
  const concurrent = await Promise.all(['#123456', '#654321'].map(async (color, i) => {
    const form = new FormData();
    form.set('roundId', secondRound);
    form.set('requestId', `concurrent-${i}`);
    form.set('photo', new Blob([await image(color)], { type: 'image/png' }), 'fixture.png');
    return fetch(`${base}${a.api}/submit`, { method: 'POST', headers: { Authorization: `Bearer ${alice.token}` }, body: form });
  }));
  assert.deepEqual(concurrent.map(r => r.status).sort(), [202, 409]);
  const queuedResponse = concurrent.find(r => r.status === 202);
  const queued = await queuedResponse.json();
  assert.ok(['queued', 'processing'].includes(queued.status));
  const queuedPrivate = await (await request(`${a.api}/state`, { token: alice.token })).json();
  assert.equal(queuedPrivate.stats.pending, 1);
  assert.ok(queuedPrivate.mine.some(s => s.id === queued.id && ['queued', 'processing'].includes(s.status)));
  assert.deepEqual((await (await request(`${a.api}/state`)).json()).mine, []);
  await request(`${a.api}/host/end`, { method: 'POST', cookie: a.cookie });
  await request(`${a.api}/host/start`, { method: 'POST', cookie: a.cookie, status: 409 });
  assert.equal((await settled(a, alice, queued.id)).status, 'accepted');
  await request(`${b.api}/host/end`, { method: 'POST', cookie: b.cookie });
  await stop();
  const db = new DatabaseSync(path.join(directory, 'game.sqlite'), { readOnly: true });
  const contexts = db.prepare('SELECT context FROM rounds WHERE roomId=? ORDER BY number').all(a.id).map(r => JSON.parse(r.context));
  db.close();
  assert.equal(contexts[0].participantCount, 1);
  assert.equal(contexts[0].waitingCount, 1);
  assert.equal(contexts[0].participants[0].selfReportedInfo, '赤い帽子');
  assert.equal(contexts[1].responseRate, 1);
  assert.equal(contexts[1].correctRate, 1);
  assert.equal(contexts[1].history.length, 1);
  assert.ok(!JSON.stringify(contexts).includes('Carol'));
  await boot();
  const restoredA = await (await request(`${a.api}/state`, { token: alice.token, cookie: a.cookie })).json();
  const restoredB = await (await request(`${b.api}/state`, { token: carol.token, cookie: b.cookie })).json();
  assert.equal(restoredA.room.id, a.id);
  assert.equal(restoredA.players.length, 3);
  assert.equal(restoredA.round.number, 2);
  assert.equal(restoredA.round.status, 'closed');
  assert.equal(restoredA.ranks[0].wins, 2);
  assert.equal(restoredA.mine.length, 2);
  assert.equal(restoredA.isHost, true);
  assert.ok(eventIds.every(id => restoredA.events.some(event => event.id === id)), 'Pass event IDs survive server restart');
  assert.equal(restoredB.players.length, 1);
  assert.equal(restoredB.round.number, 1);
  assert.equal(restoredB.ranks[0].wins, 1);
  assert.equal(restoredB.mine.length, 1);
  await request(`${b.api}/state`, { token: alice.token, status: 401 });
  await request(`${a.api}/host/mode`, { method: 'POST', cookie: a.cookie, body: { mode: 'demo' } });
  for (const secret of secrets) assert.ok(!logs.includes(secret));
});
