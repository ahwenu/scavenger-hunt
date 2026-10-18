/** AhwenuのAI専用APIとホストUIをつなぐ、安全な公開DTO。 */
export interface AIStatus {
  configured: boolean;
  available: boolean;
  notice: string;
}

/** ゲームの採点・参加状態と分離した、お題生成APIの結果。 */
export interface AIChallenge {
  challengeId: string;
  title: string;
  description: string;
  criteria: string[];
  durationSeconds: number;
  reference?: {
    url: string;
    author: string;
    licenseName: string;
    licenseUrl: string;
    sourcePageUrl: string;
  };
}

/** AIの呼出結果。秘密設定・OpenAIキー・内部ツールログを含めない。 */
export interface AIResult {
  data: AIChallenge;
  serverTime: string;
}
