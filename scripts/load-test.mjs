import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const base = (process.env.TARGET_BASE_URL || 'http://localhost:4317').replace(/\/$/, '');
const count = Number(process.env.LOAD_PARTICIPANTS || 70);
const connectionMode = process.env.LOAD_CONNECTION_MODE || 'sse';
const reportPath = path.resolve(process.env.LOAD_REPORT || 'docs/load-test-local.json');
const timeoutMs = Number(process.env.LOAD_TIMEOUT_MS || 120000);
const pollIntervalMs = Number(process.env.LOAD_POLL_MS || 1000);
const pollJitter = Number(process.env.LOAD_POLL_JITTER || 0.3);
if (!Number.isInteger(count) || count < 1 || count > 200) throw new Error('LOAD_PARTICIPANTS must be 1–200');
if (!['sse', 'poll'].includes(connectionMode)) throw new Error('LOAD_CONNECTION_MODE must be sse or poll');
const report = { ...(connectionMode === 'poll' ? { pollIntervalMs, pollJitterFraction: pollJitter } : {}), testedAt: new Date().toISOString(), target: base, participants: count, connectionMode, mode: 'demo', imageDescription: 'Unique valid JPEGs with random pixel texture; simulated photo upload sizes, not real-world subjects.', errors: [] };
report.authentication = {"platformAuthentication": "none", "platformCookiesSent": false, "sitesBypassUsed": false, "cookieJar": "none (Node fetch)", "anonymousRequests": ["POST /api/rooms", "POST /api/rooms/:id/join"], "gameHostCookie": "Only the newly created room host cookie is used for host operations", "gameParticipantBearer": "Only newly registered room participant tokens are used for own-photo submissions and own-state synchronization"};
const controllers = [];
const observedStatuses = new Set();
const observedEventIds = new Set();
const observedRoomEventIds = new Set();
let room, cookie, roundId, startAt, uploadBurstAt;
let stopMonitoring = false;
const participants = [];

/** Summarize a distribution in milliseconds without hiding tail latency. */
function summary(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, p50: null, p95: null, max: null };
  const percentile = p => Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] * 100) / 100;
  return { count: sorted.length, p50: percentile(0.5), p95: percentile(0.95), max: percentile(1) };
}

/** Parse a response without logging tokens, cookies or arbitrary error bodies. */
async function jsonRequest(route, options = {}) {
  const response = await fetch(base + route, options);
  const data = await response.json();
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${route}: HTTP ${response.status}`);
  return { response, data };
}

/** Refresh one client's own authorized state and record its visible transitions. */
async function observe(participant) {
  if (stopMonitoring) return;
  if (participant.observing) { participant.needsObserve = true; return; }
  participant.observing = true;
  try {
    const { data } = await jsonRequest(`${room.api}/state`, { headers: { Authorization: `Bearer ${participant.token}` } });
    if (stopMonitoring) return;
    report.maxObservedPending = Math.max(report.maxObservedPending || 0, data.stats.pending);
    if (Number.isFinite(data.stats.processing)) report.maxObservedProcessing = Math.max(report.maxObservedProcessing || 0, data.stats.processing);
    if (Number.isFinite(data.stats.queued)) report.maxObservedQueued = Math.max(report.maxObservedQueued || 0, data.stats.queued);
    const now = performance.now();
    for (const event of data.events || []) {
      observedEventIds.add(event.id);
      observedRoomEventIds.add(event.id);
      if (event.playerId === participant.id && event.roundId === roundId && !participant.eventSeenAt) {
        participant.eventSeenAt = now;
        participant.passEventId = event.id;
        participant.eventEvidence = 'room-history';
      }
    }
    report.passEvents = { observedUniqueIds: observedEventIds.size, observedRoomHistoryIds: observedRoomEventIds.size, ownEventSeenCount: participants.filter(p => p.eventSeenAt).length };
    if (startAt && data.round?.status === 'active' && !participant.roundSeenAt) { participant.roundSeenAt = now; participant.roundSeenId = data.round.id; }
    const mine = data.mine.find(sub => sub.roundId === roundId && sub.requestId === participant.requestId)
      || data.mine.find(sub => sub.roundId === roundId);
    if (mine) {
      observedStatuses.add(mine.status);
      participant.serverReceivedAt = mine.receivedAt;
      if (mine.passEventId) {
        observedEventIds.add(mine.passEventId);
        if (!participant.eventSeenAt) { participant.eventSeenAt = now; participant.passEventId = mine.passEventId; participant.eventEvidence = 'private-pass-event-id'; }
      }
      if (['accepted', 'rejected', 'error'].includes(mine.status) && !participant.completedAt) {
        participant.completedAt = now;
        participant.result = mine.status;
      }
    }
  } catch (error) {
    report.errors.push({ phase: 'sync-state', player: participant.index, message: error.message });
  } finally {
    participant.observing = false;
    if (participant.needsObserve && !stopMonitoring) { participant.needsObserve = false; queueMicrotask(() => { void observe(participant); }); }
  }
}

/** Open an independent SSE connection, or a bounded polling client for cloud runtimes. */
async function monitor(participant) {
  if (connectionMode === 'poll') {
    await observe(participant);
    let timer;
    let closed = false;
    const schedule = () => {
      if (closed || stopMonitoring) return;
      const delay = pollIntervalMs * (1 + (Math.random() * 2 - 1) * pollJitter);
      timer = setTimeout(async () => { await observe(participant); schedule(); }, delay);
    };
    schedule();
    participant.close = () => { closed = true; clearTimeout(timer); };
    return;
  }
  const controller = new AbortController();
  controllers.push(controller);
  const response = await fetch(`${base}${room.api}/events`, { headers: { Authorization: `Bearer ${participant.token}` }, signal: controller.signal });
  if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error(`SSE unavailable: HTTP ${response.status}`);
  const reader = response.body.getReader();
  const initial = await reader.read();
  if (initial.done) throw new Error('SSE closed before initial update');
  await observe(participant);
  participant.close = () => controller.abort();
  participant.streamTask = (async () => {
    let buffer = '';
    const decoder = new TextDecoder();
    while (!stopMonitoring) {
      const chunk = await reader.read();
      if (chunk.done) {
        if (!stopMonitoring) report.errors.push({ phase: 'sse', player: participant.index, message: 'stream closed unexpectedly' });
        return;
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (event.includes('data: update')) {
          participant.notifications = (participant.notifications || 0) + 1;
          // Coalesce bursts while retaining a scheduled trailing refresh.
          if (!participant.refreshTimer) participant.refreshTimer = setTimeout(() => {
            participant.refreshTimer = undefined;
            void observe(participant);
          }, 100);
        }
      }
    }
  })().catch(error => {
    if (!stopMonitoring && error.name !== 'AbortError') report.errors.push({ phase: 'sse', player: participant.index, message: 'stream read failed' });
  });
}

/** Wait for a condition using bounded intervals, preserving the timeout as a failure. */
async function until(condition, label) {
  const deadline = performance.now() + timeoutMs;
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

try {
  const created = await jsonRequest('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `70人負荷試験 ${new Date().toISOString()}` }) });
  room = { ...created.data, api: `/api/rooms/${created.data.id}` };
  cookie = created.response.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Room creation did not return a host cookie');
  report.roomId = room.id;
  const initial = await jsonRequest(`${room.api}/state`);
  if (initial.data.mode !== 'demo') throw new Error('Refusing load test: room is not explicitly in demo mode');

  // Keep registration below anti-abuse limits; the simultaneous load is the upload burst.
  for (let index = 0; index < count; index++) {
    const joined = await jsonRequest(`${room.api}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `負荷参加者${index + 1}`, profile: 'デモ負荷テスト参加者' }) });
    const bytes = await sharp(randomBytes(900 * 675 * 3), { raw: { width: 900, height: 675, channels: 3 } }).jpeg({ quality: 52 }).toBuffer();
    participants.push({ ...joined.data, index, requestId: `burst-${index}-${Date.now()}`, bytes });
    // Keep all load-test players eligible even if registration takes longer than 30 seconds.
    // The real unextended 30-second behavior is verified separately by public-smoke.mjs.
    if (index % 10 === 0) {
      await jsonRequest(`${room.api}/host/extend-lobby`, { method: 'POST', headers: { Cookie: cookie } });
      report.lobbyExtensions = (report.lobbyExtensions || 0) + 1;
    }
  }
  report.images = { ...summary(participants.map(p => p.bytes.length)), unit: 'bytes', totalBytes: participants.reduce((n, p) => n + p.bytes.length, 0) };
  console.log(`Registered ${count} participants; opening ${count} independent ${connectionMode} clients.`);
  await Promise.all(participants.map(p => monitor(p)));
  report.connectionsOpened = participants.length;
  startAt = performance.now();
  await jsonRequest(`${room.api}/host/start-now`, { method: 'POST', headers: { Cookie: cookie } });
  report.hostStartAction = 'start-now';
  const active = await jsonRequest(`${room.api}/state`);
  if (active.data.round?.mode !== 'demo') throw new Error('Refusing paid or unknown model mode');
  roundId = active.data.round.id;
  await until(() => participants.every(p => p.roundSeenId === roundId), 'all independent clients to observe the round');
  report.roundSyncMs = summary(participants.map(p => p.roundSeenAt - startAt));

  console.log(`Burst uploading ${count} unique JPEGs (${Math.round(report.images.totalBytes / 1024 / 1024)} MiB total), demo judgments only.`);
  uploadBurstAt = performance.now();
  await Promise.all(participants.map(async participant => {
    participant.uploadAt = performance.now();
    try {
      const body = new FormData();
      body.set('roundId', roundId);
      body.set('requestId', participant.requestId);
      body.set('demoResult', 'pass');
      body.set('photo', new Blob([participant.bytes], { type: 'image/jpeg' }), `load-${participant.index}.jpg`);
      const { response, data } = await jsonRequest(`${room.api}/submit`, { method: 'POST', headers: { Authorization: `Bearer ${participant.token}` }, body });
      participant.ackAt = performance.now();
      participant.httpStatus = response.status;
      participant.ackStatus = data.status;
    } catch (error) {
      report.errors.push({ phase: 'upload', player: participant.index, message: error.message });
      participant.result = 'upload-error';
      participant.completedAt = performance.now();
    }
  }));
  report.receiptHttpMs = summary(participants.map(p => p.ackAt - p.uploadAt));
  // Each client must observe both its durable verdict and its own pass event.
  await until(() => participants.every(p => p.completedAt && (p.result !== 'accepted' || p.eventSeenAt)), 'all photo judgments and own pass events');
  const finishedAt = performance.now();
  const final = await jsonRequest(`${room.api}/state`);
  report.receiptHttpMs = summary(participants.map(p => p.ackAt - p.uploadAt));
  report.passEventObservedMs = summary(participants.map(p => p.eventSeenAt - p.uploadAt));
  report.passEvents = { observedUniqueIds: observedEventIds.size, observedRoomHistoryIds: observedRoomEventIds.size, ownEventSeenCount: participants.filter(p => p.eventSeenAt).length, evidenceSources: participants.reduce((all,p) => ({...all,[p.eventEvidence || 'none']:(all[p.eventEvidence || 'none'] || 0)+1}), {}), finalHistoryLength: final.data.events?.length, eventCursor: final.data.eventCursor };
  report.completionObservedMs = summary(participants.map(p => p.completedAt - p.uploadAt));
  report.afterAckObservedMs = summary(participants.map(p => p.completedAt - p.ackAt));
  report.httpStatuses = participants.reduce((all, p) => ({ ...all, [p.httpStatus || 'error']: (all[p.httpStatus || 'error'] || 0) + 1 }), {});
  report.ackStatuses = participants.reduce((all, p) => ({ ...all, [p.ackStatus || 'error']: (all[p.ackStatus || 'error'] || 0) + 1 }), {});
  report.results = participants.reduce((all, p) => ({ ...all, [p.result]: (all[p.result] || 0) + 1 }), {});
  report.observedStatuses = [...observedStatuses];
  report.serverReceiptSpreadMs = Math.max(...participants.map(p => p.serverReceivedAt).filter(Number.isFinite)) - Math.min(...participants.map(p => p.serverReceivedAt).filter(Number.isFinite));
  report.burstToAllObservedMs = Math.round((finishedAt - uploadBurstAt) * 100) / 100;
  report.throughputPerSecond = Math.round(count / ((finishedAt - uploadBurstAt) / 1000) * 100) / 100;
  report.fairReceiptOrder = final.data.finishers.every((finisher, i, list) => i === 0 || finisher.elapsedMs >= list[i - 1].elapsedMs);
  report.final = { players: final.data.players.length, accepted: final.data.stats.accepted, pending: final.data.stats.pending, finishers: final.data.finishers.length };
  report.success = report.errors.length === 0 && report.results.accepted === count && report.final.accepted === count && report.final.pending === 0 && report.fairReceiptOrder && report.passEvents.ownEventSeenCount === count;
} catch (error) {
  report.errors.push({ phase: 'test', message: error.message });
  report.success = false;
} finally {
  stopMonitoring = true;
  for (const participant of participants) { participant.close?.(); clearTimeout(participant.refreshTimer); }
  controllers.forEach(controller => controller.abort());
  await Promise.all(participants.map(p => p.streamTask).filter(Boolean));
  if (room && cookie) {
    try { await jsonRequest(`${room.api}/host/end`, { method: 'POST', headers: { Cookie: cookie } }); } catch {}
  }
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (!report.success) process.exitCode = 1;
}
