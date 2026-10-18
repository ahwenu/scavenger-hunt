/** OpenAIキーを保持せず、Ahwenu担当の独立AI APIだけを呼び出す接続境界。 */
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { AIResult, AIStatus } from '../shared/ai-contracts.js';

const notices = {
  NOT_CONFIGURED: 'AI APIの接続先とサービス用トークンを設定してください。',
  INVALID_CONFIG: 'AI APIの接続設定を確認してください。',
  UNAVAILABLE: 'AI APIに接続できませんでした。接続を確認してから再度お試しください。',
  UNAUTHORIZED: 'AI APIのサービス認証を確認してください。',
  RATE_LIMITED: 'AI APIが混み合っています。時間をおいて再度お試しください。',
  REQUEST_CONFLICT: '同じ操作IDで別の処理が実行されています。',
  INVALID_REQUEST: 'AI APIへの入力を確認してください。',
  INVALID_RESPONSE: 'AI APIから正しい応答を受け取れませんでした。',
  PROVIDER_NOT_CONFIGURED: 'AI API側のOpenAI接続設定を確認してください。',
} as const;

/** 外部応答や例外の秘密値を含めずに公開できるエラー。 */
export class AiServiceError extends Error {
  /** コードに対応した固定メッセージだけを保持する。 */
  constructor(public readonly code: keyof typeof notices) {
    super(notices[code]);
    this.name = 'AiServiceError';
  }
}

/** テスト時に通信を差し替えられる、環境非依存の接続設定。 */
export interface AiServiceOptions {
  baseUrl?: string;
  token?: string;
  tokenFile?: string;
  fetch?: typeof globalThis.fetch;
}

const publicUrl = z.string().url().refine(value => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
});
const referenceLocation = z.union([
  publicUrl,
  z.string().regex(/^\/(?!\/)[^\\\s?#]+$/),
]);
const referenceSchema = z.object({
  url: referenceLocation, author: z.string().max(2000), licenseName: z.string().max(500),
  licenseUrl: publicUrl, sourcePageUrl: publicUrl,
});
const resultSchema = z.object({
  data: z.object({
    challengeId: z.string().min(1).max(200), title: z.string().min(1).max(500),
    description: z.string().min(1).max(5000), criteria: z.array(z.string().min(1).max(2000)).min(1).max(20),
    durationSeconds: z.number().int().min(1).max(3600), reference: referenceSchema.optional(),
  }),
  serverTime: z.string().datetime(),
});
const healthSchema = z.object({ service: z.literal('karimono-ai'), configured: z.boolean() });

/** 接続URLに秘密値や平文の遠隔接続が混ざることを防ぐ。 */
function validatedUrl(raw: string): URL {
  try {
    const url = new URL(raw);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) {
      throw new AiServiceError('INVALID_CONFIG');
    }
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
    return url;
  } catch {
    throw new AiServiceError('INVALID_CONFIG');
  }
}

/** 接続先だけが知る失敗内容を、画面へ渡せる固定コードへ変換する。 */
function responseError(status: number): AiServiceError {
  if (status === 401 || status === 403) return new AiServiceError('UNAUTHORIZED');
  if (status === 409) return new AiServiceError('REQUEST_CONFLICT');
  if (status === 429) return new AiServiceError('RATE_LIMITED');
  if (status === 400 || status === 422) return new AiServiceError('INVALID_REQUEST');
  if (status === 503) return new AiServiceError('UNAVAILABLE');
  return new AiServiceError('UNAVAILABLE');
}

/** OpenAIの秘密鍵を受け取らず、別プロセスのAPIへ一度だけ生成要求を送る。 */
export class AiServiceClient {
  private readonly options: AiServiceOptions;
  private readonly fetcher: typeof globalThis.fetch;

  /** 未指定の設定は明示的なKARIMONO_API_*環境変数だけから取得する。 */
  constructor(options?: AiServiceOptions) {
    this.options = options ?? {
      baseUrl: process.env.KARIMONO_API_URL,
      token: process.env.KARIMONO_API_TOKEN,
      tokenFile: process.env.KARIMONO_API_TOKEN_FILE,
    };
    this.fetcher = options?.fetch ?? globalThis.fetch;
  }

  /** 秘密値を返さず、未接続・API未準備・生成可能を区別する。 */
  async status(): Promise<AIStatus> {
    try {
      const { url } = await this.configuration();
      const response = await this.fetcher(new URL('health', url), {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw responseError(response.status);
      const parsed = healthSchema.safeParse(await response.json());
      if (!parsed.success) throw new AiServiceError('INVALID_RESPONSE');
      return {
        configured: true, available: parsed.data.configured,
        notice: parsed.data.configured ? 'AI APIへ接続済みです。お題を生成できます。' : notices.PROVIDER_NOT_CONFIGURED,
      };
    } catch (error) {
      const safe = error instanceof AiServiceError ? error : new AiServiceError('UNAVAILABLE');
      return {
        configured: safe.code !== 'NOT_CONFIGURED' && safe.code !== 'INVALID_CONFIG',
        available: false, notice: safe.message,
      };
    }
  }

  /** 同じrequestIdをAPIへ渡し、タイムアウト時も自動再試行や部屋への反映をしない。 */
  async generateChallenge(requestId: string): Promise<AIResult> {
    if (!z.string().uuid().safeParse(requestId).success) throw new AiServiceError('INVALID_REQUEST');
    const { url, token } = await this.configuration();
    try {
      const response = await this.fetcher(new URL('api/v1/ai/challenges', url), {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(35_000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ requestId, context: {} }),
      });
      if (!response.ok) throw responseError(response.status);
      const parsed = resultSchema.safeParse(await response.json());
      if (!parsed.success) throw new AiServiceError('INVALID_RESPONSE');
      return parsed.data;
    } catch (error) {
      throw error instanceof AiServiceError ? error : new AiServiceError('UNAVAILABLE');
    }
  }

  /** 指定されたトークンまたは指定ファイルのみ読み込み、隣接フォルダを探索しない。 */
  private async configuration(): Promise<{ url: URL; token: string }> {
    if (!this.options.baseUrl) throw new AiServiceError('NOT_CONFIGURED');
    const url = validatedUrl(this.options.baseUrl);
    let token = this.options.token;
    if (!token && this.options.tokenFile) {
      try {
        token = (await readFile(this.options.tokenFile, 'utf8')).trim();
      } catch {
        throw new AiServiceError('INVALID_CONFIG');
      }
    }
    if (!token) throw new AiServiceError('NOT_CONFIGURED');
    if (!/^[\x21-\x7e]{16,1024}$/.test(token)) throw new AiServiceError('INVALID_CONFIG');
    return { url, token };
  }
}
