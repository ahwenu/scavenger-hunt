# 参加者フロントエンドの受け渡し

更新日：2026-10-18。TypeScript/Reactの参加者画面は `apps/cloud/`。新トップは `/`、QRからの参加は `/rooms/:id/join`。ブラウザでの参加・撮影・写真送信・結果・人数/順位表示を担当する。元の8画面と実装は `/design-preview` で比較できる。リポジトリの変更を公開サイトへ反映するには再配備が必要。

## 画面を起動する

Node.js **22.13.0以上**とnpmを用意し、リポジトリ直下から実行する。ルートの `npm run dev` は別のローカルデモなので、Cloudを指定する。

```sh
npm --prefix apps/cloud run install:ci
npm --prefix apps/cloud run dev
```

通常のローカル環境では `http://localhost:5173/` を開く。猫とロボットのトップからゲームスタートを押し、参加リンクまたは部屋IDを入力して同じサイトの参加画面へ進む。ここでは部屋を作成しない。

`http://localhost:5173/design-preview` は8つの状態を切り替える比較画面。実参加者の登録や実AI判定は行わず、APIキーも不要。

型検査と配備向けビルド：

```sh
node apps/cloud/node_modules/typescript/bin/tsc --project apps/cloud/tsconfig.json --noEmit
npm --prefix apps/cloud run build
npm --prefix apps/cloud run start
```

ビルド後の新トップは `http://localhost:8787/`、比較は `/design-preview`。`start` は `dist/server/wrangler.json` を使い、D1/R2をローカルで動かす。編集後は再ビルドして起動し直す。

## 部屋・QR・写真投稿を確認する

**新しいローカルDBの初回だけ**、build後に4つのSQLを順番に適用する。既に0000〜0002を適用したDBは、再実行せず未適用の0003だけを適用する。0003も適用済みならSQLの再実行は不要。以下はローカル専用で、公開DBへの適用手順ではない。

```sh
cd apps/cloud
node node_modules/wrangler/bin/wrangler.js d1 execute DB --config dist/server/wrangler.json --local --persist-to .wrangler/state --file drizzle/0000_nappy_kinsey_walden.sql
node node_modules/wrangler/bin/wrangler.js d1 execute DB --config dist/server/wrangler.json --local --persist-to .wrangler/state --file drizzle/0001_boring_menace.sql
node node_modules/wrangler/bin/wrangler.js d1 execute DB --config dist/server/wrangler.json --local --persist-to .wrangler/state --file drizzle/0002_boring_swarm.sql
node node_modules/wrangler/bin/wrangler.js d1 execute DB --config dist/server/wrangler.json --local --persist-to .wrangler/state --file drizzle/0003_issue1_round_hint.sql
npm run start
```

1. 部屋はPlugin Extensionsで作成する。ブラウザからの互換検証では `http://localhost:8787/host` で部屋を作り、既存ホスト画面 `/rooms/:id/host` へ移る。参加QRと参加リンクが表示される。
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
- 音：声とBGMは `apps/cloud/public/audio/`、OtoLogic 11種類は既存 `/sounds/` 配信。音は初期オン（保存済みオフを尊重）で最初の操作から始まり、右下の音ボタンでまとめて止められる。猫の短語9本は「さっちゃん」・Eleven v4で、声は0.85倍再生。指定BGMはループする。[音の実装・確認範囲](../ai-reports/2026-10-18-参加者効果音と音声の接続.html)と[Suno差し替え用メモ](../design/suno-karimono-bgm.md)を参照。
- 追加確認：音31件・参加先入力4件、型検査・Cloudビルドが成功。ローカルで新トップと互換 `/host` の応答、採用音声の配信一致、Chromeで参加先入力・外部URL拒否・音設定の保持・クレジットを確認。実機マナーモード・100台・今回の公開再配備は未実施。
- 確認：参加者画面の通信・表示モック9ケース、最新main統合後の型検査/build、バックエンド・既存音のテスト19件が成功。モックにはサーバー順位の優先、参加99→100人/自分12→2位/500→1000点、古いrevisionの破棄を含む。詳細は[作業レポート一覧](../ai-reports/)を参照。ローカルD1の1人参加→画像ファイル提出→デモ成功/順位は確認済み。このTypeScript画面の実機カメラ、100実端末、Supabase実接続は未確認。mainの既存D1/v3には100HTTPクライアントの公開デモ記録があり、[14の成功/失敗範囲](../14-issue1-ahwenu-handoff.md)を参照。このUIでの再実行とは区別する。

仕様の索引は[参加者画面コンテキスト](mobile-frontend-context.md)、画面/ゲームの正本は[Project.md](../../Project.md)と関連ADR。
