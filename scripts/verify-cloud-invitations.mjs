/** ビルド済みWorkerと新規ローカルD1/R2で、事前招待からデモ採点までを検証する。 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const cloud = path.join(root, 'apps/cloud');
const require = createRequire(path.join(cloud, 'package.json'));
const { Miniflare } = require('miniflare');
const sharp = require('sharp');
const serverRoot = path.join(cloud, 'dist/server');
const workerFiles = (await readdir(serverRoot, { recursive: true })).filter(file => /\.(?:m?js)$/.test(file) && file !== 'index.js');
const mf = new Miniflare({
  modulesRoot: serverRoot,
  modules: ['index.js', ...workerFiles].map(file => ({ type: 'ESModule', path: path.join(serverRoot, file) })),
  compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
  d1Databases: { DB: 'advance-invitation-verification' }, r2Buckets: ['BUCKET'], cf: false,
});
const report = { testedAt: new Date().toISOString(), environment: 'local built Worker + D1 + R2', mode: 'demo', realAI: false, checks: [], success: false };

/** HTTP認可を通して操作し、秘密値を検証レポートへ残さない。 */
async function request(route, { method = 'GET', json, form, cookie, token, expected = 200 } = {}) {
  const encoded = form ? new Request('https://local.test/', { method: 'POST', body: form }) : null;
  const body = encoded ? await encoded.arrayBuffer() : json ? JSON.stringify(json) : undefined;
  const response = await mf.dispatchFetch(`https://local.test${route}`, {
    method, headers: {
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(encoded ? { 'Content-Type': encoded.headers.get('content-type') } : {}),
      ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }, ...(body ? { body } : {}),
  });
  assert.equal(response.status, expected, `${method} ${route}: HTTP ${response.status}`);
  return { response, data: await response.json() };
}

try {
  const db = await mf.getD1Database('DB');
  for (const file of (await readdir(path.join(cloud, 'drizzle'))).filter(file => file.endsWith('.sql')).sort()) {
    for (const sql of (await readFile(path.join(cloud, 'drizzle', file), 'utf8')).split('--> statement-breakpoint').filter(sql => sql.trim())) await db.prepare(sql.trim()).run();
  }
  const { response, data: room } = await request('/api/rooms', { method: 'POST', json: { name: '事前配布ローカル検証', autoStart: false }, expected: 201 });
  const api = `/api/rooms/${room.id}`;
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const players = await Promise.all(['事前参加A', '事前参加B'].map(name => request(`${api}/join`, { method: 'POST', json: { name }, expected: 201 }).then(result => result.data)));
  let state = (await request(`${api}/state`, { token: players[0].token })).data;
  assert.equal(state.room.autoStart, false);
  assert.equal(state.lobby.deadline, null);
  assert.equal(state.round, null);
  assert.equal(state.stats.players, 2);
  assert.equal(state.stats.activePlayers, 2);
  assert.ok(Number.isInteger(state.revision));
  assert.equal(state.live.pollIntervalMs, 2000);
  const revision = state.revision;
  // 開催前に入室済みでも、過去の入室時刻から勝手に開始されない。
  await db.prepare('UPDATE players SET joinedAt=joinedAt-60000 WHERE roomId=?').bind(room.id).run();
  state = (await request(`${api}/state`, { token: players[0].token })).data;
  assert.equal(state.round, null);
  assert.equal(state.generating, false);
  assert.equal(state.lobby.deadline, null);
  assert.ok(state.revision > revision);
  report.checks.push('事前参加・手動待機・D1版番号・人数/在席');

  for (const type of ['svg', 'png']) {
    const qr = await mf.dispatchFetch(`https://local.test${api}/qr.${type}?download=1`);
    assert.equal(qr.status, 200);
    assert.match(qr.headers.get('content-type'), new RegExp(type === 'svg' ? 'image/svg\\+xml' : 'image/png'));
    assert.ok((await qr.arrayBuffer()).byteLength > 100);
  }
  const page = await mf.dispatchFetch(state.joinUrl);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /カリモノ/);
  report.checks.push('配布用SVG/PNG・参加者Reactページ');

  await request(`${api}/host/start-now`, { method: 'POST', expected: 403 });
  await request(`${api}/host/start-now`, { method: 'POST', cookie, expected: state.prepared ? 200 : 202 });
  for (let attempt = 0; attempt < 120; attempt++) {
    state = (await request(`${api}/state`, { token: players[0].token })).data;
    if (state.round?.status === 'active') break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(state.round?.status, 'active');
  assert.equal(state.round.mode, 'demo');
  const photo = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#86a8e7' } }).jpeg().toBuffer();
  const form = new FormData();
  form.set('roundId', state.round.id);
  form.set('requestId', 'advance-invitation-demo-photo');
  form.set('demoResult', 'pass');
  form.set('photo', new Blob([photo], { type: 'image/jpeg' }), 'fixture.jpg');
  await request(`${api}/submit`, { method: 'POST', token: players[0].token, form, expected: 202 });
  for (let attempt = 0; attempt < 120; attempt++) {
    state = (await request(`${api}/state`, { token: players[0].token })).data;
    if (state.mine[0]?.status === 'accepted') break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(state.mine[0]?.awardedPoints, 500);
  assert.equal(state.ranks[0].score, 500);
  const other = (await request(`${api}/state`, { token: players[1].token })).data;
  assert.equal(other.mine.length, 0);
  assert.equal(other.ranks[0].id, players[0].id);
  assert.equal(other.ranks[0].score, 500);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM pass_events WHERE roomId=?').bind(room.id).first()).n, 1);
  report.checks.push('ホスト認可・明示開始・写真受付・デモ500点・他参加者順位同期/本人分離');
  report.success = true;
} finally {
  await mf.dispose();
  const output = path.join(root, 'plugin/artifacts/advance-invitation-local.json');
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
