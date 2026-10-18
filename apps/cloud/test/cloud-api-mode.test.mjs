/** ルーム作成モードと準備表示を、D1・外部通信を使わず実ハンドラーで検証する。 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

// NodeでWorkers用TSを読む際だけ、拡張子なしの内部importを絶対URLへ解決する。
/** Workersの拡張子なしTS importをNode内だけdata URLへ解決する。 */
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const gameContract = moduleUrl(compile(await readFile(new URL('../lib/game-contract.ts', import.meta.url), 'utf8')));
const gameState = moduleUrl(compile(await readFile(new URL('../lib/game-state.ts', import.meta.url), 'utf8'))
  .replaceAll("'./game-contract'", JSON.stringify(gameContract)));
const source = await readFile(new URL('../lib/cloud-api.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  .replaceAll("'qrcode'", JSON.stringify(import.meta.resolve('qrcode')))
  .replaceAll("'./cloud-ai'", JSON.stringify(new URL('../lib/cloud-ai.ts', import.meta.url).href))
  .replaceAll("'./game-contract'", JSON.stringify(gameContract))
  .replaceAll("'./game-state'", JSON.stringify(gameState))
  .replaceAll("'./pass-events'", JSON.stringify(new URL('../lib/pass-events.ts', import.meta.url).href))
  .replaceAll("'./reference-agent.mjs'", JSON.stringify(new URL('../lib/reference-agent.mjs', import.meta.url).href));
const { handleApi } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

/** 挿入値の確認と空のスナップショットに必要なD1操作だけを再現する。 */
function fakeDatabase(room = null) {
  const insertions = [];
  return {
    insertions,
    prepare(sql) {
      const statement = {
        bind(...values) { statement.values = values; return statement; },
        async first() {
          if (sql.startsWith('INSERT INTO rooms')) { insertions.push(statement.values); return { id: statement.values[0] }; }
          return sql.startsWith('SELECT * FROM rooms') ? room : null;
        },
        async all() { return { results: [], meta: { changes: 0 } }; },
        async run() { return {}; },
      };
      return statement;
    },
    async batch(statements) { return Promise.all(statements.map(statement => statement.all())); },
  };
}

test('新規部屋だけ、キー設定時ai・未設定時demoを選び、body.modeで上書きしない', async () => {
  for (const key of ['test-not-real-key', undefined]) {
    const db = fakeDatabase();
    const request = new Request('https://example.test/api/rooms', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'モード検証', mode: key ? 'demo' : 'ai' }) });
    const response = await handleApi(request, { DB: db, BUCKET: {}, OPENAI_API_KEY: key }, {});
    assert.equal(response.status, 201);
    assert.equal(db.insertions.length, 1);
    assert.equal(db.insertions[0][3], key ? 'ai' : 'demo');
  }
});

test('検索中表示はaiかつ参考写真trueに限定し、既存部屋のmodeは変えない', async () => {
  for (const [mode, referencePhotos, expected] of [
    ['ai', undefined, 'generating'], ['ai', 'false', 'generating'], ['ai', 'true', 'searching'], ['demo', 'true', 'generating'],
  ]) {
    const room = { id: 'test-room', name: '既存部屋', mode, createdAt: Date.now(), generationLease: Date.now() + 45000,
      preparedMode: mode, preparedChallenge: null, lobbyStartedAt: 1, lobbyDeadline: null };
    const db = fakeDatabase(room);
    const response = await handleApi(new Request('https://example.test/api/rooms/test-room/state'),
      { DB: db, BUCKET: {}, OPENAI_API_KEY: 'test-not-real-key', AI_REFERENCE_PHOTOS: referencePhotos }, {});
    assert.equal(response.status, 200);
    const state = await response.json();
    assert.equal(state.preparationStage, expected);
    assert.equal(state.mode, mode);
    assert.deepEqual(state.game, { status: 'lobby', totalRounds: 10 });
    assert.equal(state.stages.length, 10);
    assert.equal(db.insertions.length, 0);
  }
});
