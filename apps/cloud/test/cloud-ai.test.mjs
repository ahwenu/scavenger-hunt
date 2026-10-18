/** Workers用AIのモード分岐・失敗・見本なし判定を、SDKのHTTP通信を完全にモックして確認する。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateChallenge, judgePhoto } from '../lib/cloud-ai.ts';
import { generateTextChallenge } from '../lib/text-agent.mjs';

const challenge = { title: '赤いペンを探そう', description: '会場にある実物を撮影しよう。', criteria: ['ペンの実物が写っている', '赤い部分がある'], durationSeconds: 120 };

/** 実ネットワークへ出ず、生成と判定に必要なSDKレスポンスだけを返す。 */
function mockedTransport(t, { probability = 0.99 } = {}) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const pathname = new URL(String(input)).pathname;
    const body = JSON.parse(init.body);
    calls.push({ pathname, body });
    if (pathname.endsWith('/responses')) {
      return Response.json({ id: 'mock-response', object: 'response', status: 'completed',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(challenge), annotations: [] }] }] });
    }
    if (pathname.endsWith('/decisions')) {
      return Response.json({ id: 'mock-decision', answers: body.questions.map(question => ({ name: question.name, type: 'predicate', probability })) });
    }
    if (pathname.includes('/agents/sessions')) return Response.json({ error: { message: 'mock rejection', type: 'mock_error' } }, { status: 503 });
    throw new Error('Unexpected mocked endpoint');
  });
  return calls;
}

test('標準とfalse設定はResponses structured outputsを使い、参考写真には依存しない', async t => {
  const calls = mockedTransport(t);
  for (const flag of [undefined, 'false']) {
    const result = await generateChallenge('test-not-real-key', 'ai', { history: [] }, flag);
    assert.equal(result.provider, 'Responses API');
    assert.equal(result.reference, undefined);
    assert.equal(result.title, challenge.title);
  }
  assert.equal(calls.length, 2);
  assert(calls.every(call => call.pathname.endsWith('/responses')));
  assert.equal(calls[0].body.text.format.type, 'json_schema');
  assert.equal(calls[0].body.text.format.strict, true);
  assert.equal(calls[0].body.store, false);
});

test('明示trueだけAgentsへ接続し、失敗をデモ生成で補完しない', async t => {
  const calls = mockedTransport(t);
  await assert.rejects(generateChallenge('test-not-real-key', 'ai', { history: [] }, 'true'));
  assert.equal(calls.length, 1);
  assert(calls[0].pathname.includes('/agents/sessions'));
});

test('明示demoはキーや外部通信を使わず、未設定のaiをデモに切り替えない', async t => {
  const calls = mockedTransport(t);
  assert.equal((await generateChallenge(undefined, 'demo', { history: [] })).provider, 'デモ生成');
  await assert.rejects(generateChallenge(undefined, 'ai', { history: [] }), /credential_missing/);
  assert.equal(calls.length, 0);
});

test('見本なしDecisions判定は条件だけを評価し、見本のあるような理由を返さない', async t => {
  const calls = mockedTransport(t);
  const result = await judgePhoto('test-not-real-key', 'ai', { ...challenge, provider: 'Responses API' }, 'data:image/jpeg;base64,mock', 'pass');
  assert.equal(result.pass, true);
  assert.equal(result.provider, 'Decisions API');
  assert.doesNotMatch(result.reason, /見本/);
  assert(calls[0].pathname.endsWith('/decisions'));
  assert.equal(calls[0].body.input[0].content.filter(item => item.type === 'input_image').length, 1);
  assert.doesNotMatch(JSON.stringify(calls[0].body), /reference|見本/i);
});

test('見本なし不合格でも、お題条件へ沿った撮り直し理由を返す', async t => {
  mockedTransport(t, { probability: 0.01 });
  const result = await judgePhoto('test-not-real-key', 'ai', { ...challenge, provider: 'Responses API' }, 'data:image/jpeg;base64,mock', 'pass');
  assert.equal(result.pass, false);
  assert.match(result.reason, /お題の条件/);
  assert.doesNotMatch(result.reason, /見本/);
});

test('参考写真付きDecisionsでは見本画像と追加の比較条件を維持する', async t => {
  const calls = mockedTransport(t);
  const result = await judgePhoto('test-not-real-key', 'ai', { ...challenge, provider: 'Agents API', reference: {} }, 'data:image/jpeg;base64,mock', 'pass', 'data:image/jpeg;base64,reference');
  assert.equal(result.pass, true);
  assert.match(result.reason, /見本/);
  assert.equal(calls[0].body.input[0].content.filter(item => item.type === 'input_image').length, 2);
  assert(calls[0].body.questions.some(question => question.name === 'reference_similarity'));
  assert(calls[0].body.questions.some(question => question.name === 'not_reference_reproduction'));
});

test('Responsesの拒否・未完了・不正JSONは生成成功として返さない', async () => {
  for (const response of [
    { status: 'incomplete', output_text: JSON.stringify(challenge) },
    { status: 'completed', output_text: JSON.stringify(challenge), output: [{ content: [{ type: 'refusal' }] }] },
    { status: 'completed', output_text: '{invalid json' },
  ]) {
    const client = { responses: { create: async () => response } };
    await assert.rejects(generateTextChallenge(client, {}), /text_response_/);
  }
});
