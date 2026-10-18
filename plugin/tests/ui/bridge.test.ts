/** UIへ不正な応答や成功に見えるエラーを流さないことを検証する。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { App } from '@modelcontextprotocol/ext-apps';
import { createHostBridge, readHostState, readAIResponse, readInitialConnectionState, type HostBridge } from '../../src/ui/bridge.js';

const hostResult = { content: [], structuredContent: { mode: 'sites', snapshot: null, notice: 'Sites接続済み' } };
const aiStatusResult = { content: [], structuredContent: { aiStatus: { configured: true, available: true, notice: 'AI接続済み' } } };

/** 外部サービスを呼ばず、起動時の片方だけの失敗と待機を再現する。 */
function initialBridge(overrides: Partial<HostBridge>): HostBridge {
  return {
    async connect() {}, async close() {},
    async call() { return readHostState(hostResult); },
    async checkAI() { return readAIResponse(aiStatusResult, 'aiStatus'); },
    async generateAI() { throw new Error('この検証でAI生成は呼び出しません。'); },
    ...overrides,
  };
}

test('未接続状態を明示的に受け取る', () => {
  const state = readHostState({ content: [], structuredContent: { mode: 'unconfigured', snapshot: null, notice: '未接続' } });
  assert.equal(state.mode, 'unconfigured');
  assert.equal(state.snapshot, null);
});

test('不完全な部屋や未知のモードを成功状態として受け取らない', () => {
  assert.throws(() => readHostState({ content: [], structuredContent: { mode: 'demo', snapshot: { room: {} }, notice: '' } }), /応答形式/);
  assert.throws(() => readHostState({ content: [], structuredContent: { mode: 'live', snapshot: null, notice: '' } }), /応答形式/);
});

test('MCPのエラーを画面の成功データとして扱わない', () => {
  assert.throws(() => readHostState({ isError: true, content: [{ type: 'text', text: '未接続です' }] }), /未接続/);
});

test('AI接続状態とお題をゲーム状態とは別のDTOで受け取る', () => {
  const status = readAIResponse({ content: [], structuredContent: { aiStatus: { configured: true, available: true, notice: '接続済み', privateField: 'not-public' } } }, 'aiStatus');
  assert.deepEqual(status, { configured: true, available: true, notice: '接続済み' });
  assert.throws(() => readHostState({ content: [], structuredContent: { aiStatus: status } }), /応答形式/);
  assert.throws(() => readAIResponse({ content: [], structuredContent: { mode: 'demo', snapshot: null, notice: 'デモ' } }, 'aiResult'), /応答形式/);
});

test('AI結果の技術エラーや不完全な条件を成功と表示しない', () => {
  assert.throws(() => readAIResponse({ isError: true, content: [{ type: 'text', text: 'AI処理失敗' }] }, 'aiResult'), /AI処理失敗/);
  assert.throws(() => readAIResponse({ content: [], structuredContent: { aiResult: { data: { challengeId: 'x', title: 'お題' }, serverTime: '2026-10-18T00:00:00Z' } } }, 'aiResult'), /応答形式/);
});

test('最初の接続失敗後は更新で再接続し、その後の操作では接続を使い回す', async t => {
  let connections = 0;
  let calls = 0;
  t.mock.method(App.prototype, 'connect', async () => {
    if (++connections === 1) throw new Error('handshake timeout');
  });
  t.mock.method(App.prototype, 'close', async () => {});
  t.mock.method(App.prototype, 'callServerTool', async () => { calls++; return hostResult; });
  const bridge = createHostBridge();
  await assert.rejects(bridge.connect(() => {}), /handshake timeout/);
  assert.equal((await bridge.call('host_open', {})).mode, 'sites');
  assert.equal((await bridge.call('host_open', {})).mode, 'sites');
  assert.equal(connections, 2);
  assert.equal(calls, 2);
  await bridge.close();
});

test('同時に更新とAI確認してもhandshakeは一つに合流する', async t => {
  let connections = 0;
  let calls = 0;
  let release!: () => void;
  const handshake = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(App.prototype, 'connect', async () => { connections++; await handshake; });
  t.mock.method(App.prototype, 'close', async () => {});
  t.mock.method(App.prototype, 'callServerTool', async (request: { name: string }) => { calls++; return request.name === 'ai_status' ? aiStatusResult : hostResult; });
  const bridge = createHostBridge();
  const connecting = bridge.connect(() => {});
  const host = bridge.call('host_open', {});
  const ai = bridge.checkAI();
  assert.equal(connections, 1);
  assert.equal(calls, 0);
  release();
  await connecting;
  assert.equal((await host).mode, 'sites');
  assert.equal((await ai).available, true);
  assert.equal(connections, 1);
  assert.equal(calls, 2);
  await bridge.close();
});

test('明示closeは途中のhandshakeを復活させず後続操作も再接続しない', async t => {
  let connections = 0;
  let calls = 0;
  let release!: () => void;
  const handshake = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(App.prototype, 'connect', async () => { connections++; await handshake; });
  t.mock.method(App.prototype, 'close', async () => {});
  t.mock.method(App.prototype, 'callServerTool', async () => { calls++; return hostResult; });
  const bridge = createHostBridge();
  const connecting = bridge.connect(() => {});
  await bridge.close();
  release();
  await assert.rejects(connecting, /接続が終了/);
  await assert.rejects(bridge.call('host_open', {}), /接続が終了/);
  await assert.rejects(bridge.checkAI(), /接続が終了/);
  assert.equal(connections, 1);
  assert.equal(calls, 0);
});

test('操作の通信失敗を再接続や変更ツールの自動再送で補わない', async t => {
  let connections = 0;
  let calls = 0;
  t.mock.method(App.prototype, 'connect', async () => { connections++; });
  t.mock.method(App.prototype, 'close', async () => {});
  t.mock.method(App.prototype, 'callServerTool', async () => { calls++; throw new Error('tool unavailable'); });
  const bridge = createHostBridge();
  await bridge.connect(() => {});
  await assert.rejects(bridge.call('host_create_room', { operationId: 'one-operation' }), /tool unavailable/);
  assert.equal(connections, 1);
  assert.equal(calls, 1);
  await bridge.close();
});

test('部屋の初回取得が失敗しても独立AIの接続結果を受け取る', async () => {
  const pending = readInitialConnectionState(initialBridge({ async call() { throw new Error('Sites unavailable'); } }));
  const [host, ai] = await Promise.all([pending.host, pending.ai]);
  assert.equal(host.status, 'rejected');
  if (host.status === 'rejected') assert.match(host.reason.message, /Sites unavailable/);
  assert.equal(ai.status, 'fulfilled');
  if (ai.status === 'fulfilled') assert.equal(ai.value.available, true);
});

test('独立AIの初回確認が失敗しても部屋の接続結果とAIの失敗理由を受け取る', async () => {
  const pending = readInitialConnectionState(initialBridge({ async checkAI() { throw new Error('AI unavailable'); } }));
  const [host, ai] = await Promise.all([pending.host, pending.ai]);
  assert.equal(host.status, 'fulfilled');
  if (host.status === 'fulfilled') assert.equal(host.value.mode, 'sites');
  assert.equal(ai.status, 'rejected');
  if (ai.status === 'rejected') assert.match(ai.reason.message, /AI unavailable/);
});

test('部屋の初回取得を待っている間にもAI確認を開始する', async () => {
  const started: string[] = [];
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const initializing = readInitialConnectionState(initialBridge({
    async call() { started.push('host_open'); await pending; return readHostState(hostResult); },
    async checkAI() { started.push('ai_status'); return readAIResponse(aiStatusResult, 'aiStatus'); },
  }));
  assert.deepEqual(started, ['host_open', 'ai_status']);
  release();
  const [host, ai] = await Promise.all([initializing.host, initializing.ai]);
  assert.equal(host.status, 'fulfilled');
  assert.equal(ai.status, 'fulfilled');
});

test('AI確認が遅れていても部屋の接続結果を先に利用できる', async () => {
  let release!: () => void;
  let aiSettled = false;
  const pendingAI = new Promise<void>(resolve => { release = resolve; });
  const pending = readInitialConnectionState(initialBridge({
    async checkAI() { await pendingAI; return readAIResponse(aiStatusResult, 'aiStatus'); },
  }));
  void pending.ai.then(() => { aiSettled = true; });
  assert.equal((await pending.host).status, 'fulfilled');
  assert.equal(aiSettled, false);
  release();
  assert.equal((await pending.ai).status, 'fulfilled');
});
