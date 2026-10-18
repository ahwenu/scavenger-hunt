/** 音声・定期同期・配布資産の境界を検証し、採点APIは使わない。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createSoundPlayer } from '../apps/web/sound-engine.js';
import { createGameSoundObserver } from '../apps/web/sound-events.js';
import { soundClips } from '../apps/web/sound-effects.js';

/** 実際の再生要求と停止、保存、可視状態を観測する最小のブラウザ境界。 */
function audioHarness({ saved = null, fetchAudio } = {}) {
  const sources = [], settings = new Map(), events = new Map();
  let now = 1000, contexts = 0;
  const environment = {
    Date: { now: () => now },
    document: { hidden: false, addEventListener: (name, handler) => events.set(name, handler), removeEventListener: name => events.delete(name) },
    localStorage: { getItem: () => saved, setItem: (key, value) => settings.set(key, value) },
    fetch: fetchAudio || (async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(2) })),
    AudioContext: class {
      constructor() { contexts++; this.state = 'suspended'; }
      async resume() { this.state = 'running'; }
      async decodeAudioData() { return { duration: .5 }; }
      createGain() { return { gain: {}, connect() {}, disconnect() {} }; }
      createBufferSource() {
        const source = { started: false, stopped: false, connect() {}, disconnect() {}, start() { this.started = true; }, stop() { this.stopped = true; this.onended?.(); } };
        sources.push(source); return source;
      }
      async close() { this.state = 'closed'; }
    },
  };
  const player = createSoundPlayer({ tap: { src: '/tap.mp3', priority: 1 }, success: { src: '/success.mp3', priority: 6 }, tick: { src: '/tick.mp3', priority: 0 } }, environment);
  return { player, sources, environment, settings, events, advance(ms) { now += ms; }, get contexts() { return contexts; } };
}

test('音は操作による許可取得後だけ再生し、保存済みOFFは許可取得も止める', async () => {
  const h = audioHarness();
  assert.equal(await h.player.play('success'), false);
  assert.equal(h.contexts, 0);
  assert.equal(await h.player.unlock(), true);
  assert.equal(await h.player.play('success'), true);
  assert.equal(h.sources.filter(source => source.started).length, 1);
  const muted = audioHarness({ saved: 'off' });
  assert.equal(await muted.player.unlock(), false);
  assert.equal(await muted.player.play('success'), false);
  assert.equal(muted.contexts, 0);
});

test('消音とバックグラウンド移行は音を直ちに止める', async () => {
  const h = audioHarness(); await h.player.unlock(); await h.player.play('tap');
  h.player.setEnabled(false);
  assert.equal(h.sources[0].stopped, true);
  assert.equal(h.settings.get('karimono:sound'), 'off');
  h.advance(1000); h.player.setEnabled(true); await h.player.play('tap');
  h.environment.document.hidden = true; h.events.get('visibilitychange')();
  assert.equal(h.sources[1].stopped, true);
  assert.equal(await h.player.play('success'), false);
});

test('大量通知でも正解音をクリックやカウント音で中断せず、同時再生しない', async () => {
  const h = audioHarness(); await h.player.unlock(); await h.player.play('success');
  assert.equal(await h.player.play('tap'), false);
  assert.equal(await h.player.play('tick'), false);
  assert.equal(await h.player.play('success'), false);
  assert.equal(h.sources.length, 1);
  h.advance(600); assert.equal(await h.player.play('tap'), true);
  assert.equal(h.sources[0].stopped, true);
});

test('遅い音源の読み込みが消音後や900ms以降に完了しても鳴らさない', async () => {
  let resolve;
  const h = audioHarness({ fetchAudio: () => new Promise(done => { resolve = done; }) });
  // 1音だけにして、取得の遅延を実際の復号境界へ入れる。
  const player = createSoundPlayer({ tap: { src: '/slow.mp3' } }, h.environment);
  await player.unlock(); const pending = player.play('tap');
  h.advance(1000); resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(2) });
  assert.equal(await pending, false); assert.equal(h.sources.length, 0);
  h.advance(1000); const muted = player.play('tap'); player.setEnabled(false);
  assert.equal(await muted, false); assert.equal(h.sources.length, 0);
});

test('音源取得失敗・AudioContext非対応・storage拒否でも操作を例外で止めない', async () => {
  const h = audioHarness({ fetchAudio: async () => ({ ok: false }) });
  await h.player.unlock(); assert.equal(await h.player.play('tap'), false);
  const unavailable = createSoundPlayer({}, { Date, localStorage: { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } } });
  assert.equal(await unavailable.unlock(), false);
  assert.doesNotThrow(() => unavailable.setEnabled(false));
});

test('初回/部屋復帰は無音、同じ定期応答は無音、開始・加点・結果・全競技終了は各1回', () => {
  const played = [], observer = createGameSoundObserver(name => played.push(name));
  let state = { roomId: 'a', phase: 'lobby', ready: false, participants: [], scores: [{ id: 'one', score: 0 }] };
  observer.observe(state); observer.observe(state);
  state = { ...state, participants: ['one'] }; observer.observe(state); observer.observe(state);
  state = { ...state, ready: true }; observer.observe(state);
  state = { ...state, phase: 'active', roundId: 'r1' }; observer.observe(state); observer.observe(state);
  state = { ...state, scores: [{ id: 'one', score: 500 }] }; observer.observe(state); observer.observe(state);
  state = { ...state, phase: 'result' }; observer.observe(state); observer.observe(state);
  state = { ...state, phase: 'finished' }; observer.observe(state); observer.observe(state);
  observer.observe({ ...state, roomId: 'b' });
  assert.deepEqual(played, ['join', 'ready', 'start', 'success', 'result', 'victory']);
});

test('残り5秒は各秒1回だけ、時計の巻戻りやタブ復帰の飛びを追いかけない', () => {
  const played = [], observer = createGameSoundObserver(name => played.push(name));
  observer.tick('round:r1', 10000, 4000);
  for (const now of [5000, 5001, 6000, 5000, 6000, 7000, 8000, 9000, 10000, 10001]) observer.tick('round:r1', 10000, now);
  assert.deepEqual(played, ['tick', 'tick', 'tick', 'tick', 'tick', 'timeup']);
  played.length = 0;
  observer.tick('round:r2', 20000, 14000); observer.tick('round:r2', 20000, 19000);
  observer.tick('lobby:a', 30000, 29000); observer.tick('lobby:a', 30000, 30000);
  assert.deepEqual(played, []);
});

test('両画面の実装と音源、SitesのMP3バイトが一致し、使用する全素材を配布できる', async () => {
  const manifest = JSON.parse(await readFile(new URL('../apps/web/sounds/manifest.json', import.meta.url), 'utf8'));
  const generated = await readFile(new URL('../apps/cloud/lib/assets.ts', import.meta.url), 'utf8');
  const assets = JSON.parse(generated.slice(generated.indexOf(' = ') + 3).trim().replace(/;$/, ''));
  const catalog = new Set(Object.values(soundClips).map(clip => clip.src));
  for (const item of manifest.clips) {
    const web = await readFile(new URL(`../apps/web/sounds/${item.file}`, import.meta.url));
    const plugin = await readFile(new URL(`../plugin/src/ui/assets/sounds/${item.file}`, import.meta.url));
    assert.equal(createHash('sha256').update(web).digest('hex'), item.sha256);
    assert.deepEqual(web, plugin);
    const asset = assets[`/sounds/${item.file}`];
    assert.equal(asset.type, 'audio/mpeg'); assert.equal(asset.encoding, 'base64');
    assert.deepEqual(Buffer.from(asset.body, 'base64'), web);
    assert.equal(catalog.has(`/sounds/${item.file}`), true);
  }
  for (const file of ['sound-engine.js', 'sound-events.js']) {
    assert.equal(await readFile(new URL(`../apps/web/${file}`, import.meta.url), 'utf8'), await readFile(new URL(`../plugin/src/ui/${file}`, import.meta.url), 'utf8'));
  }
});
