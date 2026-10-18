export interface SoundClip { src: string; priority?: number; volume?: number; cooldown?: number }

// apps/web/sound-effects.js と同じ同梱素材・優先度・音量を使う。
const clip = (file: string, priority: number, volume = 1, cooldown = 120): SoundClip => ({ src: `/sounds/${file}`, priority, volume, cooldown });

export const soundClips = {
  tap: clip('tap_Quiz-Button03-2.mp3', 1, .6),
  submit: clip('submit_Quiz-Button03-1.mp3', 2, .8),
  join: clip('join_Onoma-Sparkle13-5.mp3', 2, .9, 1400),
  ready: clip('join_Onoma-Sparkle13-5.mp3', 3),
  shutter: clip('shutter_Camera-Compact01-01.mp3', 3),
  start: clip('start_Quiz-Question02-3.mp3', 5),
  success: clip('success_Quiz-Ding_Dong05-2.mp3', 6, 1, 1400),
  retry: clip('retry_Quiz-Buzzer05-2.mp3', 4, .75),
  peer: clip('join_Onoma-Sparkle13-5.mp3', 1, .45, 2200),
  tick: clip('tick_Countdown06-5.mp3', 0, .6, 750),
  timeup: clip('timeup_Countdown06-1.mp3', 4, .8),
  result: clip('result_Quiz-Results01-1.mp3', 7),
  victory: clip('victory_yattaze1.mp3', 8),
};

export type ParticipantSoundName = keyof typeof soundClips;
