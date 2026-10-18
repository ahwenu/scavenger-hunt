/** ゲームの表示に必要な情報だけを効果音へ渡す。 */
export interface SoundSnapshot {
  roomId: string;
  roundId?: string;
  phase?: string;
  ready?: boolean;
  participants?: string[];
  scores?: Array<{ id: string; score: number }>;
}
export function createGameSoundObserver(play: (name: string) => void): {
  observe(next: SoundSnapshot | null): void;
  tick(key: string | null, deadline: number, now: number): void;
};
