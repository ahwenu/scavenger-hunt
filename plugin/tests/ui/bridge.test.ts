/** UIへ不正な応答や成功に見えるエラーを流さないことを検証する。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHostState, readAIResponse } from '../../src/ui/bridge.js';

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
