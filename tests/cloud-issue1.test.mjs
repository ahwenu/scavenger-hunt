import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const cloud = path.join(root, 'apps/cloud');
const cloudRequire = createRequire(path.join(cloud, 'package.json'));
const ts = cloudRequire('typescript');

/** Run the actual Workers handler against SQLite transactions and an in-memory R2 boundary.
 * Only external AI and QR rendering are replaced. No network, keys, or paid calls. */
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync(path.join(cloud, 'drizzle')).filter(f => f.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(path.join(cloud, 'drizzle', file), 'utf8'));
  }
  function statement(sql) {
    let values = [];
    const execute = () => {
      const prepared = sqlite.prepare(sql);
      if (/^\s*SELECT\b|\bRETURNING\b/i.test(sql)) {
        const results = prepared.all(...values);
        return { success: true, results, meta: { changes: /^\s*SELECT/i.test(sql) ? 0 : results.length } };
      }
      return { success: true, results: [], meta: { changes: prepared.run(...values).changes } };
    };
    return {
      bind(...args) { values = args; return this; },
      async first() { return execute().results[0] ?? null; },
      async all() { return execute(); }, async run() { return execute(); }, execute,
    };
  }
  const DB = {
    prepare: statement,
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const results = statements.map(s => s.execute()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const objects = new Map(), pending = new Set(), modules = new Map();
  let generations = 0, judgments = 0, failJudgment = false, holdJudgment;
  const ai = {
    async generateChallenge(_key, mode) {
      assert.equal(mode, 'demo'); generations++;
      return { title: '赤いもの', description: '実物を撮影', criteria: ['赤い実物'], durationSeconds: 120, provider: 'テスト用仮生成' };
    },
    async judgePhoto(_key, _mode, _challenge, _photo, result) {
      judgments++; if (holdJudgment) await holdJudgment;
      if (failJudgment) throw Error('synthetic AI failure');
      return { pass: result !== 'reject', reason: result === 'reject' ? 'テスト用不合格' : 'テスト用合格', provider: 'テスト用仮判定' };
    },
  };
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} }; modules.set(filename, module);
    const result = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
    const require = name => {
      if (name === './cloud-ai') return ai;
      if (name === './reference-agent.mjs') return { createReferenceTools() { throw Error('No external reference calls allowed'); } };
      if (name === 'qrcode') return { toString: async () => '<svg/>', toBuffer: async () => Buffer.from('QR test double') };
      if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), `${name}.ts`));
      return cloudRequire(name);
    };
    new Function('require', 'module', 'exports', result.outputText)(require, module, module.exports);
    return module.exports;
  }
  const { handleApi } = load(path.join(cloud, 'lib/cloud-api.ts'));
  const { recordPass } = load(path.join(cloud, 'lib/pass-events.ts'));
  const { gameProjection } = load(path.join(cloud, 'lib/game-state.ts'));
  const env = { DB, BUCKET: {
    async put(key, bytes) { objects.set(key, bytes); },
    async get(key) { const bytes = objects.get(key); return bytes ? { arrayBuffer: async () => bytes, size: bytes.byteLength } : null; },
    async delete(key) { objects.delete(key); },
  } };
  const ctx = { waitUntil(promise) { pending.add(promise); promise.finally(() => pending.delete(promise)); } };
  async function drain() { while (pending.size) await Promise.all([...pending]); }
  async function request(route, { method = 'GET', json, form, token, cookie, expected = 200 } = {}) {
    const response = await handleApi(new Request(`https://local.test${route}`, {
      method, headers: { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      ...(json ? { body: JSON.stringify(json) } : form ? { body: form } : {}),
    }), env, ctx);
    const data = await response.json();
    assert.ok((Array.isArray(expected)?expected:[expected]).includes(response.status), `${method} ${route}: HTTP ${response.status}: ${JSON.stringify(data)}`);
    return { data, response };
  }
  async function room() {
    const { data, response } = await request('/api/rooms', { method: 'POST', json: { name: 'Issue #1 fixture' }, expected: 201 });
    return { ...data, api: `/api/rooms/${data.id}`, cookie: response.headers.get('set-cookie').split(';')[0] };
  }
  async function join(room, name = randomUUID()) { return (await request(`${room.api}/join`, { method: 'POST', json: { name: name.slice(0, 24) }, expected: 201 })).data; }
  async function start(room) {
    await drain();
    await request(`${room.api}/host/start`, { method: 'POST', cookie: room.cookie, expected: 200 });
    return (await request(`${room.api}/state`, { cookie: room.cookie })).data.round;
  }
  function photo(roundId, requestId = randomUUID(), result = 'pass') {
    const form = new FormData();
    form.set('roundId', roundId); form.set('requestId', requestId); form.set('demoResult', result);
    // Synthetic JPEG-signature bytes; tests exercise receipt/queue, not image decoding or model accuracy.
    form.set('photo', new Blob([new Uint8Array([255, 216, 255]), new TextEncoder().encode(requestId), new Uint8Array([255, 217])], { type: 'image/jpeg' }), 'synthetic.jpg');
    return form;
  }
  return { sqlite, DB, request, room, join, start, photo, drain, recordPass, gameProjection, objects,
    generations: () => generations, judgments: () => judgments,
    failJudgment(value) { failJudgment = value; },
    hold(value) { holdJudgment = value; },
    close: () => sqlite.close(),
  };
}

test('Issue #1: 100 independent players, atomic admission cap, private results and stable 1-based ranks', async t => {
  const h = fixture(); t.after(h.close); const room = await h.room();
  const players = await Promise.all(Array.from({ length: 100 }, (_, i) => h.join(room, `player-${i}`)));
  await h.drain();
  assert.equal(new Set(players.map(p => p.id)).size, 100);
  assert.equal(new Set(players.map(p => p.token)).size, 100);
  await h.request(`${room.api}/join`, { method: 'POST', json: { name: 'overflow' }, expected: 409 });
  const round = await h.start(room);
  const receipts = await Promise.all(players.map((p, i) => h.request(`${room.api}/submit`, { method: 'POST', token: p.token, form: h.photo(round.id, `burst-${i}`), expected: 202 })));
  await h.drain();
  const states = await Promise.all(players.map(p => h.request(`${room.api}/state`, { token: p.token })));
  for (let i = 0; i < 100; i++) {
    const state = states[i].data;
    assert.equal(state.mine.length, 1); assert.equal(state.mine[0].id, receipts[i].data.id);
    assert.equal(state.mine[0].status, 'accepted'); assert.equal(state.mine[0].awardedPoints, 500);
    assert.equal(state.ranks.length, 100); assert.ok(state.ranks.every(r => r.score === 500 && r.wins === 1));
    assert.deepEqual(state.ranks.map(r => r.rank), Array.from({ length: 100 }, (_, j) => j + 1));
    assert.equal(state.stats.accepted, 100); assert.equal(state.stats.pending, 0);
    assert.equal(state.stages.length, 10); assert.equal(state.stages[0].status, 'active');
    assert.deepEqual(state.game, { status: 'playing', totalRounds: 10 });
    assert.ok(!JSON.stringify(state).includes(players[(i + 1) % 100].token));
  }
  const other = await h.room(), outsider = await h.join(other); await h.drain();
  await h.request(`${room.api}/state`, { token: outsider.token, expected: 401 });
  await h.request(`${room.api}/host/start`, { method: 'POST', token: players[0].token, expected: 403 });
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM pass_events').get().n, 100);
});

test('Issue #1: concurrent retries keep one receipt, one award and one pass event', async t => {
  const h = fixture(); t.after(h.close); const room = await h.room(), p = await h.join(room), round = await h.start(room);
  let release; h.hold(new Promise(resolve => { release = resolve; }));
  const receipts = await Promise.all(Array.from({ length: 12 }, () => h.request(`${room.api}/submit`, { method: 'POST', token: p.token, form: h.photo(round.id, 'one-key'), expected: 202 })));
  assert.equal(new Set(receipts.map(r => r.data.id)).size, 1);
  release(); await h.drain(); h.hold(null);
  const replay = await h.request(`${room.api}/submit`, { method: 'POST', token: p.token, form: h.photo(round.id, 'one-key') });
  assert.equal(replay.data.id, receipts[0].data.id);
  await h.request(`${room.api}/submit`, { method: 'POST', token: p.token, form: h.photo(round.id), expected: 409 });
  const state = (await h.request(`${room.api}/state`, { token: p.token })).data;
  assert.equal(state.mine.length, 1); assert.equal(state.mine[0].awardedPoints, 500);
  assert.equal(state.ranks[0].score, 500); assert.equal(state.ranks[0].wins, 1);
  assert.equal(state.events.length, 1); assert.equal(h.judgments(), 1);
});

test('Issue #1: rejected/error are zero points; future, late and pre-join rounds are refused', async t => {
  const h = fixture(); t.after(h.close); const room = await h.room(), p = await h.join(room), round = await h.start(room);
  const post = (key, result, expected = 202) => h.request(`${room.api}/submit`, { method: 'POST', token: p.token, form: h.photo(round.id, key, result), expected });
  await post('reject', 'reject'); await h.drain();
  h.failJudgment(true); await post('error', 'pass'); await h.drain();
  const state = (await h.request(`${room.api}/state`, { token: p.token })).data;
  assert.deepEqual(state.mine.map(s => s.status), ['rejected', 'error']);
  assert.ok(state.mine.every(s => s.awardedPoints === 0 && s.verdict.reason));
  assert.equal(state.ranks[0].score, 0);
  await h.request(`${room.api}/submit`, { method: 'POST', token: p.token, form: h.photo('future-round'), expected: 409 });
  const late = await h.join(room, 'late'); await h.drain();
  h.sqlite.prepare('UPDATE players SET joinedAt=? WHERE id=?').run(round.startedAt + 1, late.id);
  await h.request(`${room.api}/submit`, { method: 'POST', token: late.token, form: h.photo(round.id), expected: 409 });
  h.sqlite.prepare('UPDATE rounds SET endsAt=? WHERE id=?').run(Date.now() - 1, round.id);
  await post('late', 'pass', 409);
});

test('Issue #1: persisted shared hints are authenticated, round-scoped and never generated on GET', async t => {
  const h = fixture(); t.after(h.close); const room = await h.room(), a = await h.join(room), b = await h.join(room), round = await h.start(room);
  const route = `${room.api}/hint?roundId=${round.id}`;
  assert.deepEqual((await h.request(route, { token: a.token })).data, { roundId: round.id, text: null, available: false });
  await h.request(route, { expected: 401 });
  await h.request(`${room.api}/host/hint`, { method: 'POST', token: a.token, json: { roundId: round.id, text: 'bad' }, expected: 403 });
  await h.request(`${room.api}/host/hint`, { method: 'POST', cookie: room.cookie, json: { roundId: round.id, text: '机の上を探そう' } });
  const generated = h.generations();
  const hints = await Promise.all(Array.from({ length: 100 }, (_, i) => h.request(route, { token: i % 2 ? a.token : b.token })));
  assert.ok(hints.every(r => r.data.text === '机の上を探そう' && r.data.available));
  assert.equal(h.generations(), generated);
  assert.equal(h.sqlite.prepare('SELECT hint FROM rounds WHERE id=?').get(round.id).hint, '机の上を探そう');
  await h.request(`${room.api}/hint?roundId=future`, { token: a.token, expected: 409 });
  await h.request(`${room.api}/host/hint`, { method: 'POST', cookie: room.cookie, json: { roundId: round.id, text: null } });
  assert.equal((await h.request(route, { token: a.token })).data.available, false);
  await h.request(`${room.api}/host/end`, { method: 'POST', cookie: room.cookie });
  await h.request(route, { token: a.token, expected: 409 });
});

test('Issue #1: host-only sequential advancement, ten rounds and settled final state', async t => {
  const h = fixture(); t.after(h.close); const room = await h.room(), p = await h.join(room);
  const lobby = (await h.request(`${room.api}/state`, { token: p.token })).data;
  assert.equal(lobby.round, null); assert.equal(lobby.game.status, 'lobby'); assert.ok(lobby.stages.every(s => s.status === 'locked'));
  for (let n = 1; n <= 10; n++) {
    const round = await h.start(room); assert.equal(round.number, n);
    await h.request(`${room.api}/host/start`, { method: 'POST', cookie: room.cookie, expected: 409 });
    if (n === 10) {
      let release; h.hold(new Promise(resolve => { release = resolve; }));
      await h.request(`${room.api}/submit`, { method: 'POST', token: p.token, form: h.photo(round.id), expected: 202 });
      await h.request(`${room.api}/host/end`, { method: 'POST', cookie: room.cookie });
      const waiting = (await h.request(`${room.api}/state`, { token: p.token })).data;
      assert.equal(waiting.game.status, 'playing'); assert.equal(waiting.round.status, 'closed');
      release(); await h.drain();
    } else await h.request(`${room.api}/host/end`, { method: 'POST', cookie: room.cookie });
  }
  const final = (await h.request(`${room.api}/state`, { token: p.token })).data;
  assert.equal(final.game.status, 'finished'); assert.ok(final.stages.every(s => s.status === 'completed'));
  assert.equal(final.ranks[0].score, 500); assert.equal(final.mine[0].awardedPoints, 500);
  await h.request(`${room.api}/host/start`, { method: 'POST', cookie: room.cookie, expected: 409 });
  await h.request(`${room.api}/host/prepare`, { method: 'POST', cookie: room.cookie, expected: 409 });
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM rounds').get().n, 10);
});

test('Issue #1: scores/time/join/id ordering, invalid receipts and duplicate successes', t => {
  const h = fixture(); t.after(h.close);
  const players = ['d', 'c', 'b', 'a'].map(id => ({ id, name: id, joinedAt: id === 'd' ? 2 : 1 }));
  const rounds = [{ id: 'r', number: 1, status: 'active', startedAt: 100, endsAt: 200 }];
  const subs = players.map((p, i) => ({ id: `s${i}`, seq: i, playerId: p.id, roundId: 'r', status: 'accepted', receivedAt: p.id === 'a' ? 150 : 120 }));
  subs.push({ ...subs[0], id: 'duplicate', seq: 10 });
  subs.push({ ...subs[0], id: 'late', playerId: 'a', receivedAt: 200 });
  const result = h.gameProjection(players, rounds, subs, 150);
  assert.deepEqual(result.ranks.map(r => r.id), ['b', 'c', 'd', 'a']);
  assert.ok(result.ranks.every(r => r.score === 500 && r.wins === 1));
  assert.ok(!result.awardedIds.has('duplicate') && !result.awardedIds.has('late'));
});

test('Issue #1: pass transaction rolls back on event failure and refuses expired or invalid receipts', async t => {
  const h = fixture(); t.after(h.close); const room = await h.room(), p = await h.join(room), round = await h.start(room);
  const id = 'held-transaction';
  h.sqlite.prepare("INSERT INTO submissions(id,playerId,roundId,requestId,receivedAt,status,roomId,objectKey,mime,demoResult,leaseUntil) VALUES (?,?,?,?,?,'processing',?,'','image/jpeg','pass',?)")
    .run(id,p.id,round.id,id,round.startedAt,room.id,Date.now()+65000);
  h.sqlite.exec("CREATE TRIGGER break_event BEFORE INSERT ON pass_events BEGIN SELECT RAISE(ABORT,'event_failure_fixture'); END;");
  await assert.rejects(h.recordPass(h.DB,id,{pass:true}), /event_failure_fixture/);
  assert.equal(h.sqlite.prepare('SELECT status FROM submissions WHERE id=?').get(id).status,'processing');
  h.sqlite.exec('DROP TRIGGER break_event');
  h.sqlite.prepare('UPDATE submissions SET leaseUntil=? WHERE id=?').run(Date.now()-1,id);
  assert.equal(await h.recordPass(h.DB,id,{pass:true}),undefined);
  h.sqlite.prepare('UPDATE submissions SET leaseUntil=?,receivedAt=? WHERE id=?').run(Date.now()+65000,round.endsAt,id);
  assert.equal(await h.recordPass(h.DB,id,{pass:true}),undefined);
  h.sqlite.prepare('UPDATE submissions SET receivedAt=? WHERE id=?').run(round.startedAt,id);
  const first=await h.recordPass(h.DB,id,{pass:true}),repeat=await h.recordPass(h.DB,id,{pass:true});
  assert.equal(first.id,repeat.id);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM pass_events').get().n,1);
});

test('Issue #1: pending final judgment must settle or time out before finished; expiry clears stale snapshots', async t => {
  const h=fixture();t.after(h.close);const room=await h.room(),p=await h.join(room);await h.drain();
  const now=Date.now();
  h.sqlite.prepare("INSERT INTO rounds(id,number,mode,status,challenge,context,startedAt,endsAt,roomId) VALUES ('final',10,'demo','active','{}','{}',?,?,?)").run(now-10000,now-1,room.id);
  h.sqlite.prepare("INSERT INTO submissions(id,playerId,roundId,requestId,receivedAt,status,roomId,objectKey,mime,demoResult,leaseUntil) VALUES ('expired',?,'final','expired',?,'processing',?,'','image/jpeg','pass',?)").run(p.id,now-1000,room.id,now-1);
  const state=(await h.request(`${room.api}/state`,{token:p.token})).data;
  assert.equal(state.game.status,'finished');assert.equal(state.round.status,'closed');
  assert.equal(state.mine[0].status,'error');assert.equal(state.mine[0].awardedPoints,0);
  assert.ok(state.mine[0].verdict.reason);assert.equal(state.ranks[0].score,0);
});

test('Issue #1: concurrent host starts publish only one next round and preserve waiting state', async t => {
  const h=fixture();t.after(h.close);const room=await h.room(),p=await h.join(room),round=await h.start(room);
  await h.request(`${room.api}/host/end`,{method:'POST',cookie:room.cookie});
  const waiting=(await h.request(`${room.api}/state`,{token:p.token})).data;
  assert.equal(waiting.game.status,'playing');assert.equal(waiting.round.id,round.id);assert.equal(waiting.round.status,'closed');
  const starts=await Promise.all(Array.from({length:20},()=>h.request(`${room.api}/host/start`,{method:'POST',cookie:room.cookie,expected:[200,409]})));
  assert.equal(starts.filter(r=>r.response.status===200).length,1);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM rounds').get().n,2);
  const state=(await h.request(`${room.api}/state`,{token:p.token})).data;
  assert.equal(state.round.number,2);assert.equal(state.stages[0].status,'completed');assert.equal(state.stages[1].status,'active');
});

test('Issue #1: nullable hint migration preserves existing rounds and schema history', t => {
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const directory=path.join(cloud,'drizzle');
  for(const file of readdirSync(directory).filter(f=>/^000[0-2]_.*\.sql$/.test(f)).sort())db.exec(readFileSync(path.join(directory,file),'utf8'));
  db.prepare("INSERT INTO rounds(id,number,mode,status,challenge,context,startedAt,endsAt,roomId) VALUES ('existing',1,'demo','closed','{}','{}',1,2,'legacy')").run();
  db.exec(readFileSync(path.join(directory,'0003_issue1_round_hint.sql'),'utf8'));
  const row=db.prepare("SELECT * FROM rounds WHERE id='existing'").get();
  assert.equal(row.hint,null);assert.equal(row.challenge,'{}');assert.equal(row.number,1);
});
