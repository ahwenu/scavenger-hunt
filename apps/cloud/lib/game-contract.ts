/** Issue #1の追加契約。Workers・React・秘密設定へ依存しない。 */
export const TOTAL_ROUNDS = 10;
export const MAX_PLAYERS = 100;
export const PASS_POINTS = 500;
export type GameStatus = 'lobby' | 'playing' | 'finished';
export type StageStatus = 'completed' | 'active' | 'locked';
export interface GameProgress {
  game: { status: GameStatus; totalRounds: number };
  stages: Array<{ number: number; status: StageStatus }>;
}
export interface GameRank {
  id: string; name: string; joinedAt: number; wins: number;
  score: number; rank: number; totalMs: number;
}
export interface RoundHint { roundId: string; text: string | null; available: boolean }
export interface AwardedSubmission {
  id: string; roundId: string;
  status: 'queued' | 'processing' | 'accepted' | 'rejected' | 'error';
  awardedPoints: number;
  verdict: null | { pass?: boolean; reason?: string; [key: string]: unknown };
}
