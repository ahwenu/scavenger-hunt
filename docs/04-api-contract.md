# API契約：Sites・モバイル・Plugin Extensions

## 現在のSites実装：Issue #1

現在実装するゲームAPIは `/api/rooms/:id` 系であり、以下の `/api/v1` は初期提案として残す。Issue #1では参加者Bearerと部屋別ホストCookieを維持し、参加成功201、最大100人、10競技、初合格500点と連番順位を採用する。stateにはgame/stagesとscore/rank/awardedPointsを追加し、既存フィールドを保持する。写真は1MiB以下、multipartのrequestIdで再送を識別する。

`GET /api/rooms/:id/hint?roundId=...` は参加者の現在競技の保存済みヒントだけを返す。未用意は200のnull/false、未来・終了競技は409。登録はホストCookie付き `POST /api/rooms/:id/host/hint` の `{roundId,text}`（1〜500文字、nullで削除）。GET時のAI生成はない。

入力・出力・待機状態・エラー・全10ステージの応答例は[12 Issue #1受け渡し](12-issue1-backend-handoff.md)、環境非依存の追加型は[game-contract.ts](../apps/cloud/lib/game-contract.ts)、判断は[ADR-0013](adr/0013-issue1-player-game-contract.md)。公開環境には未配備。Pluginのデモ用DTOや独立AI APIとは別契約で、結合済みとは扱わない。

後続のAhwenu担当によるHTTP/MCP対応・公開配備の状況と、mae さん向けの最終応答例/配備版は[14](14-issue1-ahwenu-handoff.md)に記録する。元PRの検証履歴と新しい公開結果を分ける。

## 以下は初期API案（Issue #1の実装契約ではない）

API契約・HTTPルート・外部API接続・MCPサーバーはAhwenuが担当する。ルートから呼ぶゲーム処理・DB/R2・認証/認可サービスはさが さん、モバイルからのAPI利用はmae さん、拡張画面からのMCP利用は未定（Ahwenu）が担当する。責務の詳細は[07 分担](07-delivery-plan.md)を参照。

## 共通規約

これは本アプリが実装するAPI案であり、OpenAI APIの仕様ではない。ベースパスは `/api/v1`。JSONはcamelCase、IDは不透明な文字列、日時はUTCのISO 8601、得点は整数とする。画面での日時表示は端末の利用地域に合わせる。

成功は `{ "data": ..., "serverTime": "..." }`、失敗は `{ "error": { "code": "ROUND_CLOSED", "message": "提出時間を過ぎました", "retryable": false }, "requestId": "...", "serverTime": "..." }`。機密情報はメッセージに含めない。

ゲーム操作のPOSTには `Idempotency-Key` を付ける。同じ権限・ルート・キー・同じ入力は最初の結果を返し、異なる入力でのキー再利用は409。同一操作の進行中は202と状態確認先を返す。最低24時間は記録を保持する。GETは `Cache-Control: no-store`。

## 認証・認可

| 呼び出し元 | 認証 | 権限 |
| --- | --- | --- |
| モバイル参加者 | 参加成功時のSecure / HttpOnly / SameSite Cookie | 所属部屋の公開状態、自分の提出と画像 |
| Plugin Extensions UI | ホストアプリのMCPブリッジ経由 | UIから秘密トークンを直接送信しない |
| MCP→Sites（作成） | 配備者が設定する `HOST_SERVICE_TOKEN` | 部屋作成のみ。レート制限・利用上限を設ける |
| MCP→Sites（部屋操作） | 作成時に発行される部屋限定hostToken | 対象部屋の管理・参加一覧・進行操作 |

ホスト用トークンはBearer認証。部屋コードは参加の入口であり管理権限ではない。Sitesのプラットフォームアクセス制御と、アプリ独自の部屋権限は別に扱う。詳細は08。参加者の書込にはOrigin検証とCSRF対策を行い、コードの総当たりと写真提出をレート制限する。

## エンドポイント

| Method / path | 権限 | 入力 → 結果 |
| --- | --- | --- |
| `POST /rooms` | 作成サービス | `{}` → 201: roomId、roomCode、joinUrl、hostToken、expiresAt |
| `POST /rooms/join` | 未参加可 | `{roomCode, teamName}` → 201: roomId、teamId、Cookie設定 |
| `GET /session` | 参加者 | → 所属roomId、teamId、expiresAt |
| `GET /rooms/:id` | 所属参加者/ホスト | → RoomSnapshot。参加者には未来のお題を含めない |
| `GET /rooms/:id/host` | ホスト | → HostSnapshot：RoomSnapshot＋問題準備・チーム提出状況 |
| `POST /rooms/:id/topics` | ホスト | `{source: "ai" \| "preset"}` → お題準備状態。ロビーのみ |
| `POST /rooms/:id/start` | ホスト | `{expectedVersion}` → 第1問開始後のRoomSnapshot |
| `POST /rooms/:id/advance` | ホスト | `{expectedVersion}` → 次問開始後のRoomSnapshot。resultのみ |
| `POST /rooms/:id/finish` | ホスト | `{expectedVersion}` → finished。進行中なら中止理由も記録 |
| `POST /rounds/:id/submissions` | 所属参加者 | multipart: `photo`（JPEG） → 201: Submission。重複処理中は202 |
| `GET /submissions/:id` | 本人/部屋ホスト | → Submission |
| `GET /submissions/:id/image` | 本人/部屋ホスト | → JPEG、保持期限後410 |
| `POST /rooms/:id/purge-images` | ホスト | → 削除処理の件数。ゲーム終了後のみ |

参加コードは6桁数字、teamNameは前後空白除去後1〜20文字、同一部屋内で同名不可。参加上限10、ロビーのみ。joinUrlはSitesの参加ページのURLで、コードのみを含める。hostTokenは含めない。

## 共有DTO

以下のTypeScript表記を基に `contracts/` に実スキーマを作成し、モバイル・MCP・バックエンドで共有する。

```ts
type RoomStatus = "lobby" | "playing" | "finished";
type RoundStatus = "pending" | "active" | "closing" | "result";
type SubmissionStatus = "queued" | "judging" | "completed" | "failed";
type Outcome = "pass" | "fail" | "uncertain";

interface RoomSnapshot {
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
  me: null | { teamId: string; attemptsUsed: number; passed: boolean;
    latestSubmissionId: string | null };
}

interface Submission {
  submissionId: string;
  roundId: string;
  teamId: string;
  status: SubmissionStatus;
  outcome: Outcome | null;
  reasonCode: "CONDITIONS_MET" | "CONDITIONS_NOT_MET" | "PHOTO_UNCLEAR"
    | "AI_UNAVAILABLE" | "PROCESSING_TIMEOUT" | "GAME_FINISHED" | null;
  awardedPoints: number;
  acceptedAt: string;
  processingExpiresAt: string;
  completedAt: string | null;
}

interface HostSnapshot {
  room: RoomSnapshot;
  topicsStatus: "empty" | "generating" | "ready" | "failed";
  preparedTopics: Array<{ number: number; title: string; instruction: string }>;
  teams: Array<{ teamId: string; name: string; lastSeenAt: string | null;
    latestSubmission: Submission | null }>;
}
```

`serverTime`は全レスポンスの外側に付ける。ホストでは `me=null`。`preparedTopics`はホスト専用の確認用データで、参加者には返さない。`lastSeenAt` は参加者の部屋取得時に最大10秒間隔で更新し、即時オンライン判定は保証しない。ホストUIには「最終通信」と表示する。

## 写真提出の挙動

例：`POST /api/v1/rounds/round_1/submissions`、`Content-Type: multipart/form-data`、`Idempotency-Key: <UUID>`、`photo=<JPEG binary>`。teamId・得点・お題条件はクライアントから指定できない。

サーバーは全体の画像受信・検証完了後のDB受付時刻を `acceptedAt` にする。受付直前に締切と所属を確認し、受付と同時提出枠の確保を原子的に行う。画像保存後にAI判定し、通常は同じリクエストで201と確定したSubmissionを返す。

アプリ側の処理予算は受付後15秒を初期案とする。中断に備え、受付時に `processingExpiresAt = min(acceptedAt + 20秒, settleUntil)` を記録する。時間切れはfailedにし、AIの遅延結果を後から加点しない。通信切断時はGETで同じsubmissionIdを確認する。POSTの結果を一度も受け取れなかった場合は同じキーのPOSTでIDを回収する。

GET/ホスト操作時にも期限切れ処理を行うため、常駐ワーカーがなくても復旧する。202は永続ジョブの完了保証を意味しない。試行回数は受付済みの新規提出を数え、failedも含め最大5回。

## 主なエラー

| HTTP | code | 画面の対応 |
| --- | --- | --- |
| 400 | INVALID_INPUT / INVALID_IMAGE | 入力・画像を修正 |
| 401 | SESSION_EXPIRED / HOST_AUTH_REQUIRED | 再参加案内、またはホスト再接続 |
| 403 | FORBIDDEN | 他チーム/他部屋の操作を拒否 |
| 404 | ROOM_NOT_FOUND | コードを再確認 |
| 409 | ROOM_STARTED / ROUND_CLOSED / ALREADY_PASSED / SUBMISSION_IN_PROGRESS / ATTEMPTS_EXCEEDED / VERSION_CONFLICT / ROUND_SETTLING | 最新状態を取得して表示を更新 |
| 413 | IMAGE_TOO_LARGE | 2 MiB以下に圧縮、または撮り直し |
| 429 | RATE_LIMITED | Retry-Afterに従う |
| 503 | AI_UNAVAILABLE | 提出記録があればその状態を確認。新規再挑戦はユーザー操作 |

`expectedVersion`の不一致は409。二重に「次問」を押して2問進めない。最初にIdempotency-Keyを解決してから状態競合を判定する。
