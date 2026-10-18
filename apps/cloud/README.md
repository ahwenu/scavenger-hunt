# AI借り物競争 — 公開Sitesバックエンド

既存のフロントエンドをCloudflare Workersで配信し、D1に部屋・参加者・ラウンド・投稿・判定キューを保持する。写真は判定の間だけR2に置き、判定完了後に削除する。`build/sites-worker.ts` から既存フロント資産とAPIを配信し、Sites/Vinextのビルド統合は維持している。

- `lib/cloud-api.ts`: ルームAPI、部屋別HttpOnlyホストCookie、D1の受付順、R2投稿、判定キュー。
- `lib/cloud-ai.ts`: 公式Agents APIによる共有お題生成、公式Decisions APIによる写真判定、明示的デモ。
- `lib/assets.ts`: モノレポの `apps/web` から生成する配信資産。編集元は `apps/web`。
- `db/schema.ts` と `drizzle/`: 永続スキーマとSites適用用migration。

## 70人同時参加への構成

写真受付はHTTP 202で返し、写真本体を受け取り終わったサーバー時刻とD1の連番で順位を決める。AI応答完了順は順位に使わない。ブラウザはスナップショットを定期取得する。D1の条件付きUPDATEにより、複数Worker合計で最大8件だけ同時に写真を判定する。残りはD1キューに保持し、投稿・画面の定期取得がキュー処理を駆動する。キューは全体200件・各部屋100件、参加者は各部屋200人まで。

写真はJPEG/PNG/WebP、1MBまで。Content-Lengthがない場合もアップロード本文を1.1MBで打ち切る。1人1ラウンドの処理中・合格投稿は一つだけ。リクエストID再送とラウンド内の同一画像バイトをD1一意制約で防ぐ。判定には20秒のAPIタイムアウトを設け、429/503が最初の1.5秒以内に返った場合だけ400ms待って1回再試行する。復帰できなければエラーとし、合格扱いにしない。中断したリースは画面取得時にエラーへ回復して再投稿できる。端末が全て閉じている間の常時実行ワーカーは持たず、画面が再度開かれた際に未完了処理を再開する。

順位・トークン・生成状況・履歴はルームごとに分離する。写真がエラーで削除できなかった場合は次の状態同期で削除を再試行する。D1には写真画像を保存しない。

## 接続とビルド

`.openai/hosting.json` は登録済みSite IDと `DB` / `BUCKET` バインディングを宣言する。実AIキーはSitesの実行時シークレット `OPENAI_API_KEY` のみを使い、ローカル秘密ファイルへのパスや値を配信物へ含めない。キーのない環境でもデモモードで遊べる。

依存追加時はこのディレクトリでlockを同期してからSitesの `install-dependencies.mjs` を使う。型チェック:

```sh
node node_modules/typescript/bin/tsc --noEmit
```

Sitesの `build-site.mjs` でビルドする。D1変更時は `npm run db:generate` でSQLとDrizzleメタデータを生成する。Sitesが公開前にmigrationを適用する。ローカルの空のD1で初回検証する場合はビルド後に:

```sh
node node_modules/wrangler/bin/wrangler.js d1 execute DB --config dist/server/wrangler.json --local --persist-to .wrangler/state --file drizzle/0000_nappy_kinsey_walden.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js dev --config dist/server/wrangler.json --local --persist-to .wrangler/state --ip 127.0.0.1 --inspector-port 0 --port 4319
```

このSQL直接実行コマンドは空のローカルDBの初回専用であり、公開DBに手動適用しない。

## 検証範囲

Workersビルド、TypeScriptチェック、ローカルD1/R2で部屋作成201→参加200→開始200→投稿202→デモ合格→ランキング、PNG QR配信200を確認した。写真を使う実Decisions APIの肯定/否定確認はモノレポの `docs/real-image-verification.md` を参照。70台の実端末・70件の有料AI同時判定を実施したとは主張しない。実AIのキュー待ち時間はOpenAIアカウントのレート上限と画像・条件の重さにも依存する。
