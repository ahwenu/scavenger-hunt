import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import sharp from 'sharp';
import { recordPass } from '../apps/server/pass-events.mjs';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { createServer } from 'node:net';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(import.meta.dirname, '..');

/** Exercise persisted lobby clocks using a private child server and no paid credentials. */
test('first-join lobby clock is durable, scoped, host-controlled and starts only once', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'karimono-lobby-'));
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  let child;

  /** Start an isolated instance and wait only for its HTTP listener. */
  async function boot() {
    child = spawn(process.execPath, ['apps/server/index.mjs'], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: directory, PUBLIC_URL: base, OPENAI_API_KEY: '', OPENAI_KEY_FILE: path.join(directory, 'missing.env') }, stdio: 'ignore' });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error('Lobby test server exited');
      try { if ((await fetch(base)).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error('Lobby test server startup timed out');
  }

  /** Stop the instance before restarting against its durable database. */
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }

  /** Issue explicit credentials, leaving anonymous requests free of platform cookies. */
  async function request(route, { method = 'GET', body, token, cookie, status = 200 } = {}) {
    const response = await fetch(base + route, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal(response.status, status, `${method} ${route}: expected HTTP ${status}, got ${response.status}`);
    return response.json();
  }

  /** Create a room without opening a host tab or starting a clock. */
  async function room(name) {
    const response = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    assert.equal(response.status, 201);
    const result = await response.json();
    return { ...result, api: `/api/rooms/${result.id}`, cookie: response.headers.get('set-cookie').split(';')[0] };
  }

  /** Poll shared state until a background transition settles. */
  async function until(room, predicate, token) {
    for (let attempt = 0; attempt < 150; attempt++) {
      const state = await request(`${room.api}/state`, { token });
      if (predicate(state)) return state;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error('Lobby transition did not settle');
  }

  /** Adjust private test fixtures to avoid waiting 30 seconds in every local test run. */
  function fixture(sql, ...values) {
    const db = new DatabaseSync(path.join(directory, 'game.sqlite'));
    try { return db.prepare(sql).run(...values); } finally { db.close(); }
  }

  /** Inspect durable rows independently from HTTP snapshots. */
  function rows(sql, ...values) {
    const db = new DatabaseSync(path.join(directory, 'game.sqlite'), { readOnly: true });
    try { return db.prepare(sql).all(...values); } finally { db.close(); }
  }

  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  await boot();
  const a = await room('時計A'), b = await room('時計B');
  const empty = await request(`${a.api}/state`);
  assert.equal(empty.lobby.deadline, null);
  assert.equal(empty.lobby.startedAt, null);
  assert.equal(empty.lobby.status, 'empty');
  assert.equal(empty.preparing, false);
  assert.equal(empty.round, null);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal((await request(`${a.api}/state`)).lobby.deadline, null, 'Creation and reconnects alone must never start a timer');
  await request(`${a.api}/join`, { method: 'POST', body: { name: '' }, status: 400 });
  assert.equal((await request(`${a.api}/state`)).lobby.deadline, null, 'Failed registration must not start a timer');

  const beforeJoin = Date.now();
  const alice = await request(`${a.api}/join`, { method: 'POST', body: { name: 'ClockAlice', profile: '最初の参加者' } });
  const afterJoin = Date.now();
  const initial = await until(a, state => state.prepared, alice.token);
  const deadline = initial.lobby.deadline;
  assert.ok(deadline >= beforeJoin + 30000 && deadline <= afterJoin + 30000, 'The first successful join sets a server-side 30 second deadline');
  assert.equal(initial.round, null, 'Prepared content must remain hidden before the lobby deadline');
  assert.equal(initial.lobby.startedAt, null);
  assert.equal(initial.lobby.status, 'waiting');
  const [firstContext] = rows('SELECT preparedContext FROM rooms WHERE id=?', a.id);
  assert.equal(JSON.parse(firstContext.preparedContext).participantCount, 1);
  const reconnects = await Promise.all(Array.from({ length: 20 }, () => request(`${a.api}/state`, { token: alice.token })));
  assert.ok(reconnects.every(state => state.lobby.deadline === deadline && state.round === null));
  await request(`${a.api}/join`, { method: 'POST', body: { name: 'ClockBob', profile: '後から参加' } });
  const secondJoin = await request(`${a.api}/state`);
  assert.equal(secondJoin.lobby.deadline, deadline, 'Later joins must not reset the countdown');
  assert.equal(secondJoin.prepared, true, 'Later first-lobby joins must not repeatedly invalidate frozen generation input');
  assert.equal(rows('SELECT preparedContext FROM rooms WHERE id=?', a.id)[0].preparedContext, firstContext.preparedContext);
  assert.equal((await request(`${b.api}/state`)).lobby.deadline, null, 'Other rooms keep independent clocks');

  for (const operation of ['start-now', 'extend-lobby']) {
    await request(`${a.api}/host/${operation}`, { method: 'POST', status: 403 });
    await request(`${a.api}/host/${operation}`, { method: 'POST', cookie: b.cookie, status: 403 });
  }
  await request(`${a.api}/host/extend-lobby`, { method: 'POST', cookie: a.cookie });
  assert.equal((await request(`${a.api}/state`)).lobby.deadline, deadline + 10000);
  await request(`${a.api}/host/extend-lobby`, { method: 'POST', cookie: a.cookie });
  assert.equal((await request(`${a.api}/state`)).lobby.deadline, deadline + 20000, 'Each extension adds exactly ten seconds to the persisted deadline');
  await stop();
  await boot();
  assert.equal((await request(`${a.api}/state`)).lobby.deadline, deadline + 20000, 'The countdown must survive server restart');
  assert.equal((await request(`${b.api}/state`)).lobby.deadline, null);

  fixture('UPDATE rooms SET lobbyDeadline=? WHERE id=?', Date.now() - 1, a.id);
  const race = await Promise.all([
    ...Array.from({ length: 20 }, () => fetch(`${base}${a.api}/state`, { headers: { Authorization: `Bearer ${alice.token}` } })),
    fetch(`${base}${a.api}/host/start-now`, { method: 'POST', headers: { Cookie: a.cookie } }),
  ]);
  assert.ok(race.every(response => [200, 202, 409].includes(response.status)));
  const started = await until(a, state => state.round?.status === 'active', alice.token);
  assert.equal(started.lobby.status, 'started');
  assert.ok(Number.isFinite(started.lobby.startedAt));
  assert.equal(started.round.number, 1);
  assert.equal(rows('SELECT id FROM rounds WHERE roomId=?', a.id).length, 1, 'Concurrent participant polls and host force must create only one initial round');
  assert.equal((await request(`${b.api}/state`)).round, null);
  await request(`${a.api}/host/extend-lobby`, { method: 'POST', cookie: a.cookie, status: 409 });

  const carol = await request(`${b.api}/join`, { method: 'POST', body: { name: 'ClockCarol' } });
  await until(b, state => state.prepared, carol.token);
  fixture('UPDATE rooms SET preparedChallenge=NULL,preparedContext=NULL,preparedMode=NULL,preparedAt=NULL WHERE id=?', b.id);
  const forcedAt = Date.now();
  await request(`${b.api}/host/start-now`, { method: 'POST', cookie: b.cookie, status: 202 });
  const forced = await until(b, state => state.round?.status === 'active', carol.token);
  assert.ok(forced.lobby.deadline <= Date.now() && forced.lobby.deadline >= forcedAt);
  assert.equal(forced.round.number, 1, 'Forced unprepared start defers generation and starts once the shared challenge is ready');
  assert.equal(rows('SELECT id FROM rounds WHERE roomId=?', b.id).length, 1);

  const failedRoom = await room('生成失敗');
  fixture("UPDATE rooms SET mode='ai' WHERE id=?", failedRoom.id);
  const failedPlayer = await request(`${failedRoom.api}/join`, { method: 'POST', body: { name: 'ClockFailure' } });
  const failed = await until(failedRoom, state => Boolean(state.preparationError), failedPlayer.token);
  assert.equal(failed.aiAvailable, false, 'Failure fixture must not have any paid API credentials');
  assert.equal(failed.round, null);
  assert.equal(failed.prepared, false);
  assert.equal(failed.lobby.status, 'error');
  fixture('UPDATE rooms SET lobbyDeadline=? WHERE id=?', Date.now() - 1, failedRoom.id);
  const expiredFailure = await request(`${failedRoom.api}/state`, { token: failedPlayer.token });
  assert.equal(expiredFailure.round, null, 'An expired deadline must not fabricate a challenge when preparation failed');
  assert.equal(expiredFailure.lobby.status, 'error');

  // After the first round, ordinary preparation still tracks current participants.
  await request(`${a.api}/host/end`, { method: 'POST', cookie: a.cookie });
  await request(`${a.api}/host/prepare`, { method: 'POST', cookie: a.cookie, status: 202 });
  await until(a, state => state.prepared, alice.token);
  await request(`${a.api}/join`, { method: 'POST', body: { name: 'ClockLater' } });
  assert.equal((await request(`${a.api}/state`)).prepared, false, 'A join after the first round invalidates ordinary preparation');
  assert.equal(rows('SELECT id FROM rounds WHERE roomId=?', a.id).length, 1, 'First-round automatic start must not repeat after ending');

  await t.test('reference fixture stays private until start, is room-scoped and cannot be submitted as evidence', async () => {
    const refRoom = await room('参考写真の権限確認');
    const refPlayer = await request(`${refRoom.api}/join`, { method: 'POST', body: { name: 'ReferenceTester' } });
    await until(refRoom, state => state.prepared, refPlayer.token);
    const original = await sharp(randomBytes(320 * 240 * 3), { raw: { width: 320, height: 240, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
    const canonical = await sharp(original).rotate().resize({ width: 960, height: 960, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
    const secondCanonical = await sharp(canonical).rotate().resize({ width: 960, height: 960, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    const storageKey = `${randomUUID()}.jpg`;
    await mkdir(path.join(directory, 'references'), { recursive: true });
    await writeFile(path.join(directory, 'references', storageKey), original);
    const challenge = JSON.parse(rows('SELECT preparedChallenge FROM rooms WHERE id=?', refRoom.id)[0].preparedChallenge);
    challenge.reference = { storageKey, sha256: hash(original), canonicalHash: hash(canonical), canonicalHashes: [hash(canonical), hash(secondCanonical)], caption: 'Synthetic test reference', sourceUrl: 'https://example.invalid/fixture', license: 'Test fixture' };
    challenge.referenceTrace = [{ type: 'fixture', message: 'Synthetic reference; no network or paid API used' }];
    // Inject a prepared AI-mode fixture rather than requesting any real model calls.
    fixture("UPDATE rooms SET mode='ai',preparedMode='ai',preparedChallenge=? WHERE id=?", JSON.stringify(challenge), refRoom.id);
    const hidden = await request(`${refRoom.api}/state`, { token: refPlayer.token });
    assert.equal(hidden.aiAvailable, false);
    assert.equal(hidden.round, null);
    assert.ok(!JSON.stringify(hidden).includes(storageKey));
    await request(`${refRoom.api}/reference/${randomUUID()}`, { status: 404 });
    await request(`${refRoom.api}/host/reference-trace`, { cookie: refRoom.cookie, status: 404 });
    await request(`${refRoom.api}/host/start-now`, { method: 'POST', cookie: refRoom.cookie });
    const activeRef = await until(refRoom, state => state.round?.status === 'active', refPlayer.token);
    const reference = activeRef.round.challenge.reference;
    assert.equal(reference.url, `${refRoom.api}/reference/${activeRef.round.id}`);
    for (const internal of ['storageKey', 'sha256', 'canonicalHash', 'canonicalHashes']) assert.equal(reference[internal], undefined);
    assert.equal(activeRef.round.challenge.referenceTrace, undefined);
    const downloaded = await fetch(base + reference.url);
    assert.equal(downloaded.status, 200);
    assert.match(downloaded.headers.get('content-type'), /image\/jpeg/);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), original);
    await request(`${a.api}/reference/${activeRef.round.id}`, { status: 404 });
    await request(`${refRoom.api}/host/reference-trace`, { status: 403 });
    await request(`${refRoom.api}/host/reference-trace`, { cookie: a.cookie, status: 403 });
    assert.equal((await request(`${refRoom.api}/host/reference-trace`, { cookie: refRoom.cookie })).trace[0].type, 'fixture');

    /** Submit copies only: reference guards must stop them before an AI judgment. */
    async function copyUpload(bytes, requestId, expected) {
      const body = new FormData();
      body.set('roundId', activeRef.round.id);
      body.set('requestId', requestId);
      body.set('photo', new Blob([bytes], { type: 'image/jpeg' }), 'reference-copy.jpg');
      const response = await fetch(`${base}${refRoom.api}/submit`, { method: 'POST', headers: { Authorization: `Bearer ${refPlayer.token}` }, body });
      assert.equal(response.status, expected);
      return response.json();
    }
    await copyUpload(original, 'reference-exact-copy', 403);
    assert.equal(rows('SELECT id FROM submissions WHERE roomId=?', refRoom.id).length, 0, 'Exact reference bytes must be rejected before queue admission');
    const queuedCopy = await copyUpload(canonical, 'reference-reencoded-copy', 202);
    const rejectedCopy = await until(refRoom, state => state.mine.some(sub => sub.id === queuedCopy.id && sub.status === 'error'), refPlayer.token);
    assert.match(rejectedCopy.mine.find(sub => sub.id === queuedCopy.id).verdict.reason, /参考写真そのもの/);
    assert.equal(rejectedCopy.stats.accepted, 0);
    assert.equal(rejectedCopy.finishers.length, 0);
    await request(`${refRoom.api}/host/end`, { method: 'POST', cookie: refRoom.cookie });
  });

  await t.test('confirmed pass events remain durable and ranks revise when an earlier receipt settles later', async () => {
    const eventRoom = await room('順位通知の確認');
    const earlier = await request(`${eventRoom.api}/join`, { method: 'POST', body: { name: 'EarlierReceipt' } });
    await until(eventRoom, state => state.prepared, earlier.token);
    const later = await request(`${eventRoom.api}/join`, { method: 'POST', body: { name: 'LaterReceipt' } });
    await request(`${eventRoom.api}/host/start-now`, { method: 'POST', cookie: eventRoom.cookie });
    const active = await until(eventRoom, state => state.round?.status === 'active', later.token);
    const earlierSubmissionId = randomUUID();
    // Deliberately hold an earlier receipt in processing to model a slower AI decision.
    fixture("INSERT INTO submissions(seq,id,playerId,roundId,requestId,receivedAt,status,roomId) VALUES (-1,?,?,?,?,?,'processing',?)", earlierSubmissionId, earlier.id, active.round.id, 'held-earlier-fixture', active.round.startedAt, eventRoom.id);
    const body = new FormData();
    body.set('roundId', active.round.id);
    body.set('requestId', 'actual-later-demo-upload');
    body.set('photo', new Blob([await sharp({ create: { width: 64, height: 64, channels: 3, background: '#26b7a8' } }).jpeg().toBuffer()], { type: 'image/jpeg' }), 'actual-demo.jpg');
    const response = await fetch(`${base}${eventRoom.api}/submit`, { method: 'POST', headers: { Authorization: `Bearer ${later.token}` }, body });
    assert.equal(response.status, 202, await response.clone().text());
    const received = await response.json();
    const provisional = await until(eventRoom, state => state.events.some(event => event.submissionId === received.id), later.token);
    const laterEvent = provisional.events.find(event => event.submissionId === received.id);
    assert.equal(laterEvent.rank, 1);
    assert.equal(laterEvent.provisional, true);
    assert.equal(laterEvent.pendingAhead, 1);
    assert.equal(provisional.mine.find(sub => sub.id === received.id).passEventId, laterEvent.id);
    assert.equal(rows('SELECT id FROM pass_events WHERE submissionId=?', received.id).length, 1);
    assert.ok(!(await request(`${a.api}/state`)).events.some(event => event.id === laterEvent.id), 'Another room never sees this confirmation event');
    const db = new DatabaseSync(path.join(directory, 'game.sqlite'));
    try { recordPass(db, earlierSubmissionId, { pass: true, provider: 'デモ判定', reason: 'Explicit earlier-decision test fixture' }); }
    finally { db.close(); }
    const revised = await until(eventRoom, state => state.events.find(event => event.id === laterEvent.id)?.rank === 2, later.token);
    const revisedLater = revised.events.find(event => event.id === laterEvent.id);
    assert.equal(revisedLater.provisional, false);
    assert.equal(revisedLater.pendingAhead, 0);
    assert.deepEqual(revised.finishers.map(finisher => finisher.name), ['EarlierReceipt', 'LaterReceipt']);
    assert.equal(revised.ranks[0].name, 'EarlierReceipt');
    assert.equal(rows('SELECT id FROM pass_events WHERE roomId=?', eventRoom.id).length, 2);
    const stable = await request(`${eventRoom.api}/state`, { token: later.token });
    assert.deepEqual(stable.events.map(event => event.id), revised.events.map(event => event.id), 'Polling updates ranks without inventing new event IDs');
    await request(`${eventRoom.api}/host/end`, { method: 'POST', cookie: eventRoom.cookie });
  });
});
