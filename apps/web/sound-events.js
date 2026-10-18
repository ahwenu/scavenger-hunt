/** 定期同期を操作音へ変換する。最初の取得・部屋復帰では過去の演出を再生しない。 */
export function createGameSoundObserver(play) {
  let previous = null, clock = null;
  const ticked = new Set();
  return {
    /** DTOの差分だけで音を決め、得点・進行の正本は変更しない。 */
    observe(next) {
      if (!next) { previous = null; clock = null; ticked.clear(); return; }
      const before = previous;
      previous = next;
      if (!before || before.roomId !== next.roomId) { clock = null; ticked.clear(); return; }
      if (next.phase === 'finished' && before.phase !== 'finished') { play('victory'); return; }
      if (next.phase === 'active' && (before.roundId !== next.roundId || before.phase !== 'active')) { play('start'); return; }
      if (next.phase === 'result' && (before.roundId !== next.roundId || before.phase !== 'result')) { play('result'); return; }
      if (next.scores?.some(item => item.score > (before.scores?.find(old => old.id === item.id)?.score ?? item.score))) { play('success'); return; }
      if (next.ready && !before.ready) { play('ready'); return; }
      if (next.participants?.some(id => !before.participants?.includes(id))) play('join');
    },
    /** 残り5秒は各秒1回。初回・時刻補正・復帰で鳴り損ねた秒は再生しない。 */
    tick(key, deadline, now) {
      const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
      if (!key || !Number.isFinite(seconds)) { clock = null; return; }
      const before = clock;
      clock = { key, seconds };
      if (before?.key !== key) { ticked.clear(); return; }
      if (seconds >= before.seconds || before.seconds - seconds > 1 || seconds > 5) return;
      if (ticked.has(seconds)) return;
      ticked.add(seconds);
      if (seconds > 0) play('tick');
      else if (key.startsWith('round:')) play('timeup');
    },
  };
}
