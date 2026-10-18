/** Sites接続の差し替え境界と、明示的に有効化するメモリ上のデモを定義する。 */
import { randomUUID } from 'node:crypto';
import type { HostSnapshot, HostState } from '../shared/contracts.js';

export type HostAction = 'open' | 'create_room' | 'get_room' | 'prepare_topics' | 'start' | 'advance' | 'finish' | 'purge_images' | 'set_hint';
export interface HostInput {
  roomId?: string;
  operationId?: string;
  expectedVersion?: number;
  source?: 'ai' | 'preset';
  roundId?: string;
  text?: string | null;
}

/** Sitesアダプターに後から実装する操作境界。秘密値はHostStateへ入れない。 */
export interface HostAdapter {
  execute(action: HostAction, input: HostInput): HostState | Promise<HostState>;
}

/** UIへ安全に返せる固定文言のエラー。外部APIの例外文字列は転送しない。 */
export class HostOperationError extends Error {
  /** 操作を再開できるか判断するためのアプリ固有コードを保持する。 */
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'HostOperationError';
  }
}

/** 実接続の未実装を成功扱いせず、最初から外部通信を行わない。 */
export class NotConfiguredHostAdapter implements HostAdapter {
  /** 未接続の初期画面だけ返し、ゲーム操作は明示的に失敗させる。 */
  execute(action: HostAction): HostState {
    if (action !== 'open') {
      throw new HostOperationError('NOT_CONFIGURED', 'Sites APIへの接続は未実装です。部屋の作成・操作はまだ利用できません。');
    }
    return {
      mode: 'unconfigured',
      snapshot: null,
      notice: 'Sites API未接続のひな形です。実際の参加者・写真・ゲームは扱いません。',
      serverTime: new Date().toISOString(),
    };
  }
}

const DEMO_NOTICE = 'ゲーム操作のデモ：参加者・得点はサンプルです。この部屋は写真保存には接続せず、再起動すると消えます。下のAIお題プレビューは、この部屋とは別の実API接続です。';
const DEMO_ROUND_MS = 15_000;

/** 再起動で消える見本データだけで、画面とMCPの結線を確認する。 */
export class DemoHostAdapter implements HostAdapter {
  private snapshot: HostSnapshot | null = null;
  private readonly operations = new Map<string, { fingerprint: string; state: HostState }>();

  /** テストでは時間を注入し、実際の15秒待ちを避ける。 */
  constructor(private readonly now: () => number = Date.now) {}

  /** 冪等性・バージョン・許可された状態遷移を通してデモを操作する。 */
  execute(action: HostAction, input: HostInput): HostState {
    if (action === 'set_hint') throw new HostOperationError('UNSUPPORTED_OPERATION', '共通ヒントの保存はSites接続時だけ利用できます。デモへ保存しません。');
    const operationKey = input.operationId ? `${action}:${input.operationId}` : null;
    const fingerprint = JSON.stringify(input);
    if (operationKey) {
      const prior = this.operations.get(operationKey);
      if (prior) {
        if (prior.fingerprint !== fingerprint) {
          throw new HostOperationError('IDEMPOTENCY_CONFLICT', '同じoperationIdを異なる入力で再利用できません。');
        }
        return structuredClone(prior.state);
      }
    }
    this.settleRound();
    if (action === 'create_room') {
      this.createRoom();
    } else if (action !== 'open' || input.roomId) {
      const snapshot = this.requireRoom(input.roomId);
      if (['start', 'advance', 'finish'].includes(action) && snapshot.room.version !== input.expectedVersion) {
        throw new HostOperationError('VERSION_CONFLICT', '部屋の状態が更新されました。最新状態を取得してください。');
      }
      switch (action) {
        case 'prepare_topics':
          if (snapshot.room.status !== 'lobby') this.invalidState();
          if (input.source === 'ai') {
            throw new HostOperationError('NOT_CONFIGURED', 'デモではAI生成を利用できません。プリセットを選んでください。');
          }
          snapshot.preparedTopics = [
            { number: 1, title: '赤くて丸いもの', instruction: '会場内の赤くて丸いものを探そう（デモ）。' },
            { number: 2, title: '青いもの', instruction: '青いものを探そう（デモ）。' },
            { number: 3, title: '持ち手があるもの', instruction: '持ち手があるものを探そう（デモ）。' },
          ];
          snapshot.topicsStatus = 'ready';
          snapshot.room.version++;
          break;
        case 'start':
          if (snapshot.room.status !== 'lobby' || snapshot.topicsStatus !== 'ready') this.invalidState();
          this.beginRound(1);
          break;
        case 'advance':
          if (snapshot.room.status !== 'playing' || snapshot.room.currentRound?.status !== 'result') this.invalidState();
          if (snapshot.room.currentRound.number >= (snapshot.room.roundCount ?? 3)) {
            throw new HostOperationError('INVALID_STATE', '最終問の結果です。ゲーム終了操作で最終結果を確定してください。');
          }
          this.beginRound(snapshot.room.currentRound.number + 1);
          break;
        case 'finish':
          if (snapshot.room.status === 'finished') this.invalidState();
          snapshot.room.status = 'finished';
          snapshot.room.version++;
          break;
        case 'purge_images':
          if (snapshot.room.status !== 'finished') this.invalidState();
          // 写真を一度も保存していないため、削除済みという実処理の結果は作らない。
          break;
      }
    }
    const state = this.state();
    if (operationKey) this.operations.set(operationKey, { fingerprint, state: structuredClone(state) });
    return state;
  }

  /** サンプル部屋を1つ作り、実サービスの参加URLを発行したように見せない。 */
  private createRoom(): void {
    const teams = [
      { teamId: 'demo_team_a', name: 'サンプル チームA' },
      { teamId: 'demo_team_b', name: 'サンプル チームB' },
      { teamId: 'demo_team_c', name: 'サンプル チームC' },
    ];
    this.snapshot = {
      room: {
        roomId: `demo_${randomUUID()}`,
        roomCode: '000000', status: 'lobby', version: 1, roundCount: 3, currentRound: null,
        teams, leaderboard: teams.map(team => ({ ...team, score: 0, rank: 1 })), me: null,
      },
      topicsStatus: 'empty', preparedTopics: [],
      teams: teams.map(team => ({ ...team, lastSeenAt: null, latestSubmission: null })),
    };
  }

  /** 指定されたデモ部屋だけを返す。実認可の代替ではない。 */
  private requireRoom(roomId?: string): HostSnapshot {
    if (!this.snapshot || !roomId || this.snapshot.room.roomId !== roomId) {
      throw new HostOperationError('ROOM_NOT_FOUND', 'このプロセスに該当するデモ部屋はありません。');
    }
    return this.snapshot;
  }

  /** 15秒の見本ラウンドを開始する。採点や写真判定は実行しない。 */
  private beginRound(number: number): void {
    const snapshot = this.snapshot!;
    const topic = snapshot.preparedTopics[number - 1]!;
    const startsAt = this.now();
    snapshot.room.currentRound = {
      roundId: `${snapshot.room.roomId}_round_${number}`, number, status: 'active',
      title: topic.title, instruction: topic.instruction,
      startsAt: new Date(startsAt).toISOString(),
      deadlineAt: new Date(startsAt + DEMO_ROUND_MS).toISOString(),
      settleUntil: new Date(startsAt + DEMO_ROUND_MS).toISOString(),
    };
    snapshot.room.status = 'playing';
    snapshot.room.version++;
  }

  /** 期限を過ぎた見本を結果表示へ進める。サンプル順位は固定の説明用データ。 */
  private settleRound(): void {
    const snapshot = this.snapshot;
    const round = snapshot?.room.currentRound;
    if (!snapshot || snapshot.room.status !== 'playing' || round?.status !== 'active') return;
    if (this.now() < Date.parse(round.deadlineAt)) return;
    round.status = 'result';
    snapshot.room.version++;
    snapshot.room.leaderboard = snapshot.room.teams.map((team, index) => ({
      ...team, score: (3 - index) * 10 * round.number, rank: index + 1,
    }));
  }

  /** 画面に渡すDTOはコピーし、アダプター内部の可変状態を共有しない。 */
  private state(): HostState {
    return {
      mode: 'demo', snapshot: structuredClone(this.snapshot), notice: DEMO_NOTICE,
      serverTime: new Date(this.now()).toISOString(),
    };
  }

  /** 文書化したゲーム操作の前提を満たさない場合に拒否する。 */
  private invalidState(): never {
    throw new HostOperationError('INVALID_STATE', 'このデモの状態では操作できません。最新状態とお題準備を確認してください。');
  }
}
