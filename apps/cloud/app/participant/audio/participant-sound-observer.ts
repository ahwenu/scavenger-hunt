import type { GameState, SubmissionReceipt } from '../api';
import type { ParticipantSoundName } from './sound-clips';
import { createGameSoundObserver } from './sound-events.js';

const pending = new Set(['uploading', 'queued', 'processing', 'retrying', 'pending']);
type TerminalSound = 'success' | 'retry' | 'silent';
const terminalSound = (status: string): TerminalSound | null => status === 'accepted' ? 'success' : status === 'rejected' ? 'retry' : ['error', 'failed'].includes(status) ? 'silent' : null;
type SubmissionSound = { submitted: boolean; terminal: TerminalSound | null };
type Snapshot = { roomId: string; playerId: string; roundId: string; phase: string; revision?: number; wins: Map<string, number> };

/** 画面の再描画ではなく、サーバーから確認できた変化だけを効果音へ変換する。 */
export function createParticipantSoundObserver(play: (name: ParticipantSoundName) => void) {
  let previous: Snapshot | null = null;
  const submissions = new Map<string, SubmissionSound>();
  const acceptedRounds = new Set<string>();
  const clock = createGameSoundObserver(name => { if (name === 'tick' || name === 'timeup') play(name); });

  function reset() {
    previous = null;
    submissions.clear();
    acceptedRounds.clear();
    clock.observe(null);
  }

  function phase(state: GameState): string {
    if (state.game?.status === 'finished') return 'finished';
    if (state.round?.status === 'active') return 'active';
    if (state.round?.status === 'closed' && state.stats.pending === 0) return 'result';
    return 'waiting';
  }

  function submission(roundId: string, receipt: SubmissionReceipt, silent = false) {
    const key = JSON.stringify([roundId, receipt.id]);
    const before = submissions.get(key);
    // 終端を確認した後に、遅れた受付ACKや同じ結果で演出を巻き戻さない。
    if (before?.terminal) return;
    const terminal = terminalSound(receipt.status);
    if (terminal) {
      submissions.set(key, { submitted: true, terminal });
      if (terminal === 'success') acceptedRounds.add(roundId);
      if (!silent && terminal !== 'silent') play(terminal);
      return;
    }
    if (pending.has(receipt.status)) {
      submissions.set(key, { submitted: true, terminal: null });
      if (!silent && !before?.submitted) play('submit');
    }
  }

  function observe(state: GameState | null, playerId: string) {
    if (!state || !playerId || !state.players.some(player => player.id === playerId)) { reset(); return; }
    const snapshot: Snapshot = {
      roomId: state.room.id, playerId, roundId: state.round?.id ?? '', phase: phase(state), revision: state.revision,
      wins: new Map(state.ranks.map(player => [player.id, player.wins ?? 0])),
    };
    const before = previous;
    const baseline = !before || before.roomId !== snapshot.roomId || before.playerId !== playerId;
    if (!baseline && typeof snapshot.revision === 'number' && typeof before.revision === 'number' && snapshot.revision < before.revision) return;
    if (baseline) reset();
    previous = snapshot;

    const own = state.mine.filter(item => item.roundId === snapshot.roundId);
    for (const item of own) submission(item.roundId, item, baseline);
    if (baseline) return;

    // 低い優先度から渡し、最後の結果・終了音を再生エンジンが優先できるようにする。
    if (state.ranks.some(player => player.id !== playerId && (player.wins ?? 0) > (before.wins.get(player.id) ?? player.wins ?? 0))) play('peer');
    if (snapshot.phase === 'finished' && before.phase !== 'finished') play('victory');
    else if (snapshot.phase === 'active' && (snapshot.roundId !== before.roundId || before.phase !== 'active')) play('start');
    else if (snapshot.phase === 'result' && (snapshot.roundId !== before.roundId || before.phase !== 'result')) play('result');
  }

  function receipt(roundId: string, value: SubmissionReceipt) {
    if (!previous || previous.roundId !== roundId || !roundId) return;
    submission(roundId, value);
  }

  function tick(state: GameState | null, playerId: string, nowMs: number) {
    const round = state?.round;
    const current = previous && state?.room.id === previous.roomId && playerId === previous.playerId && round?.id === previous.roundId;
    const accepted = round && (state?.mine.some(item => item.roundId === round.id && item.status === 'accepted') || acceptedRounds.has(round.id));
    if (!current || !round || round.status !== 'active' || state?.game?.status === 'finished' || accepted) {
      clock.tick(null, NaN, nowMs);
      return;
    }
    clock.tick(`round:${state.room.id}:${playerId}:${round.id}`, round.endsAt, nowMs);
  }

  return { observe, receipt, tick, reset };
}
