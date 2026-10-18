/** 移動可能なひな形内で共有する一時DTO。正式な契約導入時はこの境界で変換する。 */
export type RoomStatus = "lobby" | "playing" | "finished";
export type RoundStatus = "pending" | "active" | "closing" | "result";
export type SubmissionStatus = "queued" | "judging" | "completed" | "failed";
export type Outcome = "pass" | "fail" | "uncertain";

/** 秘密情報を含まない提出結果。 */
export interface Submission {
  submissionId: string;
  roundId: string;
  teamId: string;
  status: SubmissionStatus;
  outcome: Outcome | null;
  reasonCode: string | null;
  awardedPoints: number;
  acceptedAt: string;
  processingExpiresAt: string;
  completedAt: string | null;
}

/** 画面に渡す部屋状態。得点は本接続時にサーバーで確定する。 */
export interface RoomSnapshot {
  roomId: string;
  roomCode: string;
  status: RoomStatus;
  version: number;
  roundCount: number;
  currentRound: null | {
    roundId: string;
    number: number;
    status: RoundStatus;
    title: string;
    instruction: string;
    startsAt: string;
    deadlineAt: string;
    settleUntil: string;
  };
  teams: Array<{ teamId: string; name: string }>;
  leaderboard: Array<{ teamId: string; name: string; score: number; rank: number }>;
  me: null | { teamId: string; attemptsUsed: number; passed: boolean; latestSubmissionId: string | null };
}

/** ホストだけが参照する安全な集計DTO。 */
export interface HostSnapshot {
  room: RoomSnapshot;
  topicsStatus: "empty" | "generating" | "ready" | "failed";
  preparedTopics: Array<{ number: number; title: string; instruction: string }>;
  teams: Array<{ teamId: string; name: string; lastSeenAt: string | null; latestSubmission: Submission | null }>;
}

/** 未接続とデモを明確に区別したUI状態。 */
export interface HostState {
  mode: "demo" | "unconfigured";
  snapshot: HostSnapshot | null;
  notice: string;
  serverTime?: string;
}

/** ホスト画面から送る操作の種類。 */
export type HostAction = "create" | "refresh" | "prepare" | "start" | "advance" | "finish";
