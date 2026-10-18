/** 両画面へ同梱する再生処理の型契約。 */
export interface SoundClip { src: string; priority?: number; volume?: number; cooldown?: number }
export interface SoundPlayer {
  unlock(): Promise<boolean>;
  play(name: string): Promise<boolean>;
  stop(): void;
  setEnabled(enabled: boolean): void;
  getState(): { enabled: boolean; unlocked: boolean };
  subscribe(listener: () => void): () => void;
  dispose(): void;
}
export function createSoundPlayer(clips: Record<string, SoundClip>): SoundPlayer;
