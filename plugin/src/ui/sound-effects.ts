/** OtoLogic素材をHTMLへ埋め込む。セット別に長さ・音量を調整済み。 */
import { createSoundPlayer } from './sound-engine.js';
import tap from './assets/sounds/tap_Quiz-Button03-2.mp3';
import submit from './assets/sounds/submit_Quiz-Button03-1.mp3';
import join from './assets/sounds/join_Onoma-Sparkle13-5.mp3';
import shutter from './assets/sounds/shutter_Camera-Compact01-01.mp3';
import start from './assets/sounds/start_Quiz-Question02-3.mp3';
import success from './assets/sounds/success_Quiz-Ding_Dong05-2.mp3';
import retry from './assets/sounds/retry_Quiz-Buzzer05-2.mp3';
import tick from './assets/sounds/tick_Countdown06-5.mp3';
import timeup from './assets/sounds/timeup_Countdown06-1.mp3';
import result from './assets/sounds/result_Quiz-Results01-1.mp3';
import victory from './assets/sounds/victory_yattaze1.mp3';

export const hostSounds = createSoundPlayer({
  tap: { src: tap, priority: 1, volume: .6 },
  submit: { src: submit, priority: 2, volume: .8 },
  join: { src: join, priority: 2, volume: .9, cooldown: 1400 },
  ready: { src: join, priority: 3 },
  shutter: { src: shutter, priority: 3 },
  start: { src: start, priority: 5 },
  success: { src: success, priority: 6, cooldown: 1400 },
  retry: { src: retry, priority: 4, volume: .75 },
  tick: { src: tick, priority: 0, volume: .6, cooldown: 750 },
  timeup: { src: timeup, priority: 4, volume: .8 },
  result: { src: result, priority: 7 },
  victory: { src: victory, priority: 8 },
});
