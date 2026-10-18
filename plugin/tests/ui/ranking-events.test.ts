/** 初回・復帰の抑制、確定差分の集約、100人のページ境界を検証する。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RoomSnapshot } from '../../src/shared/contracts.js';
import { createRankingObserver, rankingPage, rankingPageSize } from '../../src/ui/ranking-events.js';

/** 確定順位を持つ最小の部屋DTOを作る。 */
function room(version = 1, patch: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return { roomId: 'one', roomCode: 'ABC', status: 'playing', version, roundCount: 10, scoreUnit: 'points',
    teams: [{ teamId: 'a', name: '青組' }, { teamId: 'b', name: '赤組' }],
    leaderboard: [{ teamId: 'a', name: '青組', score: 500, rank: 1 }, { teamId: 'b', name: '赤組', score: 0, rank: 2 }],
    currentRound: null, me: null, ...patch };
}
const connected = { mode: 'sites' as const, now: 1_000 };

test('初回・同versionのポーリング・古いversionは演出せず確定値を基準にする', () => {
  const observer = createRankingObserver();
  assert.equal(observer.observe(room(), connected), null);
  assert.equal(observer.observe(room(), { ...connected, now: 3_000 }), null);
  assert.equal(observer.observe(room(0), { ...connected, now: 4_000 }), null);
  assert.equal(observer.observe(room(1), { ...connected, now: 5_000 }), null);
});

test('遅れて届いた古い応答は基準versionを戻さず、確定済みの加点を再演しない', () => {
  const observer = createRankingObserver();
  const current = room(5, { leaderboard: [{ teamId: 'a', name: '青組', score: 1000, rank: 1 }] });
  observer.observe(current, connected);
  assert.equal(observer.observe(room(4), { ...connected, now: 2_000 }), null);
  assert.equal(observer.observe(current, { ...connected, now: 3_000 }), null);
  const update = observer.observe(room(6, { leaderboard: [{ teamId: 'a', name: '青組', score: 1500, rank: 1 }] }), { ...connected, now: 4_000 });
  assert.equal(update?.changes[0].scoreDelta, 500);
});

test('新規参加と同時加点を1件に集約し、参加直後の既得点を獲得扱いにしない', () => {
  const observer = createRankingObserver();
  observer.observe(room(), connected);
  const update = observer.observe(room(2, {
    teams: [...room().teams, { teamId: 'c', name: '白組' }],
    leaderboard: [{ teamId: 'a', name: '青組', score: 1000, rank: 1 }, { teamId: 'c', name: '白組', score: 500, rank: 2 }, { teamId: 'b', name: '赤組', score: 0, rank: 3 }],
  }), { ...connected, now: 3_000 });
  assert.equal(update?.kind, 'score');
  assert.equal(update?.joinedCount, 1);
  assert.equal(update?.changes.find(team => team.teamId === 'a')?.scoreDelta, 500);
  assert.equal(update?.changes.find(team => team.teamId === 'c')?.scoreDelta, 0);
  assert.match(update!.announcement, /新たに1人/);
});

test('首位交代と最終確定を優先し、サーバーの順位・得点を変更しない', () => {
  const observer = createRankingObserver();
  observer.observe(room(), connected);
  const takeover = room(2, { leaderboard: [{ teamId: 'b', name: '赤組', score: 1000, rank: 1 }, { teamId: 'a', name: '青組', score: 500, rank: 2 }] });
  const update = observer.observe(takeover, { ...connected, now: 3_000 });
  assert.equal(update?.kind, 'leader');
  assert.equal(update?.changes.find(team => team.teamId === 'b')?.rankDelta, 1);
  assert.match(update!.detail, /赤組/);
  assert.deepEqual(takeover.leaderboard.map(team => team.rank), [1, 2]);
  const final = observer.observe({ ...takeover, status: 'finished', version: 3 }, { ...connected, now: 5_000 });
  assert.equal(final?.kind, 'final');
  assert.match(final!.detail, /優勝 赤組/);
  assert.equal(observer.observe({ ...takeover, status: 'finished', version: 3 }, { ...connected, now: 7_000 }), null);
});

test('名前修正と減点も更新として表示し、順位上昇は独立に検出する', () => {
  const observer = createRankingObserver();
  observer.observe(room(), connected);
  const renamed = room(2, { leaderboard: [{ teamId: 'a', name: '新しい青組', score: 400, rank: 1 }, { teamId: 'b', name: '赤組', score: 0, rank: 2 }] });
  assert.equal(observer.observe(renamed, { ...connected, now: 3_000 })?.kind, 'update');
  const old = room(3, { leaderboard: [...renamed.leaderboard, { teamId: 'c', name: '白組', score: 0, rank: 3 }] });
  observer.observe(old, { ...connected, now: 5_000 });
  const rise = observer.observe(room(4, { leaderboard: [renamed.leaderboard[0], { teamId: 'c', name: '白組', score: 0, rank: 2 }, { teamId: 'b', name: '赤組', score: 0, rank: 3 }] }), { ...connected, now: 7_000 });
  assert.equal(rise?.kind, 'rise');
  assert.match(rise!.detail, /白組 が 2位/);
});

test('部屋・接続先・単位の変更、非表示復帰、再接続、長い通信断は過去を再生しない', () => {
  for (const reset of ['room', 'mode', 'unit', 'hidden', 'disconnected', 'gap', 'manual'] as const) {
    const observer = createRankingObserver();
    observer.observe(room(), connected);
    const next = room(2, { leaderboard: [{ teamId: 'b', name: '赤組', score: 1000, rank: 1 }, { teamId: 'a', name: '青組', score: 500, rank: 2 }] });
    if (reset === 'hidden') observer.observe(room(), { ...connected, active: false });
    if (reset === 'disconnected') observer.observe(room(), { ...connected, connected: false });
    if (reset === 'manual') observer.reset();
    assert.equal(observer.observe({ ...next, ...(reset === 'room' ? { roomId: 'two' } : {}), ...(reset === 'unit' ? { scoreUnit: 'wins' as const } : {}) },
      { mode: reset === 'mode' ? 'demo' : 'sites', now: reset === 'gap' ? 20_000 : 3_000 }), null, reset);
  }
});

test('大量の同時変更は速報1件・強調12行以内に収め、次の同期で重複しない', () => {
  const observer = createRankingObserver();
  observer.observe(room(), connected);
  const teams = Array.from({ length: 100 }, (_, index) => ({ teamId: `team-${index}`, name: `参加${index}` }));
  const next = room(2, { teams, leaderboard: teams.map((team, index) => ({ ...team, rank: index + 1, score: 500 })) });
  const update = observer.observe(next, { ...connected, now: 3_000 });
  assert.equal(update?.joinedCount, 100);
  assert.equal(update?.highlightedIds.length, 12);
  assert.equal(update?.changes.length, 100);
  assert.equal(observer.observe(next, { ...connected, now: 5_000 }), null);
});

test('呼出側が同じDTOを書き換えても、前回確定値との差分を検出する', () => {
  const observer = createRankingObserver();
  const current = room();
  observer.observe(current, connected);
  current.version = 2;
  current.leaderboard[0].score = 1000;
  assert.equal(observer.observe(current, { ...connected, now: 3_000 })?.changes[0].scoreDelta, 500);
});

test('退場と減点は祝福扱いにせず、最新の一覧との差を知らせる', () => {
  const observer = createRankingObserver();
  observer.observe(room(), connected);
  const departed = observer.observe(room(2, { teams: [{ teamId: 'b', name: '赤組' }], leaderboard: [{ teamId: 'b', name: '赤組', score: 0, rank: 1 }] }), { ...connected, now: 3_000 });
  assert.equal(departed?.kind, 'update');
  assert.equal(departed?.removedCount, 1);
  assert.match(departed!.detail, /青組.*一覧から外れました/);
});

test('勝利数が同じでも累計時間の修正を中立の更新として表示する', () => {
  const observer = createRankingObserver();
  observer.observe(room(1, { scoreUnit: 'wins', leaderboard: [{ teamId: 'a', name: '青組', score: 1, rank: 1, totalMs: 9000 }] }), connected);
  const update = observer.observe(room(2, { scoreUnit: 'wins', leaderboard: [{ teamId: 'a', name: '青組', score: 1, rank: 1, totalMs: 8000 }] }), { ...connected, now: 3_000 });
  assert.equal(update?.kind, 'update');
  assert.match(update!.detail, /8\.0秒/);
});

test('勝利数の加点に伴う累計時間増加は通常の加点演出を維持する', () => {
  const observer = createRankingObserver();
  observer.observe(room(1, { scoreUnit: 'wins', leaderboard: [{ teamId: 'a', name: '青組', score: 1, rank: 1, totalMs: 9000 }] }), connected);
  const update = observer.observe(room(2, { scoreUnit: 'wins', leaderboard: [{ teamId: 'a', name: '青組', score: 2, rank: 1, totalMs: 18000 }] }), { ...connected, now: 3_000 });
  assert.equal(update?.kind, 'score');
  assert.match(update!.title, /\+1勝/);
});

test('100人を可変行数で重複・欠落なくページ表示し、末尾や縮小時の範囲を保つ', () => {
  const rows = Array.from({ length: 100 }, (_, index) => index + 1);
  assert.equal(rankingPageSize(230), 4);
  assert.equal(rankingPageSize(0), 1);
  assert.equal(rankingPageSize(1_000), 8);
  const visited = Array.from({ length: 25 }, (_, page) => rankingPage(rows, page, 4).rows).flat();
  assert.deepEqual(visited, rows);
  assert.deepEqual(rankingPage(rows, 200, 8), { page: 12, pages: 13, start: 96, rows: [97, 98, 99, 100] });
  assert.deepEqual(rankingPage([], 10, 4), { page: 0, pages: 1, start: 0, rows: [] });
});
