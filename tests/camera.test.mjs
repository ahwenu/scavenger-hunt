import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveCamera } from '../apps/web/live-camera.js';

/** Minimal real event targets let tests exercise public camera actions without camera hardware. */
class Element extends EventTarget {
  constructor() {
    super(); this.dataset = {}; this.clicks = 0; this.hidden = false; this.disabled = false; this.textContent = ''; this.value = ''; this.src = ''; this.srcObject = null; this.attributes = new Map();
    this.style = { setProperty() {}, removeProperty() {} };
    const classes = new Set();
    this.classList = { add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)), contains: name => classes.has(name), toggle: (name, force) => { const value = force ?? !classes.has(name); value ? classes.add(name) : classes.delete(name); return value; } };
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  click() { if (!this.disabled) { this.clicks++; this.dispatchEvent(new Event('click', { cancelable: true })); } }
}

/** Create a media/DOM harness; each test observes permission calls, output files and track disposal. */
function harness({ media = true, getUserMedia, onCapture, onFallback, imageMode = 'load', createImageBitmap } = {}) {
  const elements = Object.fromEntries(['video', 'enable', 'shutter', 'fallback', 'file', 'pause', 'title', 'timer', 'reference', 'status', 'message', 'cutin', 'permission', 'permission-title', 'permission-copy'].map(name => [name, new Element()]));
  const video = elements.video;
  Object.assign(video, { videoWidth: 1920, videoHeight: 1080, readyState: 4, muted: true, playsInline: true, play: async () => {}, pause() {} });
  const document = new EventTarget();
  document.hidden = false; document.visibilityState = 'visible';
  let encoded = 0;
  const canvases = [];
  const images = [], createdURLs = [], revokedURLs = [], fallbackFiles = [];
  class MockImage { constructor() { this.naturalWidth = 2400; this.naturalHeight = 1800; images.push(this); } set src(value) { this.currentSrc = value; if (imageMode !== 'pending') queueMicrotask(() => imageMode === 'error' ? this.onerror?.() : this.onload?.()); } removeAttribute() { this.currentSrc = ''; } }
  const urls = { createObjectURL: file => { const url = `blob:fixture-${createdURLs.length}`; createdURLs.push({ url, file }); return url; }, revokeObjectURL: url => revokedURLs.push(url) };
  document.createElement = tag => {
    if (tag !== 'canvas') return new Element();
    const canvas = { width: 0, height: 0, draws: [], getContext: () => ({ drawImage: (...args) => canvas.draws.push(args), fillRect() {} }), toBlob: callback => { encoded++; queueMicrotask(() => callback(new Blob([new Uint8Array(128)], { type: 'image/jpeg' }))); } };
    canvases.push(canvas);
    return canvas;
  };
  const window = new EventTarget();
  Object.assign(window, { isSecureContext: true, location: new URL('https://game.example/rooms/test/join'), setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout, matchMedia: () => ({ matches: false }), File, Blob });
  const tracks = [{ stops: 0, stop() { this.stops++; } }, { stops: 0, stop() { this.stops++; } }];
  const stream = { getTracks: () => tracks, getVideoTracks: () => [tracks[0]] };
  let permissionCalls = 0, fallbackCalls = 0;
  const captures = [];
  const devices = media ? { getUserMedia: async constraints => { permissionCalls++; return getUserMedia ? getUserMedia(constraints, stream) : stream; } } : undefined;
  const root = new Element();
  root.querySelector = selector => elements[selector.match(/data-camera=["']([^"']+)["']/)?.[1]] || null;
  root.querySelectorAll = () => [];
  const controller = createLiveCamera(root, { document, window, navigator: { mediaDevices: devices }, mediaDevices: devices, now: () => Date.now(), Image: MockImage, URL: urls, createImageBitmap, onCapture: async (file, detail) => { captures.push({ file, detail }); return onCapture ? onCapture(file, detail) : { status: 'queued' }; }, onFallback: file => { fallbackCalls++; fallbackFiles.push(file); return onFallback?.(file); }, onGesture() {} });
  return { controller, elements, document, window, tracks, stream, canvases, captures, images, createdURLs, revokedURLs, fallbackFiles, get permissionCalls() { return permissionCalls; }, get fallbackCalls() { return fallbackCalls; }, get encoded() { return encoded; } };
}

/** A shared active round uses server timestamps and contains no camera permission assumption. */
function activeRound(id = 'round-one') {
  return { id, status: 'active', startedAt: Date.now() - 1000, endsAt: Date.now() + 60000, challenge: { title: '丸い実物を探そう', description: '会場の実物を撮影', criteria: ['丸い形'], durationSeconds: 60 } };
}

/** Yield queued permission/capture work without relying on arbitrary long sleeps. */
const flush = () => new Promise(resolve => setImmediate(resolve));

/** Control an async boundary so repeated shutter presses genuinely overlap. */
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('camera asks permission only on enable and keeps the same preview across lobby and round', async t => {
  const h = harness(); t.after(() => h.controller.destroy());
  h.controller.update({ round: null, lobby: { status: 'waiting', deadline: Date.now() + 30000 } });
  assert.equal(h.permissionCalls, 0, 'Rendering a waiting room must not silently ask permission');
  await h.controller.enable();
  assert.equal(h.permissionCalls, 1);
  assert.equal(h.elements.video.srcObject, h.stream);
  assert.equal(h.controller.getState().canCapture, false, 'Waiting users may preview but cannot submit before a round');
  h.controller.update({ round: activeRound(), pending: false, accepted: false });
  assert.equal(h.permissionCalls, 1, 'A new round reuses the ongoing preview');
  assert.equal(h.tracks[0].stops, 0);
  assert.equal(h.controller.getState().canCapture, true);
});

test('permission denial stays visible and never creates an automatic retry loop', async t => {
  let allowed = false;
  const h = harness({ getUserMedia: async (_, stream) => { if (!allowed) { const error = new Error('denied'); error.name = 'NotAllowedError'; throw error; } return stream; } });
  t.after(() => h.controller.destroy());
  h.controller.update({ round: activeRound() });
  await h.controller.enable();
  assert.equal(h.permissionCalls, 1);
  assert.equal(h.controller.getState().canCapture, false);
  assert.equal(h.controller.getState().cameraStatus, 'denied');
  assert.equal(h.elements.permission.hidden, false);
  assert.match(h.elements['permission-copy'].textContent, /設定|許可/);
  for (let i = 0; i < 20; i++) h.controller.update({ round: activeRound() });
  await flush();
  assert.equal(h.permissionCalls, 1, 'Polling and rendering must not repeatedly trigger denied permission');
  allowed = true;
  await h.controller.enable();
  assert.equal(h.permissionCalls, 2, 'An explicit user retry may request permission again');
  assert.equal(h.controller.getState().canCapture, true);
});

test('unsupported media devices and absent camera use an explicit photo-picker fallback', async t => {
  const unsupported = harness({ media: false }); t.after(() => unsupported.controller.destroy());
  unsupported.controller.update({ round: activeRound() });
  await unsupported.controller.enable();
  assert.equal(unsupported.permissionCalls, 0);
  assert.equal(unsupported.controller.getState().canCapture, false);
  unsupported.elements.fallback.click();
  assert.equal(unsupported.elements.file.clicks, 1, 'The fallback opens the system photo picker');
  assert.equal(unsupported.fallbackCalls, 0, 'Choosing fallback alone must not submit a photo');
  unsupported.elements.file.files = [new File([new Uint8Array(128)], 'picked.jpg', { type: 'image/jpeg' })];
  unsupported.elements.file.dispatchEvent(new Event('change'));
  await flush();
  assert.equal(unsupported.fallbackCalls, 1, 'Selecting a photo automatically submits the fallback once');
  const absent = harness({ getUserMedia: async () => { const error = new Error('no camera'); error.name = 'NotFoundError'; throw error; } });
  t.after(() => absent.controller.destroy());
  absent.controller.update({ round: activeRound() });
  await absent.controller.enable();
  assert.equal(absent.controller.getState().canCapture, false);
  absent.elements.fallback.click();
  assert.equal(absent.elements.file.clicks, 1);
  assert.equal(absent.controller.getState().cameraStatus, 'unavailable');
});

test('one shutter action captures and submits once, locking pending work until its explicit result', async t => {
  const upload = deferred();
  const h = harness({ onCapture: () => upload.promise }); t.after(() => h.controller.destroy());
  h.controller.update({ round: activeRound() }); await h.controller.enable();
  const first = h.controller.capture();
  h.controller.capture(); h.elements.shutter.click();
  await flush();
  assert.equal(h.encoded, 1);
  assert.equal(h.captures.length, 1, 'Captured JPEG automatically invokes onCapture without a separate send action');
  assert.equal(h.captures[0].detail.roundId, 'round-one');
  assert.equal(h.captures[0].detail.source, 'live-camera');
  assert.ok(h.captures[0].file instanceof Blob);
  assert.equal(h.captures[0].file.type, 'image/jpeg');
  assert.equal(h.controller.getState().canCapture, false);
  upload.resolve({ status: 'queued' }); await first; await flush();
  h.controller.update({ round: activeRound(), pending: true });
  assert.equal(h.controller.getState().canCapture, false, 'HTTP202 or pending state must keep the shutter locked');
  h.controller.update({ round: activeRound(), pending: false, accepted: false, status: 'reject' });
  assert.equal(h.controller.getState().canCapture, true, 'A confirmed rejection permits a new photo');
  assert.equal(h.captures.length, 1, 'Result polling must never replay a captured photo');
});

test('capture callback failures recover for a deliberate retry without fabricating a pass', async t => {
  const h = harness({ onCapture: async () => { throw new Error('network unavailable'); } }); t.after(() => h.controller.destroy());
  h.controller.update({ round: activeRound() }); await h.controller.enable();
  await h.controller.capture();
  assert.equal(h.captures.length, 1);
  assert.equal(h.controller.getState().accepted, false);
  assert.equal(h.controller.getState().canCapture, true);
  assert.ok(h.elements.message.textContent.length > 0 || h.elements.status.textContent.length > 0);
  for (let i = 0; i < 10; i++) h.controller.update({ round: activeRound(), pending: false, accepted: false });
  assert.equal(h.captures.length, 1);
});

test('pause, hidden page and destruction stop tracks and late permission streams are disposed', async () => {
  for (const lifecycle of ['pause', 'hidden', 'pagehide', 'destroy']) {
    const h = harness(); h.controller.update({ round: activeRound() }); await h.controller.enable();
    if (lifecycle === 'pause') h.controller.pause();
    if (lifecycle === 'hidden') { h.document.hidden = true; h.document.visibilityState = 'hidden'; h.document.dispatchEvent(new Event('visibilitychange')); }
    if (lifecycle === 'pagehide') h.window.dispatchEvent(new Event('pagehide'));
    if (lifecycle === 'destroy') h.controller.destroy();
    assert.ok(h.tracks.every(track => track.stops >= 1), `${lifecycle} must release all camera tracks`);
    assert.equal(h.controller.getState().canCapture, false);
    h.controller.destroy();
  }
  const permission = deferred();
  const h = harness({ getUserMedia: () => permission.promise });
  const opening = h.controller.enable();
  h.controller.destroy(); permission.resolve(h.stream); await opening;
  assert.ok(h.tracks.every(track => track.stops >= 1), 'A late permission response must not leave a camera running after close');
  assert.equal(h.captures.length, 0);
});

test('a stale capture completion cannot apply its result to the next round', async t => {
  const upload = deferred();
  const h = harness({ onCapture: () => upload.promise }); t.after(() => h.controller.destroy());
  h.controller.update({ round: activeRound('old-round') }); await h.controller.enable();
  const capture = h.controller.capture(); await flush();
  h.controller.update({ round: activeRound('new-round'), pending: false, accepted: false });
  upload.resolve({ status: 'pass' }); await capture;
  assert.equal(h.controller.getState().roundId, 'new-round');
  assert.equal(h.controller.getState().accepted, false);
  assert.equal(h.captures.length, 1);
  assert.equal(h.elements.video.srcObject, h.stream);
});

test('overlapping permission requests acquire only one stream and a paused late response is released', async t => {
  const permission = deferred();
  const h = harness({ getUserMedia: () => permission.promise }); t.after(() => h.controller.destroy());
  h.controller.update({ round: activeRound() });
  const opening = h.controller.enable();
  h.controller.enable(); h.elements.enable.click();
  assert.equal(h.permissionCalls, 1);
  h.controller.pause(); permission.resolve(h.stream); await opening;
  assert.equal(h.elements.video.srcObject, null);
  assert.ok(h.tracks.every(track => track.stops >= 1));
  assert.equal(h.controller.getState().canCapture, false);
});

test('a round switch before JPEG encoding completes never sends an old capture', async t => {
  const h = harness(); t.after(() => h.controller.destroy());
  h.controller.update({ round: activeRound('before-switch') }); await h.controller.enable();
  const capture = h.controller.capture();
  h.controller.update({ round: activeRound('after-switch'), pending: false, accepted: false });
  await capture;
  assert.equal(h.captures.length, 0);
  assert.equal(h.controller.getState().roundId, 'after-switch');
  assert.equal(h.controller.getState().canCapture, true);
  assert.equal(h.elements.video.srcObject, h.stream);
});

test('expired, closed and accepted rounds suppress capture while a later round can resume', async t => {
  const h = harness(); t.after(() => h.controller.destroy());
  h.controller.update({ round: { ...activeRound('expired'), endsAt: Date.now() - 100 } }); await h.controller.enable();
  await h.controller.capture();
  assert.equal(h.captures.length, 0);
  h.controller.update({ round: { ...activeRound('closed'), status: 'closed' } });
  await h.controller.capture();
  assert.equal(h.captures.length, 0);
  h.controller.update({ round: activeRound('accepted'), accepted: true, pending: false });
  await h.controller.capture();
  assert.equal(h.captures.length, 0);
  h.controller.update({ round: activeRound('next'), accepted: false, pending: false });
  assert.equal(h.controller.getState().canCapture, true);
  await h.controller.capture();
  assert.equal(h.captures.length, 1);
  assert.ok(Math.max(h.canvases[0].width, h.canvases[0].height) <= 960);
  assert.ok(h.captures[0].file.size <= 1048576);
});

test('photo picker always decodes and recompresses non-JPEG and failed bitmap inputs, releasing URLs', async t => {
  for (const bitmap of [undefined, async () => { throw new Error('unsupported codec'); }]) {
    const h = harness({ media: false, createImageBitmap: bitmap }); t.after(() => h.controller.destroy());
    h.controller.update({ round: activeRound() });
    const original = new File(['ORIGINAL PNG / EXIF BYTES'], 'photo.png', { type: 'image/png' });
    h.elements.file.files = [original]; h.elements.file.dispatchEvent(new Event('change')); await flush();
    assert.equal(h.fallbackFiles.length, 1);
    assert.equal(h.fallbackFiles[0].type, 'image/jpeg');
    assert.notEqual(await h.fallbackFiles[0].text(), await original.text());
    assert.ok(Math.max(h.canvases[0].width, h.canvases[0].height) <= 960);
    assert.equal(h.revokedURLs.length, 1);
    assert.equal(h.images[0].currentSrc, '');
  }
});

test('photo decode errors and destruction release object URLs without sending original files', async () => {
  for (const imageMode of ['error', 'pending']) {
    const h = harness({ media: false, imageMode });
    h.controller.update({ round: activeRound() });
    h.elements.file.files = [new File(['jpeg-original'], 'original.jpg', { type: 'image/jpeg' })];
    h.elements.file.dispatchEvent(new Event('change')); await flush();
    if (imageMode === 'pending') h.controller.destroy();
    await flush();
    assert.equal(h.fallbackFiles.length, 0);
    assert.equal(h.revokedURLs.length, 1);
    assert.equal(h.images[0].currentSrc, '');
    if (imageMode === 'error') assert.equal(h.controller.getState().canCapture, false); // camera is unavailable
    h.controller.destroy();
  }
});

test('live capture matches the visible centered cover crop and recomputes after rotation', async t => {
  const h = harness({ onCapture: async () => ({ status: 'reject' }) }); t.after(() => h.controller.destroy());
  h.controller.update({ round: activeRound() }); await h.controller.enable();
  h.elements.video.clientWidth = 300; h.elements.video.clientHeight = 400;
  await h.controller.capture();
  assert.deepEqual(h.canvases[0].draws[0].slice(1, 5), [555, 0, 810, 1080]);
  h.elements.video.clientWidth = 400; h.elements.video.clientHeight = 200;
  await h.controller.capture();
  assert.deepEqual(h.canvases[1].draws[0].slice(1, 5), [0, 60, 1920, 960]);
});
