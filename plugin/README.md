# カリモノ：Plugin Extensionsの開発ひな形

ONE LEASE / **借り物王に俺はなる！**

ホストの部屋作成、参加チーム一覧、ランキング、開始・次問・終了の画面を育てるための独立パッケージです。Sitesの参加者画面・バックエンドとは別にビルドし、`plugin/` ごと別の場所へ移動できます。

元リポジトリには既存デモも取り込まれています（Sitesは `apps/cloud/`、ローカル版は `apps/server/`・`apps/web/`）。このpluginはそれらのソースや依存を参照しません。Ahwenuの独立AI APIへはMCPサーバーからHTTP接続し、SitesのゲームAPI接続は後続作業です。

## 現在の範囲

- React / TypeScriptのホスト画面とMCP Appsブリッジ。
- Node.jsのstdio MCPサーバー、UIリソース、接続アダプター。
- 明示的に選択するデモと、標準の未接続状態。
- 単独ビルド、画面プレビュー、配布用アーカイブ作成。
- 独立AI APIの接続状態と、実AIで生成したお題を確認する専用領域。

デモの参加チーム・得点はサンプルです。実AIの生成結果をサンプルの部屋・チーム・順位へ反映しません。SitesのゲームHTTP通信、スマホの実参加、部屋の認証・永続化、QR生成は今後の実装です。ブラウザプレビューはPlugin Extensionsでの表示・認可・実機結合の確認とは別です。ローカルPlugin Extensionsへの登録は以下の手順で進め、登録結果と実表示確認の状態を分けて記録します。公開配備は別作業です。

## 開発を始める

Node.js 22.13以上とnpmを利用し、このフォルダを作業ルートにします。

```sh
cd plugin
npm ci
npm run check
npm test
npm run build
npm run preview
```

プレビューサーバーが表示する `http://127.0.0.1:4173/` をブラウザで開きます。`npm run preview` は画面確認専用のデモMCPを明示的に起動します。Sites本体や親ディレクトリの `node_modules` は不要です。

MCPサーバーをデモ状態で起動する場合は、環境変数を明示します。

```sh
KARIMONO_MODE=demo npm start
```

`npm start` はstdio MCP接続用で、ブラウザのHTTPサーバーではありません。通常のMCP起動で未指定の `KARIMONO_MODE` は `unconfigured` となり、実接続済みの部屋を表示しません。`npm start` / `npm run preview` はplugin直下の `.env.local` を任意で読み込みます。`.env.example` は変数名の見本です。`.env.local` はGit対象外とし、配布物にも含めません。

## 実AI APIを接続する

Node.js 22.13以上を使い、独立した `api/` のサーバーを別プロセスで起動します。Sites側のソース・配備設定は変更しません。OpenAIキーはAPIサーバーだけに設定します。

pluginのGit対象外 `.env.local` には次の変数を設定します。

```dotenv
KARIMONO_API_URL=http://127.0.0.1:4318
KARIMONO_API_TOKEN_FILE=/absolute/path/to/service-token
```

トークンファイルはAPIの `API_SERVICE_TOKEN_FILE` と同じサービス用トークンを持ちます。OpenAIキーのファイルとは別です。pluginはOpenAIキーを読みません。ファイルを指定する代わりに `KARIMONO_API_TOKEN` を環境変数で渡す場合は、両方式を併用しないでください。

API起動後にpluginをビルドしてプレビューを開きます。専用の実AI領域から `ai_status` → `ai_generate_challenge` を呼び、生成されたお題・条件・出典情報を確認できます。画像表示や写真判定の拡張UIは後続作業です。認証付き参考画像のURLへトークンを付けず、ブラウザから直接取得しません。

APIの標準生成はResponses APIのStructured Outputsによる文章のお題です。参考写真付きのAgents APIはAPI側の `AI_REFERENCE_PHOTOS=true` で明示した場合だけ使い、失敗をプリセットで自動補完しません。標準生成の変更理由と未検証事項は[ADR-0010](../docs/adr/0010-independent-ai-api.md)を参照してください。

HTTP入出力・秘密設定・Sites担当への受け渡しは[11 API連携](../docs/11-api-integration.md)を参照してください。フォルダ単独で移動した場合も、上記のAPI接続設定だけで接続先を変更できます。

## フォルダと担当

```text
plugin/
├── plugin.json               # プラグイン宣言
├── mcp.json                  # 相対パスでMCPを起動
├── package.json              # plugin専用の依存・コマンド
├── package-lock.json
├── .env.example
├── src/
│   ├── ui/                   # 未定（Ahwenu）：画面・表示状態・MCPブリッジ
│   ├── server/               # Ahwenu：MCP・接続アダプター
│   └── shared/contracts.ts   # Ahwenu取りまとめ：暫定DTO
├── scripts/                  # ビルド・プレビュー・アーカイブ
├── tests/
│   ├── server/
│   └── ui/
├── dist/                     # 生成物。手編集しない
└── artifacts/                # 配布用アーカイブ。手編集しない
```

画面担当は `src/ui/`、API処理担当は `src/server/` を中心に編集します。依存・lock・manifest・ビルド設定はAhwenuが取りまとめます。共有DTOを変更するときは画面とMCPの双方を確認し、生成物の同時編集やlockの手編集を避けます。

## 後から別フォルダへ移す

ソースを移す場合は、このフォルダ全体を移動し、移動先で `npm ci`、`npm run check`、`npm test`、`npm run build` を実行します。`node_modules/`、`dist/`、`artifacts/` は再生成できます。親フォルダを参照するimportや絶対パスは追加しません。

ビルド済み配布物を作る場合：

```sh
npm run package
npm run test:portable
```

`artifacts/karimono-host-0.1.0.tar.gz` に `plugin.json`、`mcp.json`、README、`dist/server.mjs`、`dist/widget.html` をまとめます。秘密設定・ソース・依存フォルダ・ブラウザプレビューは含めません。展開してできる `karimono-host/` をプラグインのルートとして扱い、Node.js 22.13以上で `node dist/server.mjs` を起動します。`mcp.json` の `cwd` は `./`、サーバーは `dist/server.mjs` の相対参照です。登録するホストが別の基準ディレクトリを使う場合は、登録時の作業ディレクトリを展開先に合わせてください。

`test:portable` はアーカイブを空白を含む一時パスに展開し、`node_modules` のない配布物を別の作業ディレクトリから起動して確認します。パッケージ作成後に実行してください。

## ローカルPlugin Extensionsへ登録する

この `plugin/` フォルダを作業ルートにし、チェック・テスト・ビルドを済ませてから、ローカルmarketplaceを準備して公式CLIへ登録します。

```sh
npm run marketplace:prepare
codex plugin marketplace add ./artifacts/local-marketplace --json
codex plugin add karimono-host@karimono-local --json
codex plugin list --marketplace karimono-local --json
```

準備コマンドはGit対象外の `artifacts/local-marketplace/` に、marketplace宣言とプラグインの宣言・MCP設定・README・MCP/HTMLバンドルだけを置きます。秘密設定・ソース・依存フォルダは含めません。

2026-10-18、公式CLIで `karimono-local` への登録と `karimono-host` のインストールが成功し、一覧で `installed: true`、`enabled: true`、`version: 0.1.0` を確認しました。インストール先はCodexのプラグインキャッシュです。

APIを利用する場合は、`codex plugin add --json` が返す `installedPath` の作業ルートへGit対象外の `.env.local` を設定し、独立したAPIサーバーを起動します。`plugin list --json` にはこのパスは含まれません。今回は `KARIMONO_API_URL` と `KARIMONO_API_TOKEN_FILE` だけを所有者用権限（0600）で設定しました。OpenAIキーをキャッシュへコピーしていません。更新や再インストール後は設定の保持を確認してください。

インストール済みキャッシュのMCPサーバーへstdio接続し、10ツール、global/threadエントリーポイント、未接続状態の `host_open`、`ai_status` の `available: true` を確認しました。現在のチャットにも `host_open` が公開され、呼出しは成功しています。

Work内の実Plugin Extensionsでの表示・API接続確認・生成操作は、下記のユーザー確認で1例実証済みです。ブラウザプレビューの結果とユーザー操作の結果を分けて記録しています。

## 初期骨格の検証記録（2026-10-18）

- `npm run check`、`npm test`（MCP結合3件・UI境界3件）、`npm run package` が成功。
- `npm run test:portable` が成功。展開した配布物で未接続・デモ両モードの8 MCPツールとUIリソースを確認。
- ソースを空白を含む別パスへコピーし、`npm ci --ignore-scripts`、型チェック、ビルド、6件のテストが成功。元の依存・生成物は持ち込まず再生成。
- ブラウザのローカルプレビューから、stdio MCP経由の部屋作成→お題準備→開始を確認。

上記はAI接続追加前の骨格の記録です。

## AI接続追加後の検証記録（2026-10-18）

最新の確認：ユーザーがWork内の実Plugin Extensionsで「API接続確認」→「AI生成」を操作し、提供画像2枚から画面表示、API利用可能・接続済み、お題「文房具のペンを探そう」、条件「文房具のペンが写っている」「ペンに細長い形が見える」、120秒の表示を確認しました。ユーザー操作と提供画像に基づく成功1例です。写真判定UI、Sitesのゲーム進行・参加者・得点・順位の結合は未検証です。

- APIの18件、pluginの15件のテストが成功。plugin配布物の可搬性検証で10 MCPツールとUIリソースを確認。
- ブラウザプレビューからstdio MCPと独立APIを経由し、実Responses APIで「紙コップを探そう」を生成して表示。
- 同じお題IDに対するバナナ画像のJPEG判定で、実Decisions APIからHTTP 200 / `fail` / `CRITERIA_NOT_MET` を受信。

ブラウザ実接続と、ユーザーによる実拡張操作を各1例確認済みです。写真判定UI、判定精度の評価、参考写真付きAgentsモード、公開配備、SitesゲームAPI接続、実際のスマホ参加・得点・順位の結合は未検証です。詳細は[11 API連携](../docs/11-api-integration.md)を参照してください。

## Sitesを接続するとき

1. さが さんのゲームサービスとAhwenuのHTTP API契約を確定する。
2. `src/server/` のアダプターを実装し、操作の認可・冪等性・エラーをAPIへ接続する。ゲームの正本・採点・永続化をMCP側に複製しない。
3. `src/shared/contracts.ts` の暫定DTOと正式な共有契約を対応させる。親の `../contracts` を直接参照せず、変換境界で移行して可搬性を保つ。
4. 部屋権限の安全な保管、復帰、ポーリング、実際のスマホ参加と順位更新を検証する。

`SITES_API_BASE_URL` と `HOST_SERVICE_TOKEN` は将来の接続用の予約名です。現段階では設定してもSitesに接続しません。トークンをUI・ツール結果・ログ・配布物に含めないでください。

設計の正本は [Project.md](../Project.md)、[拡張仕様](../docs/08-plugin-extensions.md)、[フォルダ構成](../docs/09-repository-structure.md)、[ADR-0008](../docs/adr/0008-portable-plugin-scaffold.md) です。これらのリンクは元リポジトリ内で利用できます。フォルダ単独の移動・配布後も、このREADMEだけで起動・移動手順を確認できます。
