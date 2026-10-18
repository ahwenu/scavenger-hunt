import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createParticipantSoundObserver } from '../apps/cloud/app/participant/audio/participant-sound-observer.ts';
import { soundClips } from '../apps/cloud/app/participant/audio/sound-clips.ts';
import { soundClips as webClips, soundPlayer as webPlayer } from '../apps/web/sound-effects.js';

const state = (overrides = {}) => ({
  room: { id: 'room-a', name: 'テスト部屋' }, game: { status: 'playing', totalRounds: 10 },
  mode: 'demo', serverTime: 1000, lobby: { status: 'started' },
  players: [{ id: 'me', name: '自分', joinedAt: 1 }, { id: 'peer', name: 'ほかの人', joinedAt: 2 }],
  ranks: [{ id: 'me', name: '自分', joinedAt: 1, wins: 0 }, { id: 'peer', name: 'ほかの人', joinedAt: 2, wins: 0 }],
  round: { id: 'round-a', number: 1, status: 'active', mode: 'demo', challenge: { title: '赤いもの' }, startedAt: 0, endsAt: 10000 },
  mine: [], stats: { players: 2, answered: 0, accepted: 0, pending: 0 }, ...overrides,
});
const attempt = (status, id = 'submission-a', roundId = 'round-a') => ({ id, roundId, status });
const setup = () => { const played = []; return { played, sounds: createParticipantSoundObserver(name => played.push(name)) }; };

test('参加者UIは既存の11音源・音量・優先度と秒境界の観測処理を使う', async () => {
  assert.deepEqual(soundClips, webClips);
  for (const name of ['sound-events.js']) {
    assert.equal(await readFile(new URL(`../apps/cloud/app/participant/audio/${name}`, import.meta.url), 'utf8'), await readFile(new URL(`../apps/web/${name}`, import.meta.url), 'utf8'));
  }
  webPlayer.dispose();
});

test('初回と再取得では開始・過去の正解・過去の終了音を鳴らさない', () => {
  const { played, sounds } = setup();
  const initial = state({ mine: [attempt('accepted')], game: { status: 'finished', totalRounds: 10 } });
  sounds.observe(initial, 'me'); sounds.observe(initial, 'me');
  sounds.receipt('round-a', attempt('queued'));
  assert.deepEqual(played, []);
});

test('写真の受付と確定合格は各1回で、遅いACKとpollでは再演しない', () => {
  const { played, sounds } = setup();
  sounds.observe(state(), 'me');
  sounds.receipt('round-a', attempt('queued'));
  sounds.observe(state({ mine: [attempt('processing')] }), 'me');
  sounds.observe(state({ mine: [attempt('accepted')] }), 'me');
  sounds.receipt('round-a', attempt('queued'));
  sounds.receipt('round-a', attempt('accepted'));
  sounds.observe(state({ mine: [attempt('accepted')] }), 'me');
  assert.deepEqual(played, ['submit', 'success']);
});

test('pollがACKより先に確定結果を返しても古い受付音を鳴らさない', () => {
  const { played, sounds } = setup();
  sounds.observe(state(), 'me');
  sounds.observe(state({ mine: [attempt('accepted')] }), 'me');
  sounds.receipt('round-a', attempt('processing'));
  sounds.observe(state({ mine: [attempt('queued')] }), 'me');
  assert.deepEqual(played, ['success']);
});

test('不合格だけretry、技術失敗は無音で、撮り直しの合格は別の提出として鳴る', () => {
  const { played, sounds } = setup();
  sounds.observe(state(), 'me');
  for (const [index, status] of ['rejected', 'error', 'failed', 'accepted'].entries()) {
    const submission = attempt(status, `attempt-${index}`);
    sounds.receipt('round-a', submission);
    sounds.observe(state({ mine: [submission] }), 'me');
    sounds.receipt('round-a', { ...submission, status: 'queued' });
  }
  assert.deepEqual(played, ['retry', 'success']);
});

test('開始・未判定が終わった競技結果・全競技終了だけを各遷移で鳴らす', () => {
  const { played, sounds } = setup();
  sounds.observe(state({ round: null, game: { status: 'lobby', totalRounds: 10 } }), 'me');
  sounds.observe(state(), 'me'); sounds.observe(state(), 'me');
  const closed = { ...state().round, status: 'closed' };
  sounds.observe(state({ round: closed, stats: { ...state().stats, pending: 1 } }), 'me');
  sounds.observe(state({ round: closed }), 'me'); sounds.observe(state({ round: closed }), 'me');
  const finished = state({ round: closed, game: { status: 'finished', totalRounds: 10 } });
  sounds.observe(finished, 'me'); sounds.observe(finished, 'me');
  assert.deepEqual(played, ['start', 'result', 'victory']);
});

test('次の競技へ移った後の古い写真受付を無視する', () => {
  const { played, sounds } = setup();
  sounds.observe(state(), 'me');
  sounds.observe(state({ round: { ...state().round, id: 'round-b', number: 2 } }), 'me');
  sounds.receipt('round-a', attempt('accepted'));
  sounds.receipt('round-b', attempt('queued', 'submission-b', 'round-b'));
  assert.deepEqual(played, ['start', 'submit']);
});

test('部屋・参加者の切替とreset後は届いた状態を新しい基準にする', () => {
  const { played, sounds } = setup();
  sounds.observe(state(), 'me');
  sounds.observe(state({ room: { id: 'room-b', name: '別の部屋' }, mine: [attempt('accepted')] }), 'me');
  sounds.observe(state({ mine: [attempt('accepted')] }), 'peer');
  sounds.reset(); sounds.receipt('round-a', attempt('accepted'));
  sounds.observe(state({ mine: [attempt('accepted')] }), 'me');
  assert.deepEqual(played, []);
});

test('音の再開・画面復帰後に基準から新しく確定した結果は鳴らす', () => {
  const { played, sounds } = setup();
  sounds.observe(state(), 'me'); sounds.reset();
  sounds.observe(state({ mine: [attempt('processing')] }), 'me');
  sounds.observe(state({ mine: [attempt('accepted')] }), 'me');
  assert.deepEqual(played, ['success']);
});

test('残り5秒は秒境界ごとに鳴り、飛ばした秒や初回の残秒を追いかけない', () => {
  const { played, sounds } = setup(); const current = state();
  sounds.observe(current, 'me');
  for (const now of [4000, 5000, 5200, 6000, 8000, 9000, 10000, 11000]) sounds.tick(current, 'me', now);
  assert.deepEqual(played, ['tick', 'tick', 'tick', 'timeup']);
  sounds.reset(); sounds.observe(current, 'me'); sounds.tick(current, 'me', 9000);
  assert.equal(played.length, 4);
});

test('本人合格・ゲーム終了・未参加ではカウント音を停止する', () => {
  for (const condition of ['accepted', 'finished', 'unjoined']) {
    const { played, sounds } = setup(); const current = state();
    sounds.observe(current, 'me'); sounds.tick(current, 'me', 4000);
    if (condition === 'accepted') sounds.receipt('round-a', attempt('accepted'));
    const next = condition === 'finished' ? state({ game: { status: 'finished', totalRounds: 10 } }) : current;
    sounds.tick(next, condition === 'unjoined' ? '' : 'me', 5000);
    sounds.tick(next, condition === 'unjoined' ? '' : 'me', 10000);
    assert.deepEqual(played, condition === 'accepted' ? ['success'] : []);
  }
});

test('複数人の合格増分は1回の小さい通知へまとめ、古いrevisionでは鳴らさない', () => {
  const { played, sounds } = setup(); const initial = state({ revision: 2 });
  initial.ranks.push({ id: 'peer2', name: '別の人', joinedAt: 3, wins: 0 });
  sounds.observe(initial, 'me');
  const changed = state({ revision: 3, ranks: initial.ranks.map(player => ({ ...player, wins: 1 })) });
  sounds.observe(changed, 'me'); sounds.observe(changed, 'me');
  sounds.observe(state({ revision: 1, mine: [attempt('accepted')] }), 'me');
  assert.deepEqual(played, ['peer']);
});
