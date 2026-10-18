import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';

/** Execute the actual application pipeline with HTTP and camera rendering as boundary doubles. */
async function appHarness() {
  const source = (await readFile(new URL('../apps/web/app.js', import.meta.url), 'utf8')).replace(/^import .*live-camera.*\n/, '').replace(/if\(isLanding\)\{landing\(\);\}else\{skeleton\(\);[\s\S]*$/, '');
  const nodes = new Map(), updates = [], posts = [];
  const node = key => { if (!nodes.has(key)) nodes.set(key, { textContent: '', hidden: false, value: 'pass', classList: { add() {}, remove() {}, toggle() {} } }); return nodes.get(key); };
  let current = { room: { id: 'test-room', name: 'Test' }, round: null, players: [{ id: 'me', name: 'Me', joinedAt: Date.now() - 60000 }], mine: [], stats: { pending: 0 }, lobby: { status: 'waiting', deadline: Date.now() + 30000 }, sync: 'polling', serverTime: Date.now() };
  let online = true, postBehavior = async () => ({ id: 'receipt-one', status: 'queued', receivedAt: Date.now() });
  const context = vm.createContext({ document: { querySelector: node }, location: new URL('https://game.example/rooms/test-room/join'), localStorage: { getItem: key => key.endsWith(':token') ? 'participant-token' : key.endsWith(':id') ? 'me' : null, setItem() {} }, URL, FormData, Blob, File, crypto: webcrypto, Date, setTimeout: () => 1, clearTimeout() {}, matchMedia: () => ({ matches: false }), fetch: async (url, options = {}) => {
    if (!online) throw new TypeError('Network offline');
    if (String(url).endsWith('/submit')) { posts.push(options.body); const result = await postBehavior(options.body); return { ok: true, status: 202, json: async () => result }; }
    return { ok: true, status: 200, headers: { get: () => '' }, json: async () => structuredClone({ ...current, serverTime: Date.now() }) };
  } });
  vm.runInContext(source + `\nrender=()=>syncParticipantCamera();unlockSound=()=>{};liveCamera={update(value){testUpdates.push(value)}};globalThis.testApp={setState(value){state=value},syncParticipantCamera,submitCapturedPhoto,retryUnknownPhoto,refresh,inspect(){return {unknownReceipt,busy,submissionKey,selection,captureError}}};`, Object.assign(context, { testUpdates: updates }));
  const api = context.testApp; api.setState(structuredClone(current));
  return { api, updates, posts, nodes, set state(value) { current = value; api.setState(structuredClone(value)); }, get state() { return current; }, set online(value) { online = value; }, set postBehavior(value) { postBehavior = value; } };
}
const active = () => ({ id: 'round-one', status: 'active', startedAt: Date.now() - 1000, endsAt: Date.now() + 60000, challenge: { title: 'Find a thing' } });
const photo = () => new File(['compressed-photo-bytes'], 'photo.jpg', { type: 'image/jpeg' });

test('registered lobby with no round or optimistic receipt renders camera without null submission regression', async () => {
  const h = await appHarness();
  assert.doesNotThrow(() => h.api.syncParticipantCamera());
  assert.equal(h.updates.at(-1).round, null);
  assert.equal(h.updates.at(-1).status, 'ready');
  assert.equal(h.updates.at(-1).pending, false);
  assert.equal(await h.api.refresh(), true);
  assert.equal(h.nodes.get('#connection').textContent, 'LIVE · 接続中');
});

test('a room connection warning disappears after the first successful refresh', async () => {
  const h = await appHarness();
  h.api.setState(null);
  h.online = false;
  assert.equal(await h.api.refresh(), false);
  assert.equal(h.nodes.get('#room-error').hidden, false);
  h.online = true;
  assert.equal(await h.api.refresh(), true);
  assert.equal(h.nodes.get('#room-error').hidden, true);
  assert.equal(h.nodes.get('#connection').textContent, 'LIVE · 接続中');
});

test('lost upload acknowledgement locks without auto replay; explicit retry reuses bytes, key and chosen result', async () => {
  const h = await appHarness(); h.state = { ...h.state, round: active() };
  let calls = 0;
  h.postBehavior = async () => { if (++calls === 1) throw new TypeError('Acknowledgement lost'); return { id: 'receipt-one', status: 'queued' }; };
  const file = photo();
  const result = await h.api.submitCapturedPhoto(file, { roundId: 'round-one' });
  assert.equal(result.status, 'queued'); assert.equal(h.api.inspect().unknownReceipt, true);
  const firstKey = h.posts[0].get('requestId');
  for (let i = 0; i < 5; i++) await h.api.refresh();
  assert.equal(h.posts.length, 1, 'Polling cannot automatically replay an uncertain upload');
  await h.api.retryUnknownPhoto();
  assert.equal(h.posts.length, 2);
  assert.equal(h.posts[1].get('requestId'), firstKey);
  assert.equal(await h.posts[1].get('photo').text(), await h.posts[0].get('photo').text());
  assert.equal(h.posts[1].get('demoResult'), h.posts[0].get('demoResult'));
  assert.equal(h.api.inspect().unknownReceipt, false);
});

test('explicit retry finds an existing server receipt and never posts it twice', async () => {
  const h = await appHarness(); h.state = { ...h.state, round: active() };
  h.postBehavior = async () => { throw new TypeError('Lost response'); };
  await h.api.submitCapturedPhoto(photo(), { roundId: 'round-one' });
  h.state = { ...h.state, mine: [{ id: 'existing-receipt', roundId: 'round-one', status: 'queued' }] };
  await h.api.retryUnknownPhoto();
  assert.equal(h.posts.length, 1);
  assert.equal(h.api.inspect().unknownReceipt, false);
});

test('network failures retain an error after recovery and cannot masquerade as a rejected verdict', async () => {
  const h = await appHarness(); h.state = { ...h.state, round: active() }; h.online = false;
  await assert.rejects(h.api.submitCapturedPhoto(photo(), { roundId: 'round-one' }), /接続/);
  assert.equal(h.posts.length, 0);
  assert.equal(h.updates.at(-1).status, 'error');
  h.online = true; await h.api.refresh();
  assert.equal(h.updates.at(-1).status, 'error');
  assert.match(h.updates.at(-1).ownStatus, /接続/);
  assert.equal(h.updates.at(-1).accepted, false);
  assert.equal(h.api.inspect().unknownReceipt, false);
});
