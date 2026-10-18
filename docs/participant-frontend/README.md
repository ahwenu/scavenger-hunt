# 参加者フロントエンドの受け渡し

更新日：2026-10-18。TypeScript/Reactの参加者画面は `apps/cloud/`。ブラウザでの参加・撮影・写真送信・結果・人数/順位表示を担当する。元の8画面と実装は `/design-preview` で比較できる。

## 画面を起動する

Node.js **22.13.0以上**とnpmを用意し、リポジトリ直下から実行する。ルートの `npm run dev` は別のローカルデモなので、Cloudを指定する。

```sh
npm --prefix apps/cloud run install:ci
npm --prefix apps/cloud run dev
```

通常のローカル環境では `http://localhost:5173/design-preview` を開く。8つの状態を切り替える画面見本で、実参加者の登録や実AI判定は行わない。APIキーは不要。

型検査と配備向けビルド：

```sh
node apps/cloud/node_modules/typescript/bin/tsc --project apps/cloud/tsconfig.json --noEmit
npm --prefix apps/cloud run build
npm --prefix apps/cloud run start
```

ビルド後のローカル表示は `http://localhost:8787/design-preview`。`start` は `dist/server/wrangler.json` を使い、D1/R2をローカルで動かす。編集後は再ビルドして起動し直す。

## 部屋・QR・写真投稿を確認する

**新しいローカルDBの初回だけ**、build後に3つのSQLを順番に適用する。既に初期化済みのDBへ再実行しない。以下はローカル専用で、公開DBへの適用手順ではない。

```sh
cd apps/cloud
node node_modules/wrangler/bin/wrangler.js d1 execute DB --config dist/server/wrangler.json --local --persist-to .wrangler/state --file drizzle/0000_nappy_kinsey_walden.sql
node node_modules/wrangler/bin/wrangler.js d1 execute DB --config dist/server/wrangler.json --local --persist-to .wrangler/state --file drizzle/0001_boring_menace.sql
node node_modules/wrangler/bin/wrangler.js d1 execute DB --config dist/server/wrangler.json --local --persist-to .wrangler/state --file drizzle/0002_boring_swarm.sql
npm run start
```

1. `http://localhost:8787/` で部屋を作る。既存ホスト画面 `/rooms/:id/host` に移り、参加QRと参加リンクが表示される。
2. `/rooms/:id/join` で名前を登録する。ホストの参加人数に反映される。QR画像の実ルートは `/api/rooms/:id/qr.svg`、保存用は `/api/rooms/:id/qr.png?download=1`。
3. ホストで競技を開始し、参加画面で撮影または写真選択→写真確認→送信→結果/順位を確認する。キーがない新規部屋はデモ判定で、写真の内容をAIが評価した結果ではない。

スマホからの招待・撮影には、スマホがアクセスできるHTTPSの配備URLを使う。ローカルのQRに入る `localhost` は他のスマホからこのPCへ接続するURLにはならない。ホストの正式な配置方針はPlugin Extensionsで、上記のブラウザ用ホストは既存の検証経路。

## APIと秘密設定

参加者画面は同じオリジンの `/api/rooms/:id` を呼ぶ。**フロントにSupabaseキーやOpenAIキーを登録する必要はない**。現行サーバーはD1/R2で、Supabase接続はまだ実装・確認されていない。保存先・入出力・人数/順位のライブ更新依頼と、バックエンドの設定場所は[Supabase統合](../16-supabase-integration.md)と[Issue #1](https://github.com/ahwenu/scavenger-hunt/issues/1)にまとめた。

ローカルで既存Cloudの実AIを確認する場合だけ、`apps/cloud/.dev.vars.example` を参考に `apps/cloud/.dev.vars` へ自分の `OPENAI_API_KEY` を設定する。値はGitへ入れない。build後のstartは設定ファイルを絶対パスで渡すと、生成設定のディレクトリとの違いを避けられる。

```sh
# apps/cloud ディレクトリで実行。実際のキーは .dev.vars 内だけに設定する。
npm run start -- --env-file "$PWD/.dev.vars"
```

`.dev.vars` はローカルAI用の任意設定。Supabaseの接続値を入れるだけで接続する実装はまだない。本番の秘密値はSites APIの秘密設定へ登録し、設定名はバックエンド実装と合わせる。

## 素材・音・確認範囲

- 画像：`apps/cloud/public/design/sports-day/`。受領画面・切り出し素材・補完素材を分けて保持し、実装は静的画像として読む。
- 音：`apps/cloud/public/audio/`。画面の音ボタンを押すとBGM・声・効果音を有効にする。Sunoへの差替え用プロンプトは[音楽制作メモ](../design/suno-karimono-bgm.md)。
- 確認：参加者画面の通信モック6ケースを完了。型検査・buildの最終結果は[作業レポート一覧](../ai-reports/)を参照。ローカルD1の1人参加→画像ファイル提出→デモ成功/順位は確認済み。実機カメラ、100人同時、Supabase実接続は未確認。

仕様の索引は[参加者画面コンテキスト](mobile-frontend-context.md)、画面/ゲームの正本は[Project.md](../../Project.md)と関連ADR。
