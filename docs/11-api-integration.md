# AhwenuのAPI処理とPlugin Extensionsの接続

本書はローカル独立APIの契約・検証記録。新Sitesの配備ではCloudへResponses生成を移植し、pluginはsitesモードでゲームAPIへ接続する。独立Node APIをWorkersで起動する方式は採らない。新しい配備・認証・実ゲーム結合の状態は[12](12-sites-deployment.md)に記録する。既存のローカルAPI成功を新Sitesの成功とは扱わない。

新Sitesではv1配備・public変更と、インストール済みplugin 0.2.0の実MCP/HTTPによる部屋→匿名参加→生成→開始→JPEG提出/判定→勝利数順位→ラウンド終了を1例確認した。これは下記のローカルAPI検証とは別の記録であり、最新ソースの同期とv2配備は12に追記する。

## 担当と配置

Ahwenuは `api/` の独立AI APIと `plugin/src/server/` のMCP接続を担当する。Sitesの参加者画面・部屋・提出受付・締切・加点・順位・DBは他担当が実装する。今回の接続作業では `apps/cloud/` とSitesの配備設定を変更しない。

```text
Plugin Extensions UI
  → MCPブリッジ
  → pluginのMCPサーバー
  → api/ のHTTP API
  → お題生成・写真判定の外部AI

Sites側のゲームAPI → 同じHTTP AI API（後続の接続作業）
```

`api/` と `plugin/` は別々のpackage.json・lock・起動設定を持ち、親のデモ用ワークスペースや相互のソースをimportしない。現在はローカル接続を先行する。公式CLIでプラグインのローカル登録・有効化は確認済み。公開配備・Sitesからの接続・実Plugin Extensions内の表示と操作は別途検証する。

## ローカルの接続設定

Node.js 22.13以上を使う。APIは `api/` で `npm ci`、`npm run check`、`npm test`、`npm start`。標準の待受先は `http://127.0.0.1:4318`。拡張のプレビューは `plugin/` でビルド後に `npm run preview`、標準URLは `http://127.0.0.1:4173/`。

両方の `npm start` とpluginの `npm run preview` は、各パッケージの作業ルートにあるGit対象外の `.env.local` を任意で読み込む。変数名は `.env.example` を参照し、秘密値を記入したファイルをコミット・梱包しない。

| 設定先 | 変数 | 役割 |
| --- | --- | --- |
| api/.env.local | `OPENAI_KEY_FILE` | 利用者が指定した既存dotenvファイルを参照し、`OPENAI_API_KEY` をサーバーだけで読む |
| api/.env.local | `API_SERVICE_TOKEN_FILE` | サービス通信用トークンを記したテキストファイルを参照 |
| api/.env.local | `PORT` | ローカル待受ポート。標準4318 |
| api/.env.local | `CHALLENGE_MODEL`、`AGENTS_MODEL`、`DECISIONS_MODEL` | 標準生成・参考写真付き生成・写真判定のモデル |
| api/.env.local | `AI_REFERENCE_PHOTOS` | 標準falseは文章のお題。trueでAgentsの参考写真検索を有効化 |
| plugin/.env.local | `KARIMONO_API_URL` | APIのベースURL。ローカル例は `http://127.0.0.1:4318` |
| plugin/.env.local | `KARIMONO_API_TOKEN_FILE` | APIと同じサービス通信用トークンのファイルを参照 |
| plugin/.env.local | `KARIMONO_MODE` | ゲーム画面の `unconfigured` / `demo`。実AIの接続設定と独立 |

OpenAIキーの値・実際の保存先は本書へ記載しない。APIサーバーだけがキーを読み、pluginにはサービス用トークンだけを渡す。環境変数で直接指定する場合はAPIの `OPENAI_API_KEY` / `API_SERVICE_TOKEN`、pluginの `KARIMONO_API_TOKEN` を使えるが、ファイル指定との併用は避ける。APIのサービス用トークンは32〜512文字・空白なし。

## HTTPインターフェース

`/health` 以外は `Authorization: Bearer <サービス用トークン>` を要求する。ブラウザへトークンを渡さず、MCPまたはSitesのサーバーから呼ぶ。現在のAPIはループバック専用で、クロスオリジンのブラウザ通信を拒否する。

| メソッド・パス | 入力 | 成功時の返却 |
| --- | --- | --- |
| `GET /health` | なし。認証不要 | `{service: "karimono-ai", configured: boolean}` |
| `POST /api/v1/ai/challenges` | JSON `{requestId: UUID, context?: {history?: string[], playerCount?: number}}` | `{data: Challenge, serverTime: ISO文字列}`。新規201、同じ入力の再取得200 |
| `POST /api/v1/ai/judgments` | multipart：`challengeId` と `photo`（2MiB以下のJPEG） | `{data: {outcome, reasonCode, provider}, serverTime}` |
| `GET /api/v1/ai/challenges/:id/reference` | お題ID、サービス認証 | 参考画像のバイト列。利用可能な場合のみ |

`Challenge` は `challengeId`、`title`、`description`、`criteria: string[]`、`durationSeconds` を含む。参考写真があれば `reference` に認証付き画像の相対 `url`、`author`、`licenseName`、`licenseUrl`、`sourcePageUrl` を含める。外部サービスのセッションID・内部トレース・キーは返さない。

標準のお題生成はResponses APIのStructured Outputsを使い、文章のお題と条件を生成する。`store: false`、厳密なJSON Schema、20秒のタイムアウト、自動再試行なしとする。標準モデルは `CHALLENGE_MODEL` で指定する。

`AI_REFERENCE_PHOTOS=true` を明示したときだけ、Agents APIがWikimedia Commonsで参考写真を検索・取得する。この場合は `AGENTS_MODEL` を使い、生成25秒に加えてセッションの後処理が必要になる。参考写真モードの失敗を文章や固定プリセットで自動補完しない。

写真判定ではDecisions APIへお題条件・提出写真・利用可能な参考写真を渡す。`DECISIONS_MODEL` を使い、タイムアウト15秒・自動再試行なし。判定は `pass / fail / uncertain`、理由コードは `CRITERIA_MET / CRITERIA_NOT_MET / AI_UNCERTAIN`。得点は返さず、ゲーム側が結果を受けて確定する。3つのモデル設定は現在いずれも `gpt-6-luna` が初期値。

`requestId` は生成要求の重複実行を防ぐ。同じIDで異なるcontextを送ると409。お題・参考写真・生成要求の記録はメモリ内に20分保持し、再起動で失う。20分はAPIの保持時間であり、`durationSeconds` のゲーム制限時間をサーバーが管理する意味ではない。判定用に受け取った写真は正規化してAIへ渡し、永続保存しない。

失敗形式は `{error: {code, message, retryable}}`。401認証失敗、400入力/写真不正、404対象なし/期限切れ、409処理中/ID再利用、429上限、502外部AI失敗、503未設定などを固定コードへ正規化する。現時点では1時間あたり生成20回・判定60回、生成同時1件・判定同時2件を上限とする。自動で合格へ置き換えない。

## 拡張のMCPインターフェース

| ツール | 入力 | structuredContent |
| --- | --- | --- |
| `ai_status` | `{}` | `{aiStatus: {configured, available, notice}}` |
| `ai_generate_challenge` | `{requestId: UUID}` | `{aiResult: {data: Challenge, serverTime}}` |

両ツールはUIからの利用に限定する。失敗時は `isError: true` と `{aiError: {code, message}}` を返し、秘密や上流の生エラーを含めない。MCPサーバーはAPIのヘルス取得と生成要求だけを行い、ゲーム管理ツールと分ける。POSTのタイムアウトは35秒、リダイレクトと自動再試行は行わない。

実AIの表示領域には生成したお題と条件・参考写真の出典情報を表示する。認証付き参考画像をブラウザから直接取得せず、サービス用トークンを画像URLへ入れない。画像表示や写真判定の拡張UIは後続作業。実AI生成結果をサンプルの部屋・参加チーム・得点・順位へ反映しない。

## Sites担当への受け渡し

Sites側はゲームの部屋/ラウンドIDと `challengeId` を対応させ、判定用APIへサーバーから写真を渡す。認可、受付時刻、締切、試行回数、冪等な提出確定、加点・順位、画像の保存・削除はSites側で処理する。AI APIのサービス認証を、参加者セッションや部屋限定ホスト権限として流用しない。

公開接続を始める前に、到達可能なAPI配備先・接続認可・保持時間・タイムアウト・料金上限・契約の対応を両担当で決める。現時点ではAPIの独立実装とローカルMCP接続を先行し、Sites側のゲーム実装を複製しない。

## 検証状況

最新の確認（2026-10-18）：ユーザーがWork内の実Plugin Extensionsで「API接続確認」→「AI生成」を操作。提供画像2枚から、API利用可能・接続済み、お題「文房具のペンを探そう」、条件「文房具のペンが写っている」「ペンに細長い形が見える」、120秒の表示を確認した。ユーザー操作と提供画像を根拠とする成功1例で、Codexによる直接UI操作とは区別する。写真判定UI、Sitesのゲーム進行・参加者・得点・順位との結合は未検証。

初期plugin骨格の検証記録は[ADR-0008](adr/0008-portable-plugin-scaffold.md)を参照。参考写真付きAgentsの初回試験は502で、原因は未特定。その後、参考写真なしの旧Agents方式の文章生成で `text_agent_cleanup_failed` を確認し、セッション後処理に失敗した。この結果を受け、標準の文章生成をセッションを使わないResponsesへ変更した。参考写真付きモードの一連の成功は未確認。

変更後の構成で2026-10-18に以下を確認した。

- `api/` の18件、`plugin/` の15件のテストが成功。
- plugin配布物の可搬性検証が成功。展開した単独配布物で10 MCPツールとUIリソースを確認。
- ブラウザプレビュー→stdio MCP→独立API→Responses APIを通し、「紙コップを探そう」のお題生成・表示が成功。
- 同じ生成IDに対し、取り込み済みのバナナ画像をJPEGへ正規化して判定APIへ送信。HTTP 200、`outcome: fail`、`reasonCode: CRITERIA_NOT_MET`、`provider: Decisions API` を確認。

さらに公式CLIで `karimono-host@karimono-local` を登録・インストールし、一覧で有効化とversion 0.1.0を確認した。キャッシュにはAPI URLとサービス用トークンファイル参照だけを設定し、OpenAIキーを配布していない。

ブラウザ実接続と、ユーザーによる実拡張内の接続確認・生成表示を各1例確認した。合否の精度・遅延分布・負荷の評価は別途必要。写真判定UI、参考写真付きAgentsモード、公開配備、SitesのゲームAPI接続、実際のスマホ参加・得点・順位の結合は未検証。

`api/` の `npm run smoke:local` はお題を1回生成し、任意の `API_SMOKE_PHOTO_FILE` があればそのJPEGを1回判定する。結果はGit対象外の `api/.local/verification.json` に保存する。キー・トークン・写真の実パスは文書に転記しない。過去のデモの公開/AI記録を、今回の接続成功とは扱わない。

判断の記録：[ADR-0010](adr/0010-independent-ai-api.md)。
