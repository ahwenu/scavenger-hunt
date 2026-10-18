# カリモノ AI API（Ahwenu担当）

お題生成（標準はResponses API、参考写真付きはAgents API）と写真判定（Decisions API）の単独Nodeサービスです。`api/` 全体を移動できます。親フォルダのパッケージやSitesのソースは参照しません。部屋・参加者・得点・ランキング・永続化はSitesのバックエンド担当です。

## 起動

Node.js 22.13以上で、このフォルダ内から実行します。

```sh
npm ci
cp .env.example .env.local
# .env.local のファイルパスを自分の環境に合わせて編集
npm start
```

標準アドレスは `http://127.0.0.1:4318` です。`PORT` でポートのみ変更できます。既存の `.env.local` があればコピーせず、その設定を使います。

`OPENAI_API_KEY` または `OPENAI_KEY_FILE` を明示します。後者は `OPENAI_API_KEY="..."` を含む既存dotenvファイルです。別プロジェクトのキーを自動探索する動作はありません。

サービス間の認証には別の `API_SERVICE_TOKEN`、またはトークンの値だけを書いた `API_SERVICE_TOKEN_FILE` が必要です。32〜512文字の空白を含まない値を設定してください。キー・トークン・実パスをコミットせず、ファイルは所有者だけが読める権限にします。`.env.local` と `.local/` はGit対象外です。相対ファイルパスの基準は起動時のカレントディレクトリです。

キー未設定でも起動でき、`/health` は `configured: false` を返します。キーとサービス用トークンの両方があると `true` になります。これは利用権限・残高・実際のAI呼出しの成功を意味しません。

MVPのお題生成は、既定の `AI_REFERENCE_PHOTOS=false` でResponses APIのStructured Outputsでテキストだけを生成します。セッションは作成せず、`store: false` を指定します。Wikimediaに接続せず、公開条件を提出写真と照合します。参考写真を有効にするときだけ `AI_REFERENCE_PHOTOS=true` を指定してください。この場合は写真の検索・取得にも成功する必要があり、失敗時にテキストやプリセットへ暗黙に切り替えません。標準生成は `CHALLENGE_MODEL`、参考写真付き生成は `AGENTS_MODEL`、写真判定は `DECISIONS_MODEL` で指定し、すべて既定は `gpt-6-luna` です。

## サービス契約

`/health` 以外には `Authorization: Bearer <サービス用トークン>` が必要です。トークンをスマホのJavaScriptやPlugin Extensionsの表示用HTMLへ埋め込まないでください。MCPサーバーまたはSitesのバックエンドから呼びます。このローカルアドレスには、公開Sitesから直接接続できません。公開配備と認証の結合は別途必要です。

| HTTP | パス | 入力・用途 |
| --- | --- | --- |
| GET | `/health` | `{ service: "karimono-ai", configured: boolean }` |
| POST | `/api/v1/ai/challenges` | JSON `{ requestId: UUID, context?: { history?: string[], playerCount?: number } }` |
| GET | `/api/v1/ai/challenges/:id/reference` | 認証付き参考画像バイト列 |
| POST | `/api/v1/ai/judgments` | multipart `challengeId` と `photo`（JPEG、最大2MiB） |

生成成功はHTTP 201と `{ data: { challengeId, title, description, criteria: string[], durationSeconds: 120, reference? }, serverTime }` を返します。`reference` は `{ url, author, licenseName, licenseUrl, sourcePageUrl }`。`url` はこのAPIへの相対パスで、画像取得にも認証が必要です。同じ `requestId` と同じ入力の再送は有効期限内で同じお題をHTTP 200で返します。異なる入力での同じIDの使い回しはHTTP 409です。

判定成功は `{ data: { outcome, reasonCode, provider: "Decisions API" }, serverTime }` です。`outcome` は `pass` / `fail` / `uncertain`、対応するコードは `CRITERIA_MET` / `CRITERIA_NOT_MET` / `AI_UNCERTAIN`。確率の閾値0.8・0.2は暫定です。AI拒否・回答の欠損・通信失敗は不明写真とは区別してHTTP 502を返します。APIは得点を決定しません。

エラーは常に `{ error: { code, message, retryable } }` です。認証401、接続元403、入力400、上限413/429、処理中409、期限切れ404、未設定503、外部AIエラー502を返します。SDKの生エラーは返しません。

サーバーの標準エラー出力には、失敗時の処理名・許可した固定コード・許可した処理段階だけをJSONで記録します。SDKの生メッセージ、キー、入力写真、お題本文は記録しません。

## 現在の制限と検証

- お題・参考画像・再送IDはプロセス内の一時メモリのみです。最大20件、20分で期限切れになり、次のAIリクエスト時に除去します。再起動で消失します。
- 1プロセス・1時間につき生成20回／判定60回（失敗も消費）。並行生成1件／判定2件。課金額の上限を保証する設定ではありません。
- 標準生成は20秒、参考写真付き生成は25秒とセッション後処理、判定は15秒。自動リトライはありません。
- 提出写真は12メガピクセル以下をデコードし、EXIFを除いて最大960pxのJPEGに正規化します。提出写真は保存しません。明示的に有効にした参考写真はWikimedia Commonsから許諾メタデータと一緒に取得します。
- ブラウザのクロスオリジン呼出しと外部Hostを拒否し、CORSを一般公開しません。公開運用用の共有サービスではありません。

`npm run check` と `npm test` で構文・18件のテストを実行します。テストは注入したAIを使い、OpenAIやWikimediaへの通信は行いません。`src/text-agent.mjs` がResponses APIを使う標準のお題生成です。`src/reference-agent.mjs` は取り込み済みデモの関数ツール型Agents実装をこの単独パッケージへ複製し、エラー情報の保持を縮小したものです。

公式契約の確認先：[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)、[Agents API](https://developers.openai.com/api/docs/guides/agents-api/overview)、[Decisions API](https://developers.openai.com/api/docs/guides/decisions)。実際の利用権限・判定品質・外部写真取得は実接続での検証が必要です。
