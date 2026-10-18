/** 公開Sitesの100 HTTPクライアント相当と10競技を、明示デモ判定だけで検証する。 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
if (!args.includes('--run')) {
  console.log('公開部屋を作成する検証です。配備確認後に node scripts/verify-public-issue1.mjs --run を実行してください。');
  process.exit(0);
}
const option = name => args.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
const origin = new URL(option('--base') || 'https://karimono-one-lease.ahwenu.chatgpt.site');
assert.equal(origin.protocol, 'https:');
assert.equal(origin.pathname, '/');
assert.equal(origin.username + origin.password + origin.search + origin.hash, '');
const sharp = createRequire(path.join(root, 'api/package.json'))('sharp');
const concurrency = 16;
const report = {
  testedAt: new Date().toISOString(), environment: 'public Sites / independent HTTP clients',
  baseUrl: origin.origin, mode: 'demo', realAI: false, realBrowsers: false,
  participants: 100, concurrency, httpStatuses: {}, expectedRejections: {}, errors: [], success: false,
};
const latency = { join: [], state: [], submit: [], result: [] };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const began = performance.now();
let roomApi, cookie;

/** 小さな並列数で全員の独立Bearerを使い、不要なリトライを行わず処理する。 */
async function pool(values, action) {
  const results = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await action(values[index], index);
    }
  }));
  return results;
}

/** 秘密をログへ出さず、資格情報をメモリに限定してHTTP状態と応答時間を記録する。 */
async function request(route, { method = 'GET', json, form, token, host = false, expected = 200, phase, label } = {}) {
  const start = performance.now();
  const response = await fetch(`${origin.origin}${route}`, {
    method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000),
    headers: {
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(host ? { Cookie: cookie } : {}),
    },
    ...(json ? { body: JSON.stringify(json) } : form ? { body: form } : {}),
  });
  report.httpStatuses[response.status] = (report.httpStatuses[response.status] || 0) + 1;
  if (phase) latency[phase].push(Math.round((performance.now() - start) * 100) / 100);
  if (label) report.expectedRejections[label] = response.status;
  assert.equal(response.status, expected, `${method} ${route}: HTTP ${response.status}, expected ${expected}`);
  const data = await response.json();
  return { response, data };
}

/** 期限内に正本の状態が揃うまでポーリングし、毎回デモモードを確認する。 */
async function waitFor(player, condition, label, timeoutMs = 90000) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    const { data } = await request(`${roomApi}/state`, { token: player.token });
    assert.equal(data.mode, 'demo', '実AIモードで負荷試験を継続しません');
    if (condition(data)) return data;
    await sleep(600);
  }
  throw Error(`状態待機の期限超過: ${label}`);
}

/** 1MiB以下の有効なJPEGを、同じ写真の重複と誤判定されない乱数画素から作る。 */
const photo = () => sharp(randomBytes(64 * 64 * 3), { raw: { width: 64, height: 64, channels: 3 } }).jpeg().toBuffer();

/** デモ判定結果だけを指定し、サーバーが確定する点数を入力へ含めない。 */
function submission(roundId, bytes, result = 'pass', requestId = randomUUID()) {
  const form = new FormData();
  form.set('roundId', roundId); form.set('requestId', requestId); form.set('demoResult', result);
  form.set('photo', new Blob([bytes], { type: 'image/jpeg' }), 'fixture.jpg');
  return form;
}

/** 測定値は実際に送ったHTTPの分布として計算する。 */
function summary(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return { count: sorted.length, p50: sorted[Math.max(0, Math.ceil(sorted.length * .5) - 1)] ?? null,
    p95: sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)] ?? null, max: sorted.at(-1) ?? null };
}

try {
  const created = await request('/api/rooms', { method: 'POST', json: { name: 'Issue #1 public HTTP verification' }, expected: 201 });
  report.roomId = created.data.id;
  report.joinUrl = `${origin.origin}/rooms/${created.data.id}/join`;
  roomApi = `/api/rooms/${created.data.id}`;
  cookie = created.response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'ホストCookieが返りません');
  const joinPage = await fetch(report.joinUrl, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  assert.equal(joinPage.status, 200);
  assert.ok(joinPage.headers.get('content-type')?.includes('text/html'));
  assert.ok((await joinPage.text()).includes('/app.js'), '匿名参加URLがゲームのHTMLを返しません');
  report.anonymousJoinPage = { status: joinPage.status, platformAuthentication: false };
  // 参加が生成処理を始める前に、正式なホストAPIで必ず明示デモへ切り替える。
  await request(`${roomApi}/host/mode`, { method: 'POST', host: true, json: { mode: 'demo' } });
  const initial = (await request(`${roomApi}/state`, { host: true })).data;
  assert.equal(initial.mode, 'demo'); assert.equal(initial.round, null);
  assert.equal(initial.game.totalRounds, 10); assert.equal(initial.stages.length, 10);
  const players = await pool(Array.from({ length: 100 }, (_, i) => i), async i =>
    (await request(`${roomApi}/join`, { method: 'POST', json: { name: `http-fixture-${i + 1}` }, expected: 201, phase: 'join' })).data);
  assert.equal(new Set(players.map(player => player.id)).size, 100);
  report.joinedPlayers = players.length;
  await request(`${roomApi}/join`, { method: 'POST', json: { name: 'over-cap' }, expected: 409, label: 'participant101' });
  console.log('100 independent HTTP participants joined; 101st rejected; explicit demo mode.');
  let active = await waitFor(players[0], state => state.prepared || state.round?.status === 'active', 'initial preparation');
  if (!active.round) {
    await request(`${roomApi}/host/start-now`, { method: 'POST', host: true });
    active = await waitFor(players[0], state => state.round?.status === 'active', 'round 1');
  }
  assert.equal(active.round.number, 1); assert.equal(active.round.mode, 'demo');
  const roundId = active.round.id;
  await request(`${roomApi}/host/hint`, { method: 'POST', host: true, json: { roundId, text: '全員共通の検証用ヒント' } });
  await request(`${roomApi}/hint?roundId=${roundId}`, { expected: 401, label: 'hintWithoutBearer' });
  await request(`${roomApi}/host/hint`, { method: 'POST', token: players[0].token, json: { roundId, text: 'forbidden' }, expected: 403, label: 'participantCannotWriteHint' });
  await pool(players, async player => {
    const state = (await request(`${roomApi}/state`, { token: player.token, phase: 'state' })).data;
    assert.equal(state.ranks.length, 100); assert.equal(state.stages.length, 10); assert.equal(state.mine.length, 0);
    const hint = (await request(`${roomApi}/hint?roundId=${roundId}`, { token: player.token })).data;
    assert.equal(hint.available, true); assert.equal(hint.text, '全員共通の検証用ヒント');
  });
  report.sharedHintReads = 100;
  const photos = await Promise.all(players.map(photo));
  report.photoBytes = { count: photos.length, total: photos.reduce((sum, bytes) => sum + bytes.length, 0), width: 64, height: 64 };
  const submittedAt = performance.now();
  const receipts = await pool(players, async (player, i) =>
    (await request(`${roomApi}/submit`, { method: 'POST', token: player.token, form: submission(roundId, photos[i]), expected: 202, phase: 'submit' })).data);
  await waitFor(players[0], state => state.stats.accepted === 100 && state.stats.pending === 0, '100 judgments');
  report.burstToSettledMs = Math.round(performance.now() - submittedAt);
  const results = await pool(players, player => request(`${roomApi}/state`, { token: player.token, phase: 'result' }));
  const eventIds = new Set();
  results.forEach(({ data }, i) => {
    assert.equal(data.mine.length, 1); assert.equal(data.mine[0].id, receipts[i].id);
    assert.equal(data.mine[0].playerId, players[i].id); assert.equal(data.mine[0].status, 'accepted');
    assert.equal(data.mine[0].awardedPoints, 500); assert.ok(data.mine[0].passEventId);
    eventIds.add(data.mine[0].passEventId);
    assert.ok(data.ranks.every(rank => rank.score === 500 && rank.wins === 1));
    assert.deepEqual(data.ranks.map(rank => rank.rank), Array.from({ length: 100 }, (_, j) => j + 1));
    assert.equal(data.stats.accepted, 100); assert.equal(data.stats.pending, 0);
  });
  assert.equal(eventIds.size, 100);
  report.completedPlayersRound1 = 100; report.distinctOwnPassEventIdsRound1 = eventIds.size;
  report.publicEventWindow = results[0].data.events.length;
  report.burstToAllResultsMs = Math.round(performance.now() - submittedAt);
  console.log('100 JPEGs accepted; all own results +500 and stable ranks; 100 distinct own pass-event IDs.');
  await request(`${roomApi}/host/end`, { method: 'POST', host: true });
  await waitFor(players[0], state => state.round?.status === 'closed', 'round 1 closed');
  await request(`${roomApi}/submit`, { method: 'POST', token: players[0].token, form: submission(roundId, await photo()), expected: 409, label: 'newPhotoAfterHostClosedReception' });
  await request(`${roomApi}/hint?roundId=${roundId}`, { token: players[0].token, expected: 409, label: 'closedRoundHint' });
  report.rounds = [{ number: 1, accepted: 100 }];
  for (let number = 2; number <= 10; number++) {
    await request(`${roomApi}/host/start`, { method: 'POST', host: true });
    active = await waitFor(players[0], state => state.round?.number === number && state.round.status === 'active', `round ${number}`);
    assert.equal(active.round.mode, 'demo');
    const nextRoundId = active.round.id;
    if (number === 2) {
      const rejected = (await request(`${roomApi}/submit`, { method: 'POST', token: players[0].token,
        form: submission(nextRoundId, await photo(), 'reject'), expected: 202 })).data;
      const rejectedState = await waitFor(players[0], state => state.mine.some(item => item.id === rejected.id && item.status === 'rejected'), 'demo rejected photo');
      assert.equal(rejectedState.mine.find(item => item.id === rejected.id).awardedPoints, 0);
      assert.ok(rejectedState.mine.find(item => item.id === rejected.id).verdict.reason);
      report.rejectedThenRetry = true;
    }
    const requestId = randomUUID(), bytes = await photo();
    const accepted = (await request(`${roomApi}/submit`, { method: 'POST', token: players[0].token,
      form: submission(nextRoundId, bytes, 'pass', requestId), expected: 202 })).data;
    const settled = await waitFor(players[0], state => state.mine.some(item => item.id === accepted.id && item.status === 'accepted'), `round ${number} accepted`);
    assert.equal(settled.ranks.find(rank => rank.id === players[0].id).score, number * 500);
    if (number === 2) {
      const duplicate = (await request(`${roomApi}/submit`, { method: 'POST', token: players[0].token,
        form: submission(nextRoundId, bytes, 'pass', requestId) })).data;
      assert.equal(duplicate.id, accepted.id); assert.equal(duplicate.duplicate, true);
      report.duplicateSameReceipt = true;
    }
    await request(`${roomApi}/host/end`, { method: 'POST', host: true });
    const ended = await waitFor(players[0], state => state.round?.status === 'closed', `round ${number} closed`);
    assert.equal(ended.game.status, number === 10 ? 'finished' : 'playing');
    report.rounds.push({ number, accepted: 1 });
  }
  const final = await waitFor(players[0], state => state.game.status === 'finished', '10-round finished');
  assert.ok(final.stages.every(stage => stage.status === 'completed'));
  const winner = final.ranks.find(rank => rank.id === players[0].id);
  assert.equal(winner.score, 5000); assert.equal(winner.wins, 10); assert.equal(winner.rank, 1);
  await request(`${roomApi}/host/start`, { method: 'POST', host: true, expected: 409, label: 'round11Rejected' });
  report.finished = { status: final.game.status, totalRounds: final.game.totalRounds, allStagesCompleted: true, winnerScore: winner.score, winnerWins: winner.wins };
  report.success = true;
} catch (error) {
  report.errors.push(String(error.message).slice(0, 600)); process.exitCode = 1;
} finally {
  report.latencyMs = Object.fromEntries(Object.entries(latency).map(([name, values]) => [name, summary(values)]));
  report.unexpected429 = report.httpStatuses[429] || 0;
  report.serverErrors = Object.entries(report.httpStatuses).filter(([code]) => Number(code) >= 500).reduce((sum, [, count]) => sum + count, 0);
  report.elapsedMs = Math.round(performance.now() - began);
  const out = path.join(root, 'plugin/artifacts/issue1-public-http-verification.json');
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2) + '\n');
  cookie = undefined;
  console.log(JSON.stringify(report, null, 2));
}
