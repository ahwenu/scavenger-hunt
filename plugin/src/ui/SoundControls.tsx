/** 再生許可と端末別の消音設定、無料素材のクレジットを表示する。 */
import { useSyncExternalStore } from 'react';
import { hostSounds } from './sound-effects.js';

/** 音声許可の取得と即時ミュートを切り替える。 */
export function SoundToggle() {
  const state = useSyncExternalStore(hostSounds.subscribe, hostSounds.getState);
  /** OFF操作で再生を止め、ON操作はブラウザの再生許可も取り直す。 */
  async function toggle() {
    if (state.enabled && state.unlocked) hostSounds.setEnabled(false);
    else {
      hostSounds.setEnabled(true);
      if (await hostSounds.unlock()) void hostSounds.play('ready');
    }
  }
  return <button type="button" className="sound-toggle" aria-pressed={state.enabled && state.unlocked} onClick={() => void toggle()}>
    {!state.enabled ? '🔇 音 OFF' : state.unlocked ? '🔊 音 ON' : '🔊 音を有効にする'}
  </button>;
}

/** 配布HTMLだけでも作者・ライセンス・加工の有無を確認できる。 */
export function SoundCredits() {
  return <details className="sound-credits"><summary>効果音クレジット</summary><p>
    効果音・ジングル：<a href="https://otologic.jp/" target="_blank" rel="noreferrer">OtoLogic</a>（<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>）。長さ・音量の調整、フェード、モノラルMP3化を行っています。
  </p></details>;
}
