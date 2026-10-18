import { soundClips, type ParticipantSoundName } from './sound-clips';

type AudioEnvironment = {
  Audio: typeof Audio;
  Date: Pick<typeof Date, 'now'>;
  document?: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;
  localStorage?: Pick<Storage, 'getItem' | 'setItem'>;
  navigator?: { audioSession?: { type: string } };
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
};

/** 参加者の音はメディア再生経路へ揃える。最初の操作で同じ3要素を起動し、以後も再利用する。 */
export function createParticipantAudio(environment: AudioEnvironment = globalThis as unknown as AudioEnvironment) {
  let enabled = true;
  try { enabled = environment.localStorage?.getItem('karimono:sound') !== 'off'; } catch { /* 保存できない端末でも操作可能。 */ }
  let activated = false, disposed = false, effectTicket = 0, voiceTicket = 0;
  let foreground: { priority: number; until: number } | null = null;
  let voiceTimer: ReturnType<typeof setTimeout> | undefined;
  let effectTimer: ReturnType<typeof setTimeout> | undefined;
  const lastPlayed = new Map<string, number>();
  const listeners = new Set<() => void>();
  const bgm = new environment.Audio('/audio/game-loop.mp3');
  const speech = new environment.Audio('/audio/welcome-ja.mp3');
  const effect = new environment.Audio(soundClips.tap.src);
  bgm.loop = true; bgm.volume = .16;
  speech.volume = .78;
  speech.defaultPlaybackRate = .85;
  speech.playbackRate = .85;
  speech.preservesPitch = true;
  for (const audio of [bgm, speech, effect]) audio.preload = 'auto';
  const visible = () => !environment.document?.hidden;
  const allowed = () => enabled && activated && visible() && !disposed;
  const notify = () => { for (const listener of listeners) listener(); };

  function playbackSession() {
    try {
      if (environment.navigator?.audioSession) environment.navigator.audioSession.type = 'playback';
    } catch { /* 未対応ブラウザではHTMLAudioのメディア経路を使う。 */ }
  }

  function stopVoice() {
    voiceTicket++;
    environment.clearTimeout(voiceTimer); voiceTimer = undefined;
    speech.pause(); bgm.volume = .16;
  }

  function stopEffects() {
    effectTicket++; foreground = null;
    environment.clearTimeout(effectTimer); effectTimer = undefined;
    effect.pause();
  }

  function pause() { bgm.pause(); stopVoice(); stopEffects(); }

  function speak(path: string, delay = 0) {
    stopVoice();
    if (!allowed()) return;
    const ticket = voiceTicket;
    const due = environment.Date.now() + delay;
    const start = () => {
      if (!allowed() || ticket !== voiceTicket || environment.Date.now() - due > 900) return;
      speech.src = path; speech.currentTime = 0; speech.playbackRate = .85; bgm.volume = .07;
      const requestedAt = environment.Date.now();
      // 端末や回線の遅れで古いセリフが後から鳴ることを防ぐ。
      voiceTimer = environment.setTimeout(() => { if (ticket === voiceTicket) stopVoice(); }, 1200);
      void speech.play().then(() => {
        if (ticket !== voiceTicket) return;
        if (!allowed() || environment.Date.now() - requestedAt > 1200) { stopVoice(); return; }
        environment.clearTimeout(voiceTimer);
      }).catch(() => { if (ticket === voiceTicket) stopVoice(); });
    };
    if (delay) voiceTimer = environment.setTimeout(start, delay);
    else start();
  }

  function playEffect(name: ParticipantSoundName): Promise<boolean> {
    if (!allowed()) return Promise.resolve(false);
    const clip = soundClips[name], now = environment.Date.now();
    if (now - (lastPlayed.get(name) ?? -Infinity) < (clip.cooldown ?? 120)) return Promise.resolve(false);
    if (foreground && foreground.until > now && foreground.priority > (clip.priority ?? 1)) return Promise.resolve(false);
    stopEffects();
    const ticket = effectTicket;
    foreground = { priority: clip.priority ?? 1, until: now + 5000 };
    lastPlayed.set(name, now);
    effect.src = clip.src; effect.currentTime = 0; effect.volume = (clip.volume ?? 1) * .65;
    effectTimer = environment.setTimeout(() => { if (ticket === effectTicket) stopEffects(); }, 900);
    return effect.play().then(() => {
      if (ticket !== effectTicket) return false;
      if (!allowed() || environment.Date.now() - now > 900) { stopEffects(); return false; }
      environment.clearTimeout(effectTimer);
      return true;
    }).catch(() => {
      if (ticket === effectTicket) stopEffects();
      return false;
    });
  }

  /** awaitより前に3要素のplayを呼ぶ。Safariのユーザー操作の範囲を保つ。 */
  function activate(welcome = '/audio/welcome-ja.mp3') {
    if (!enabled || disposed || !visible()) return;
    playbackSession();
    void bgm.play().catch(() => {});
    if (activated) return;
    activated = true;
    void playEffect('tap');
    speak(welcome);
    notify();
  }

  function setEnabled(value: boolean) {
    enabled = value;
    try { environment.localStorage?.setItem('karimono:sound', value ? 'on' : 'off'); } catch { /* 設定保存を必須にしない。 */ }
    if (!value) { pause(); activated = false; }
    notify();
  }

  function visibility() {
    pause();
    if (allowed()) { playbackSession(); void bgm.play().catch(() => {}); }
  }
  speech.onended = () => { bgm.volume = .16; };
  effect.onended = () => { foreground = null; };
  environment.document?.addEventListener('visibilitychange', visibility);

  return {
    activate, setEnabled, speak, stopVoice, pause, playEffect,
    getState: () => ({ enabled, activated }),
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() {
      disposed = true; pause(); listeners.clear();
      environment.document?.removeEventListener('visibilitychange', visibility);
      for (const audio of [bgm, speech, effect]) { audio.onended = null; audio.removeAttribute('src'); audio.load(); }
    },
  };
}
