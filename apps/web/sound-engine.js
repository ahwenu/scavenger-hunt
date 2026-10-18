/** OtoLogicの加工済み素材を、ユーザー操作・消音・優先度に従って再生する。 */
export function createSoundPlayer(clips, environment = globalThis) {
  let enabled = true, context = null, active = null, sequence = 0, foreground = null;
  const buffers = new Map(), lastPlayed = new Map(), listeners = new Set();
  try { enabled = environment.localStorage?.getItem('karimono:sound') !== 'off'; } catch { /* 保存不可でも操作できる。 */ }
  let snapshot = { enabled, unlocked: false };

  /** 同じ状態オブジェクトを保持し、実際に変わった時だけ画面へ通知する。 */
  function notify() {
    const unlocked = context?.state === 'running';
    if (snapshot.enabled === enabled && snapshot.unlocked === unlocked) return;
    snapshot = { enabled, unlocked };
    for (const listener of listeners) listener();
  }

  /** 再生中・読み込み中の音を破棄し、復帰後に遅れて鳴らさない。 */
  function stop() {
    sequence++; foreground = null;
    const source = active;
    active = null;
    if (source) { try { source.stop(); } catch { /* 終了済み。 */ } source.disconnect(); }
  }

  /** 同一オリジンMP3と、拡張に同梱したdata URLの両方を復号する。失敗は再試行できる。 */
  function load(src) {
    if (!buffers.has(src)) {
      const pending = (async () => {
        let bytes;
        if (src.startsWith('data:')) {
          const binary = environment.atob(src.slice(src.indexOf(',') + 1));
          bytes = Uint8Array.from(binary, character => character.charCodeAt(0)).buffer;
        } else {
          const response = await environment.fetch(src);
          if (!response.ok) throw new Error('効果音を取得できません。');
          bytes = await response.arrayBuffer();
        }
        return context.decodeAudioData(bytes);
      })().catch(error => { buffers.delete(src); throw error; });
      buffers.set(src, pending);
    }
    return buffers.get(src);
  }

  /** 必ずクリック等から呼び、SafariのAudioContextも先に再開する。 */
  async function unlock() {
    if (!enabled) return false;
    try {
      const Audio = environment.AudioContext || environment.webkitAudioContext;
      if (!Audio) return false;
      if (!context) { context = new Audio(); context.onstatechange = notify; }
      if (context.state !== 'running') await context.resume();
      notify();
      if (context.state !== 'running') return false;
      for (const clip of Object.values(clips)) void load(clip.src).catch(() => {});
      return true;
    } catch { notify(); return false; }
  }

  /** 重要な音を一つだけ鳴らし、連打・通知集中・遅延復号による重なりを抑える。 */
  async function play(name) {
    const clip = clips[name], now = environment.Date.now();
    if (!clip || !enabled || context?.state !== 'running' || environment.document?.hidden) return false;
    if (now - (lastPlayed.get(name) ?? -Infinity) < (clip.cooldown ?? 120)) return false;
    const priority = clip.priority ?? 1;
    if (foreground && foreground.until > now && foreground.priority > priority) return false;
    lastPlayed.set(name, now);
    const ticket = ++sequence;
    foreground = { priority, until: now + 900 };
    try {
      const buffer = await load(clip.src);
      if (ticket !== sequence || !enabled || context.state !== 'running' || environment.document?.hidden || environment.Date.now() - now > 900) {
        if (ticket === sequence) foreground = null;
        return false;
      }
      const previous = active;
      active = null;
      if (previous) { previous.stop(); previous.disconnect(); }
      const source = context.createBufferSource(), gain = context.createGain();
      source.buffer = buffer;
      gain.gain.value = (clip.volume ?? 1) * 0.65;
      source.connect(gain); gain.connect(context.destination);
      active = source;
      foreground = { priority, until: environment.Date.now() + buffer.duration * 1000 };
      source.onended = () => {
        source.disconnect(); gain.disconnect();
        if (active === source) { active = null; if (ticket === sequence) foreground = null; }
      };
      source.start();
      return true;
    } catch { if (ticket === sequence) foreground = null; return false; }
  }

  /** 端末の設定を保存し、OFFにした瞬間に演出を止める。 */
  function setEnabled(value) {
    enabled = value;
    if (!enabled) stop();
    try { environment.localStorage?.setItem('karimono:sound', enabled ? 'on' : 'off'); } catch { /* 保存不可でも切替可能。 */ }
    notify();
  }

  /** 非表示になった瞬間に音を止める。 */
  function visibility() { if (environment.document?.hidden) stop(); }
  environment.document?.addEventListener('visibilitychange', visibility);
  environment.addEventListener?.('pagehide', stop);
  return {
    unlock, play, stop, setEnabled,
    getState: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    /** 画面を破棄したときにイベントと音声リソースを解放する。 */
    dispose() {
      stop(); listeners.clear();
      environment.document?.removeEventListener('visibilitychange', visibility);
      environment.removeEventListener?.('pagehide', stop);
      if (context) { context.onstatechange = null; void context.close().catch(() => {}); }
    },
  };
}
