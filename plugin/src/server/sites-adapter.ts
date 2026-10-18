/** Sitesの現行ゲームAPIを、秘密Cookieをプロセス外へ出さずホスト拡張へ接続する。 */
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { HostSnapshot, HostState } from '../shared/contracts.js';
import { HostOperationError, type HostAction, type HostAdapter, type HostInput } from './adapters.js';

/** Sites専用の設定。OpenAIキーや参加者用Bearer認証はここでは使わない。 */
export interface SitesAdapterOptions {
  baseUrl?: string;
  accessTokenFile?: string;
  fetch?: typeof globalThis.fetch;
}

const idSchema = z.string().regex(/^[a-zA-Z0-9-]{1,200}$/);
const playerSchema = z.object({ id: idSchema, name: z.string().max(200) });
const cloudStateSchema = z.object({
  room: z.object({ id: idSchema, name: z.string().max(500) }),
  isHost: z.literal(true), mode: z.enum(['demo', 'ai']), aiAvailable: z.boolean(),
  serverTime: z.number().int().positive(),
  generating: z.boolean(), preparing: z.boolean(), prepared: z.boolean(),
  preparationError: z.string().nullable(),
  lobby: z.object({ deadline: z.number().nullable(), startedAt: z.number().nullable(), status: z.string() }),
  players: z.array(playerSchema).max(200),
  ranks: z.array(playerSchema.extend({ wins: z.number().int().nonnegative(), totalMs: z.number().nonnegative() })).max(200),
  round: z.object({
    id: idSchema, number: z.number().int().positive(), mode: z.enum(['demo', 'ai']), status: z.enum(['active', 'closed']),
    challenge: z.object({ title: z.string().max(500), description: z.string().max(5000) }),
    startedAt: z.number().positive(), endsAt: z.number().positive(),
  }).nullable(),
  stats: z.object({ pending: z.number().int().nonnegative() }),
});
type CloudState = z.infer<typeof cloudStateSchema>;
interface RoomSession {
  cookie: string;
  version: number;
  signature: string;
  state?: HostState;
}

/** サービスゲートと部屋認証の失敗を固定メッセージへ変換する。 */
function httpError(status: number): HostOperationError {
  if (status === 401 || status === 403) return new HostOperationError('SITES_AUTH_REQUIRED', 'Sitesのアクセス設定またはこの部屋のホスト認証を確認してください。');
  if (status === 404) return new HostOperationError('ROOM_NOT_FOUND', 'Sitesにこの部屋が見つかりません。');
  if (status === 409) return new HostOperationError('STATE_CONFLICT', 'Sites側で進行・準備・判定中です。最新状態を取得してください。');
  if (status === 429) return new HostOperationError('RATE_LIMITED', 'Sitesの受付上限です。しばらく待って再度お試しください。');
  if (status === 400 || status === 422) return new HostOperationError('INVALID_STATE', '参加者・準備状態を確認してください。Sitesでこの操作を受け付けられませんでした。');
  return new HostOperationError('SITES_UNAVAILABLE', 'Sites APIへ接続できませんでした。公開状態と接続設定を確認してください。');
}

/** URLはHTTPSか明示したループバックHTTPのオリジンだけに限定する。 */
function parseBaseUrl(value?: string): URL {
  if (!value) throw new HostOperationError('NOT_CONFIGURED', 'SITES_API_BASE_URLをMCPサーバー側で設定してください。');
  try {
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))) throw new Error();
    return url;
  } catch {
    throw new HostOperationError('INVALID_CONFIG', 'SitesのURLはHTTPSまたはループバックHTTPのオリジンで設定してください。');
  }
}

/** プロセス内の部屋別Cookieと操作IDを保持する。再起動後の既存部屋復帰は未対応。 */
export class SitesHostAdapter implements HostAdapter {
  private readonly options: SitesAdapterOptions;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly rooms = new Map<string, RoomSession>();
  private readonly operations = new Map<string, { fingerprint: string; promise: Promise<HostState> }>();
  private currentRoomId?: string;
  private queue: Promise<unknown> = Promise.resolve();

  /** 明示的な環境変数以外からゲート認証や接続先を探索しない。 */
  constructor(options?: SitesAdapterOptions) {
    this.options = options ?? { baseUrl: process.env.SITES_API_BASE_URL, accessTokenFile: process.env.SITES_SERVICE_ACCESS_TOKEN_FILE };
    this.fetcher = options?.fetch ?? globalThis.fetch;
  }

  /** 同一操作IDの多重送信をプロセス内で抑止し、操作とポーリングを直列化する。 */
  execute(action: HostAction, input: HostInput): Promise<HostState> {
    const key = input.operationId ? `${action}:${input.operationId}` : undefined;
    const fingerprint = JSON.stringify(input);
    if (key) {
      const prior = this.operations.get(key);
      if (prior) {
        if (prior.fingerprint !== fingerprint) return Promise.reject(new HostOperationError('IDEMPOTENCY_CONFLICT', '同じ操作IDを異なる入力で再利用できません。'));
        return prior.promise.then(state => structuredClone(state));
      }
    }
    const run = this.queue.then(() => this.perform(action, input));
    this.queue = run.catch(() => undefined);
    if (key) this.operations.set(key, { fingerprint, promise: run });
    return run.then(state => structuredClone(state));
  }

  /** 現行Sitesのラウンド操作へ変換し、未実装のゲーム全体終了や写真削除を作らない。 */
  private async perform(action: HostAction, input: HostInput): Promise<HostState> {
    const base = parseBaseUrl(this.options.baseUrl);
    if (action === 'open' && !input.roomId && !this.currentRoomId) {
      await this.gateHeaders();
      return { mode: 'sites', snapshot: null, notice: 'Sites接続モードです。部屋を作成して実際の参加URLを発行できます。ホスト認証はこのMCPプロセス内で保持します。', serverTime: new Date().toISOString() };
    }
    if (action === 'create_room') return this.createRoom(base);
    const roomId = input.roomId ?? (action === 'open' ? this.currentRoomId : undefined);
    if (!roomId || !this.rooms.has(roomId)) throw new HostOperationError('HOST_SESSION_REQUIRED', 'このMCPプロセスで作成した部屋だけ操作できます。再起動後のホスト認証復帰は未対応です。');
    let cloud = await this.getCloud(base, roomId);
    let state = this.toState(base, roomId, cloud);
    if (action === 'open' || action === 'get_room') return state;
    if (action === 'purge_images') throw new HostOperationError('UNSUPPORTED_OPERATION', 'Sitesでは提出写真を判定後に削除します。ホストからの一括削除APIは未実装です。');
    if (['start', 'advance', 'finish'].includes(action) && state.snapshot!.room.version !== input.expectedVersion) {
      throw new HostOperationError('VERSION_CONFLICT', '部屋の状態が変わりました。最新状態を取得してから操作してください。');
    }
    if (action !== 'finish') {
      if (input.source === 'preset') throw new HostOperationError('AI_REQUIRED', 'Sites接続では実AIのお題を使用します。プリセットを実AIとして実行しません。');
      if (!cloud.aiAvailable) throw new HostOperationError('AI_NOT_CONFIGURED', 'Sites側のAI接続が未設定です。デモへ切り替えず、設定を待っています。');
      if (cloud.mode !== 'ai') {
        await this.request(base, `/api/rooms/${roomId}/host/mode`, 'POST', roomId, { mode: 'ai' });
        cloud = await this.getCloud(base, roomId);
        state = this.toState(base, roomId, cloud);
      }
    }
    switch (action) {
      case 'prepare_topics':
        if (!state.snapshot!.sites!.canPrepare) throw new HostOperationError('INVALID_STATE', '参加者を1人以上登録し、進行中のラウンドと判定の終了を待ってください。');
        await this.request(base, `/api/rooms/${roomId}/host/prepare`, 'POST', roomId, {});
        break;
      case 'start':
        if (!state.snapshot!.sites!.canStart) throw new HostOperationError('INVALID_STATE', '参加者と最初のお題の準備を確認してください。');
        await this.request(base, `/api/rooms/${roomId}/host/start-now`, 'POST', roomId, {});
        break;
      case 'advance':
        if (!state.snapshot!.sites!.canAdvance) throw new HostOperationError('INVALID_STATE', 'ラウンドと判定・お題準備の終了を待ってください。');
        await this.request(base, `/api/rooms/${roomId}/host/start`, 'POST', roomId, {});
        break;
      case 'finish':
        if (!state.snapshot!.sites!.canEndRound) throw new HostOperationError('INVALID_STATE', '受付中のラウンドがありません。');
        await this.request(base, `/api/rooms/${roomId}/host/end`, 'POST', roomId, {});
        break;
    }
    const next = this.toState(base, roomId, await this.getCloud(base, roomId));
    if (action === 'finish') next.notice = `現在ラウンドの受付を終了しました。部屋全体の終了ではありません。 ${next.notice}`;
    return next;
  }

  /** Set-Cookieから作成した部屋のHttpOnly値だけを保存し、認証成功後のDTOを返す。 */
  private async createRoom(base: URL): Promise<HostState> {
    const response = await this.request(base, '/api/rooms', 'POST', undefined, { name: 'カリモノ / ONE LEASE' });
    const parsed = z.object({ id: idSchema }).safeParse(response.body);
    if (!parsed.success) throw new HostOperationError('INVALID_RESPONSE', 'Sitesの部屋作成応答を確認できませんでした。再作成前にSites側の状態を確認してください。');
    const roomId = parsed.data.id;
    const cookies = response.headers.getSetCookie();
    const pattern = new RegExp(`^host_${roomId}=([A-Za-z0-9_-]{32,256});`);
    const found = cookies.map(cookie => ({ cookie, token: pattern.exec(cookie)?.[1] })).find(value => value.token && /;\s*HttpOnly(?:;|$)/i.test(value.cookie));
    if (!found?.token) throw new HostOperationError('HOST_SESSION_REQUIRED', 'Sitesで部屋が作成されましたがホスト認証を受け取れませんでした。再作成前に状態を確認してください。');
    this.rooms.set(roomId, { cookie: `host_${roomId}=${found.token}`, version: 0, signature: '' });
    this.currentRoomId = roomId;
    let cloud = await this.getCloud(base, roomId);
    if (cloud.aiAvailable && cloud.mode !== 'ai') {
      await this.request(base, `/api/rooms/${roomId}/host/mode`, 'POST', roomId, { mode: 'ai' });
      cloud = await this.getCloud(base, roomId);
    }
    return this.toState(base, roomId, cloud);
  }

  /** isHostと部屋IDを検証して、他部屋・公開参加者DTOへの取り違えを防ぐ。 */
  private async getCloud(base: URL, roomId: string): Promise<CloudState> {
    const response = await this.request(base, `/api/rooms/${roomId}/state`, 'GET', roomId);
    const parsed = cloudStateSchema.safeParse(response.body);
    if (!parsed.success || parsed.data.room.id !== roomId) throw new HostOperationError('INVALID_RESPONSE', 'Sitesのホスト状態を確認できませんでした。認証とAPIのバージョンを確認してください。');
    return parsed.data;
  }

  /** 勝数・累計時間の実ランキングへ変換し、未取得の提出結果や通信時刻を捏造しない。 */
  private toState(base: URL, roomId: string, cloud: CloudState): HostState {
    const round = cloud.round;
    const pending = cloud.stats.pending;
    const aiReady = cloud.aiAvailable && cloud.mode === 'ai';
    const idle = !round || round.status === 'closed';
    const snapshot: HostSnapshot = {
      room: {
        roomId, roomCode: roomId, roomName: cloud.room.name,
        joinUrl: aiReady ? new URL(`/rooms/${roomId}/join`, base).href : undefined,
        status: round ? 'playing' : 'lobby', version: 0, roundCount: null, scoreUnit: 'wins',
        currentRound: round ? {
          roundId: round.id, number: round.number,
          status: round.status === 'active' ? 'active' : pending > 0 ? 'closing' : 'result',
          title: round.challenge.title, instruction: round.challenge.description,
          startsAt: new Date(round.startedAt).toISOString(), deadlineAt: new Date(round.endsAt).toISOString(),
          settleUntil: new Date(round.endsAt).toISOString(),
        } : null,
        teams: cloud.players.map(player => ({ teamId: player.id, name: player.name })),
        leaderboard: cloud.ranks.map((player, index) => ({ teamId: player.id, name: player.name, score: player.wins, rank: index + 1, totalMs: player.totalMs })),
        me: null,
      },
      topicsStatus: cloud.preparationError ? 'failed' : cloud.generating || cloud.preparing ? 'generating' : cloud.prepared ? 'ready' : 'empty',
      preparedTopics: [],
      teams: cloud.players.map(player => ({ teamId: player.id, name: player.name, lastSeenAt: null, latestSubmission: null })),
      sites: {
        aiAvailable: cloud.aiAvailable, gameMode: cloud.mode,
        canPrepare: aiReady && idle && pending === 0 && cloud.players.length > 0 && !cloud.generating && !cloud.prepared,
        canStart: aiReady && !round && cloud.players.length > 0 && cloud.prepared && !cloud.generating,
        canAdvance: aiReady && !!round && idle && pending === 0 && !cloud.generating,
        canEndRound: round?.status === 'active', pendingJudgments: pending,
        automaticLobbyStart: !round && cloud.lobby.deadline !== null,
      },
    };
    const session = this.rooms.get(roomId)!;
    const signature = JSON.stringify(snapshot);
    if (signature !== session.signature) { session.version++; session.signature = signature; }
    snapshot.room.version = session.version;
    const notice = !cloud.aiAvailable ? 'Sites接続済みですが、Sites側のAI設定が未完了です。実AIの準備・開始は利用できません。デモへは切り替えません。' : cloud.mode !== 'ai' ? 'Sitesはデモモードです。実AIモードへの変更が必要です。' : cloud.preparationError ? 'Sitesでお題の準備に失敗しました。最新状態を確認して準備を再実行してください。' : 'Sitesの実部屋へ接続しています。参加者登録後はSites側が初回のお題準備・開始を自動進行します。順位は勝数と累計回答時間で決まります。';
    const state: HostState = { mode: 'sites', snapshot, notice, serverTime: new Date(cloud.serverTime).toISOString() };
    session.state = state;
    return state;
  }

  /** Private Sitesのゲート認証だけを別ヘッダーへ設定し、通常のAuthorizationは使わない。 */
  private async gateHeaders(): Promise<Record<string, string>> {
    if (!this.options.accessTokenFile) return {};
    try {
      const raw = (await readFile(this.options.accessTokenFile, 'utf8')).trim();
      const token = raw.replace(/^Bearer /, '');
      if (!/^[\x21-\x7e]{16,8192}$/.test(token)) throw new Error();
      return { 'OAI-Sites-Authorization': `Bearer ${token}` };
    } catch {
      throw new HostOperationError('INVALID_CONFIG', 'Sitesのサービスアクセストークンファイルを確認してください。');
    }
  }

  /** リダイレクトと生エラー転送を禁止し、成功応答のJSON以外は画面へ渡さない。 */
  private async request(base: URL, path: string, method: 'GET' | 'POST', roomId?: string, body?: unknown): Promise<{ body: unknown; headers: Headers }> {
    const headers: Record<string, string> = { ...await this.gateHeaders(), Accept: 'application/json' };
    if (roomId) headers.Cookie = this.rooms.get(roomId)!.cookie;
    if (method === 'POST') { headers['Content-Type'] = 'application/json'; headers.Origin = base.origin; }
    try {
      const response = await this.fetcher(new URL(path, base), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw httpError(response.status);
      return { body: await response.json(), headers: response.headers };
    } catch (error) {
      if (error instanceof HostOperationError) throw error;
      throw new HostOperationError('SITES_UNAVAILABLE', 'Sites APIの応答を確認できませんでした。自動再試行はしません。最新状態を確認してください。');
    }
  }
}
