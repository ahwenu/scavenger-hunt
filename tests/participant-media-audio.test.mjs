import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { soundClips } from '../apps/cloud/app/participant/audio/sound-clips.ts';

// Cloudの通常ビルドと同じTypeScriptで実ソースを読み、ブラウザ境界だけ置き換える。
const cloudRequire = createRequire(new URL('../apps/cloud/package.json', import.meta.url));
const ts = cloudRequire('typescript');
const module = { exports: {} };
const source = readFileSync(new URL('../apps/cloud/app/participant/audio/media-audio.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
new Function('require', 'module', 'exports', compiled.outputText)(name => {
  assert.equal(name, './sound-clips'); return { soundClips };
}, module, module.exports);
const { createParticipantAudio } = module.exports;

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

/** Audioの操作履歴とタイマーを記録する。端末の実出音や消音スイッチを模擬しない。 */
function harness({ saved = null, storageThrows = false, sessionThrows = false } = {}) {
  let now = 1000, nextTimer = 1;
  const elements = [], calls = [], timers = new Map(), events = new Map(), settings = new Map();
  const environment = {
    Date: { now: () => now },
    Audio: class {
      constructor(src) { this.src = src; this.currentTime = 0; this.volume = 1; this.paused = true; this.loads = 0; this.behaviors = []; elements.push(this); }
      play() { this.paused = false; calls.push({ element: this, src: this.src }); return this.behaviors.shift()?.() ?? Promise.resolve(); }
      pause() { this.paused = true; }
      removeAttribute(name) { if (name === 'src') this.src = ''; }
      load() { this.loads++; }
      end() { this.paused = true; this.onended?.(); }
    },
    document: { hidden: false, addEventListener: (event, handler) => events.set(event, handler), removeEventListener: event => events.delete(event) },
    localStorage: { getItem() { if (storageThrows) throw Error('storage denied'); return saved; }, setItem(key, value) { if (storageThrows) throw Error('storage denied'); settings.set(key, value); } },
    navigator: { audioSession: sessionThrows ? { set type(_) { throw Error('not supported'); } } : { type: 'auto' } },
    setTimeout(callback, delay = 0) { const id = nextTimer++; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const player = createParticipantAudio(environment);
  return {
    player, environment, elements, calls, timers, events, settings,
    advance(ms, run = true) {
      now += ms;
      if (!run) return;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= now).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]); due[1].callback();
      }
    },
    visible(value) { environment.document.hidden = !value; events.get('visibilitychange')?.(); },
  };
}

async function active(options) {
  const h = harness(options); h.player.activate(); await flush();
  h.elements[2].end(); h.advance(1500); h.calls.length = 0;
  return h;
}

test('初期ONは最初の操作でBGM・声・SEを同期に起動し同じ3要素を再利用する', async () => {
  const h = harness();
  assert.deepEqual(h.player.getState(), { enabled: true, activated: false });
  assert.equal(h.calls.length, 0);
  h.player.activate();
  assert.equal(h.calls.length, 3);
  assert.equal(new Set(h.calls.map(call => call.element)).size, 3);
  assert.equal(h.elements[0].loop, true);
  assert.equal(h.environment.navigator.audioSession.type, 'playback');
  await flush(); h.elements[2].end(); h.advance(1500);
  await h.player.playEffect('success'); h.player.speak('/audio/success-ja.mp3'); h.player.activate();
  assert.equal(h.elements.length, 3);
  assert.equal(h.elements[0].src, '/audio/game-loop.mp3');
  assert.equal(h.elements[1].src, '/audio/success-ja.mp3');
  assert.equal(h.elements[1].defaultPlaybackRate, .85);
  assert.equal(h.elements[1].playbackRate, .85);
  assert.equal(h.elements[1].preservesPitch, true);
  assert.equal(h.elements[2].src, soundClips.success.src);
});

test('保存済みOFFを守り、ONにする操作で再生可能になる', async () => {
  const h = harness({ saved: 'off' });
  h.player.activate();
  assert.deepEqual(h.player.getState(), { enabled: false, activated: false });
  assert.equal(await h.player.playEffect('success'), false);
  assert.equal(h.calls.length, 0);
  h.player.setEnabled(true); h.player.activate();
  assert.equal(h.calls.length, 3);
  assert.equal(h.settings.get('karimono:sound'), 'on');
  await flush();
});

test('音源優先度と連打間隔で成功音を小さい操作音や同じ通知から守る', async () => {
  const h = await active();
  assert.equal(await h.player.playEffect('success'), true);
  assert.equal(await h.player.playEffect('tap'), false);
  assert.equal(await h.player.playEffect('tick'), false);
  assert.equal(await h.player.playEffect('success'), false);
  assert.equal(h.calls.length, 1);
  h.elements[2].end();
  assert.equal(await h.player.playEffect('tap'), true);
  assert.equal(h.elements[2].volume, soundClips.tap.volume * .65);
});

test('遅いSEは900msで停止し、優先度の高い次の音を古い完了で止めない', async () => {
  const h = await active(); const waiting = deferred();
  h.elements[2].behaviors.push(() => waiting.promise);
  const stale = h.player.playEffect('tap');
  h.advance(901); assert.equal(h.elements[2].paused, true);
  await h.player.playEffect('success');
  waiting.resolve(); assert.equal(await stale, false);
  assert.equal(h.elements[2].src, soundClips.success.src);
  assert.equal(h.elements[2].paused, false);
});

test('タイマー処理が遅れても900msを越えたSE完了を再生済みとして受け取らない', async () => {
  const h = await active(); const waiting = deferred();
  h.elements[2].behaviors.push(() => waiting.promise);
  const pending = h.player.playEffect('tap');
  h.advance(901, false); waiting.resolve();
  assert.equal(await pending, false);
  assert.equal(h.elements[2].paused, true);
});

test('OFFは3経路と待機中の声を停止し、遅い完了でも再開しない', async () => {
  const h = await active(); const waiting = deferred();
  h.elements[2].behaviors.push(() => waiting.promise);
  const pending = h.player.playEffect('success'); h.player.speak('/later.mp3', 1000);
  h.player.setEnabled(false); waiting.resolve(); await pending; h.advance(2000);
  assert.equal(h.elements.every(element => element.paused), true);
  assert.deepEqual(h.player.getState(), { enabled: false, activated: false });
  assert.equal(h.settings.get('karimono:sound'), 'off');
  assert.equal(h.calls.some(call => call.src === '/later.mp3'), false);
});

test('非表示で全音を止め、復帰はBGMだけ再開して声や効果音を追いかけない', async () => {
  const h = await active();
  h.player.speak('/later.mp3', 600); h.visible(false); h.advance(1000);
  assert.equal(await h.player.playEffect('success'), false);
  assert.equal(h.elements.every(element => element.paused), true);
  h.calls.length = 0; h.visible(true);
  assert.deepEqual(h.calls.map(call => call.element), [h.elements[0]]);
});

test('遅延する声は停止・差替でき、1200ms待っても開始しない声を捨てる', async () => {
  const h = await active();
  h.player.speak('/stale.mp3', 500); h.player.speak('/current.mp3', 100);
  h.advance(100); await flush(); h.advance(500);
  assert.equal(h.calls.some(call => call.src === '/stale.mp3'), false);
  assert.equal(h.elements[1].src, '/current.mp3');
  assert.equal(h.elements[0].volume, .07); h.elements[1].end(); assert.equal(h.elements[0].volume, .16);
  const waiting = deferred(); h.elements[1].behaviors.push(() => waiting.promise);
  h.player.speak('/slow.mp3'); h.advance(1201); waiting.resolve(); await flush();
  assert.equal(h.elements[1].paused, true); assert.equal(h.elements[0].volume, .16);
});

test('タイマー処理が遅れても1200msを越えた声の開始を止める', async () => {
  const h = await active(); const waiting = deferred();
  h.elements[1].behaviors.push(() => waiting.promise);
  h.player.speak('/slow.mp3'); h.advance(1201, false); waiting.resolve(); await flush();
  assert.equal(h.elements[1].paused, true); assert.equal(h.elements[0].volume, .16);
});

test('再生拒否・保存拒否・AudioSession非対応で操作処理を中断しない', async () => {
  const h = harness({ storageThrows: true, sessionThrows: true });
  for (const element of h.elements) element.behaviors.push(() => Promise.reject(Error('autoplay denied')));
  assert.doesNotThrow(() => h.player.activate()); await flush();
  h.elements[2].behaviors.push(() => Promise.reject(Error('network failed')));
  assert.equal(await h.player.playEffect('success'), false);
  assert.doesNotThrow(() => h.player.setEnabled(false));
});

test('破棄はイベント・待機・音源を解放し、その後の操作で再生しない', async () => {
  const h = await active(); let notifications = 0;
  h.player.subscribe(() => notifications++);
  h.player.speak('/later.mp3', 600); h.player.dispose();
  assert.equal(h.events.size, 0); assert.equal(h.timers.size, 0);
  assert.equal(h.elements.every(element => element.paused && !element.src && element.loads === 1), true);
  h.player.activate(); h.player.setEnabled(true); h.player.speak('/late.mp3'); h.advance(2000);
  assert.equal(await h.player.playEffect('success'), false);
  assert.equal(h.calls.length, 0); assert.equal(notifications, 0);
});
