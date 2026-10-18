/** 認証・上限・一時保存を備え、Sitesのゲーム状態を持たない独立AI API。 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import express from 'express';
import multer from 'multer';
import sharp from 'sharp';

const PHOTO_LIMIT = 2 * 1024 * 1024;
const TTL = 20 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERRORS = {
  UNAUTHORIZED: [401, 'サービスの認証が必要です。', false],
  ORIGIN_REJECTED: [403, 'この接続元からは利用できません。', false],
  INVALID_REQUEST: [400, '入力形式を確認してください。', false],
  INVALID_PHOTO: [400, '2MiB以下のJPEG写真を送信してください。', false],
  PAYLOAD_TOO_LARGE: [413, '送信データが上限を超えています。', false],
  NOT_CONFIGURED: [503, 'AI APIのサーバー設定が必要です。', false],
  NOT_FOUND: [404, '対象が存在しないか、有効期限が切れています。', false],
  REQUEST_ID_REUSED: [409, '同じリクエストIDの入力が異なっています。', false],
  BUSY: [409, 'AI処理中です。しばらく待って再試行してください。', true],
  LIMIT_REACHED: [429, 'AI呼び出しの上限に達しました。しばらく待ってください。', true],
  AI_UNAVAILABLE: [502, 'AI処理を完了できませんでした。', true],
  INTERNAL_ERROR: [500, '処理を完了できませんでした。', true],
};

/** 固定済みメッセージだけを返し、内部例外や秘密値を公開しない。 */
function fail(res, code) {
  const [status, message, retryable] = ERRORS[code] || ERRORS.INTERNAL_ERROR;
  return res.status(status).json({ error: { code: ERRORS[code] ? code : 'INTERNAL_ERROR', message, retryable } });
}

/** トークン比較の長さ差をハッシュ化で除き、平文の差分を返さない。 */
function authenticated(header, token) {
  return Boolean(token && typeof header === 'string' && timingSafeEqual(
    createHash('sha256').update(header).digest(), createHash('sha256').update(`Bearer ${token}`).digest(),
  ));
}

/** 未定義キーや配列・nullを弾き、公開契約のオブジェクトだけを通す。 */
function hasKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => keys.includes(key));
}

/** クライアント由来の履歴は短い文字列だけに制限してAIへ渡す。 */
function validGeneration(body) {
  if (!hasKeys(body, ['requestId', 'context']) || !UUID.test(body.requestId || '')) return false;
  if (body.context === undefined) return true;
  const context = body.context;
  return hasKeys(context, ['history', 'playerCount'])
    && (context.history === undefined || (Array.isArray(context.history) && context.history.length <= 20
      && context.history.every(item => typeof item === 'string' && item.length <= 160)))
    && (context.playerCount === undefined || (Number.isInteger(context.playerCount) && context.playerCount >= 1 && context.playerCount <= 100));
}

/** 上流の生成結果を検証し、利用者へ渡す値をホワイトリストで固定する。 */
function publicChallenge(result, challengeId) {
  if (!result || typeof result.title !== 'string' || !result.title.trim() || result.title.length > 60
    || typeof result.description !== 'string' || result.description.length > 200
    || !Array.isArray(result.criteria) || result.criteria.length < 1 || result.criteria.length > 5
    || result.criteria.some(item => typeof item !== 'string' || !item.trim() || item.length > 160)) throw Error('invalid_challenge');
  const data = { challengeId, title: result.title, description: result.description, criteria: result.criteria, durationSeconds: 120 };
  if (result.reference && result.referenceAsset) {
    const ref = result.reference;
    if (typeof ref.author !== 'string' || typeof ref.license !== 'string' || typeof ref.licenseUrl !== 'string'
      || typeof ref.sourceUrl !== 'string' || !(result.referenceAsset.bytes instanceof Uint8Array)
      || result.referenceAsset.bytes.length > 1048576 || !['image/jpeg', 'image/png', 'image/webp'].includes(result.referenceAsset.mime)) throw Error('invalid_reference');
    data.reference = { url: `/api/v1/ai/challenges/${challengeId}/reference`, author: ref.author,
      licenseName: ref.license, licenseUrl: ref.licenseUrl, sourcePageUrl: ref.sourceUrl };
  }
  return data;
}

/** 異常・過大画像をデコードで拒否し、EXIF等を除いた960px JPEGへ正規化する。 */
async function normalizedPhoto(file) {
  if (!file || file.mimetype !== 'image/jpeg' || file.size > PHOTO_LIMIT || file.size < 4
    || file.buffer[0] !== 255 || file.buffer[1] !== 216 || file.buffer.at(-2) !== 255 || file.buffer.at(-1) !== 217) throw Error('invalid_photo');
  const image = sharp(file.buffer, { limitInputPixels: 12_000_000, failOn: 'warning' });
  const metadata = await image.metadata();
  if (metadata.format !== 'jpeg' || !metadata.width || !metadata.height) throw Error('invalid_photo');
  return image.rotate().resize({ width: 960, height: 960, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
}

/** テスト用AI・時計を注入可能にし、実行時の秘密はクロージャー内に留める。 */
export function createApp({ ai, token, now = Date.now, onFailure } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.locals.configured = Boolean(token && ai?.available);
  const challenges = new Map(), requests = new Map();
  let pendingGeneration = false, pendingJudgments = 0;
  let budgetStarted = now(), generations = 0, judgments = 0;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: PHOTO_LIMIT, files: 1, fields: 1, parts: 2, fieldSize: 100 } }).single('photo');

  /** 既知のコードと処理段階だけを診断へ渡し、生の例外文字列を保持しない。 */
  function reportFailure(operation, error) {
    const value = error?.code || error?.message;
    const code = /^(?:text_response_(?:timeout|incomplete|invalid_challenge|failed|http_\d{3})|reference_(?:generation_timeout|generation_failed|agent_turn_failed|invalid_challenge|selection_missing|agent_incomplete|session_cleanup_failed|agent_http_\d{3}|http_\d{3}|fetch_failed|no_candidates|search_limit|download_limit|tool_call_limit)|decision_unavailable)$/.test(value || '') ? value : 'UPSTREAM_FAILED';
    const stage = ['agent_create', 'agent_stream', 'validate_output', 'session_cleanup', 'search_reference_photos', 'get_reference_photo', 'tool_result_submit'].includes(error?.referenceStage) ? error.referenceStage : undefined;
    try { onFailure?.({ operation, code, ...(stage ? { stage } : {}) }); }
    catch { /* 診断先の失敗で公開APIの結果を変えない。 */ }
  }

  /** 期限切れの画像・冪等性情報を削除し、時間単位の予算をリセットする。 */
  function prune() {
    const time = now();
    for (const [id, record] of challenges) if (record.expiresAt <= time) challenges.delete(id);
    for (const [id, record] of requests) if (record.expiresAt <= time) requests.delete(id);
    if (time - budgetStarted >= 3600000) { budgetStarted = time; generations = 0; judgments = 0; }
  }

  app.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    // ブラウザからのクロスオリジン呼出しは拒否。通常のMCP/サービス間通信にはOriginがない。
    const host = req.get('host') || '';
    if (!/^(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/.test(host)
      || (req.get('origin') && req.get('origin') !== `http://${host}`)) return fail(res, 'ORIGIN_REJECTED');
    next();
  });
  app.get('/health', (_req, res) => res.json({ service: 'karimono-ai', configured: app.locals.configured }));
  app.use('/api/v1/ai', (req, res, next) => {
    if (!authenticated(req.get('authorization'), token)) return fail(res, 'UNAUTHORIZED');
    prune();
    next();
  });

  app.post('/api/v1/ai/challenges', express.json({ limit: '8kb', strict: true }), async (req, res) => {
    if (!validGeneration(req.body)) return fail(res, 'INVALID_REQUEST');
    if (!ai?.available) return fail(res, 'NOT_CONFIGURED');
    const { requestId } = req.body;
    const context = { history: req.body.context?.history || [], ...(req.body.context?.playerCount ? { playerCount: req.body.context.playerCount } : {}) };
    const fingerprint = JSON.stringify(context);
    const previous = requests.get(requestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) return fail(res, 'REQUEST_ID_REUSED');
      const record = challenges.get(previous.challengeId);
      if (record) return res.json({ data: record.data, serverTime: new Date(now()).toISOString() });
    }
    if (pendingGeneration) return fail(res, 'BUSY');
    if (generations >= 20 || challenges.size >= 20) return fail(res, 'LIMIT_REACHED');
    pendingGeneration = true;
    generations++;
    try {
      const result = await ai.generate(context);
      const challengeId = randomUUID(), data = publicChallenge(result, challengeId), expiresAt = now() + TTL;
      challenges.set(challengeId, { data, referenceAsset: result.referenceAsset, expiresAt });
      requests.set(requestId, { challengeId, fingerprint, expiresAt });
      return res.status(201).json({ data, serverTime: new Date(now()).toISOString() });
    } catch (error) { reportFailure('generate', error); return fail(res, 'AI_UNAVAILABLE'); }
    finally { pendingGeneration = false; }
  });

  app.get('/api/v1/ai/challenges/:id/reference', (req, res) => {
    const record = challenges.get(req.params.id);
    if (!record?.referenceAsset) return fail(res, 'NOT_FOUND');
    res.type(record.referenceAsset.mime).send(Buffer.from(record.referenceAsset.bytes));
  });

  app.post('/api/v1/ai/judgments', (req, res, next) => {
    if (Number(req.get('content-length') || 0) > PHOTO_LIMIT + 65536) return fail(res, 'PAYLOAD_TOO_LARGE');
    upload(req, res, error => error ? next(error) : next());
  }, async (req, res) => {
    if (!hasKeys(req.body, ['challengeId']) || !UUID.test(req.body.challengeId || '')) return fail(res, 'INVALID_REQUEST');
    if (!ai?.available) return fail(res, 'NOT_CONFIGURED');
    const record = challenges.get(req.body.challengeId);
    if (!record) return fail(res, 'NOT_FOUND');
    if (pendingJudgments >= 2) return fail(res, 'BUSY');
    if (judgments >= 60) return fail(res, 'LIMIT_REACHED');
    pendingJudgments++;
    let photo;
    try { photo = await normalizedPhoto(req.file); }
    catch { pendingJudgments--; return fail(res, 'INVALID_PHOTO'); }
    judgments++;
    try {
      const result = await ai.judge({ ...record.data, referenceAsset: record.referenceAsset }, photo);
      const expectedCode = { pass: 'CRITERIA_MET', fail: 'CRITERIA_NOT_MET', uncertain: 'AI_UNCERTAIN' }[result?.outcome];
      if (!expectedCode) throw Error('invalid_judgment');
      return res.json({ data: { outcome: result.outcome, reasonCode: expectedCode, provider: 'Decisions API' }, serverTime: new Date(now()).toISOString() });
    } catch (error) { reportFailure('judge', error); return fail(res, 'AI_UNAVAILABLE'); }
    finally { pendingJudgments--; photo = undefined; }
  });

  app.use((_req, res) => fail(res, 'NOT_FOUND'));
  app.use((error, _req, res, _next) => {
    if (error?.type === 'entity.too.large' || error?.code === 'LIMIT_FILE_SIZE') return fail(res, 'PAYLOAD_TOO_LARGE');
    if (error instanceof multer.MulterError || error?.type === 'entity.parse.failed' || error?.message === 'Unexpected end of form') return fail(res, 'INVALID_REQUEST');
    return fail(res, 'INTERNAL_ERROR');
  });
  return app;
}
