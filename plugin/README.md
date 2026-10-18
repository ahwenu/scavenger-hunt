# カリモノ：Plugin Extensionsの開発ひな形

ONE LEASE / **借り物王に俺はなる！**

**受け取った共有ファイルから追加する方は、[取り込み手順 INSTALL.md](INSTALL.md)から始めてください。** 画面を開くためのソース取得・依存インストール・ビルドは不要です。

ホストの部屋作成、参加チーム一覧、ランキング、開始・次問・終了の画面を育てるための独立パッケージです。Sitesの参加者画面・バックエンドとは別にビルドし、`plugin/` ごと別の場所へ移動できます。

元リポジトリには既存デモも取り込まれています（Sitesは `apps/cloud/`、ローカル版は `apps/server/`・`apps/web/`）。このpluginはそれらのソースや依存を参照しません。Ahwenuの独立AI APIへはMCPサーバーからHTTP接続し、SitesのゲームAPI接続は後続作業です。


## 0.4.0：一画面の運営本部とランキング演出

画面の高さに合わせて招待・進行・順位を配置し、狭いパネルではタブで切り替えます。参加者とランキングは人数が増えてもページ切替で確認できます。共通ヒント、独立AIの確認、クレジットは必要なときに開きます。ランキングの追加・加点・順位上昇・首位交代・最終結果を視覚演出し、同じ状態の定期同期では再演出しません。動きを減らす設定に対応します。仕様と検証は元リポジトリの `docs/08-plugin-extensions.md` と `docs/adr/0015-viewport-host-ranking-effects.md` を参照してください。

新しい共有物を生成・インストールした後は、Plugin Extensionsの画面を開き直してください。Sitesと独立AIの接続設定参照は既存インストールから引き継ぎます。秘密設定は共有物に含めません。

## 0.3.0：運動会テーマのホスト画面

運動会・猫耳キャラクターのスマホ案を参考に、ホスト画面を更新しました。参照素材はリポジトリの `docs/design/sports-day-ui-assets-v1` です。使用するPNGは `src/ui/assets/` に保持してUIへ埋め込むため、配布先で親フォルダや外部画像サービスを必要としません。参加者名・順位・勝数は画像に焼き込まず、取得した値を表示します。

既存のSites接続・QR・参加URL・進行操作を維持します。更新後はPlugin Extensionsの画面を閉じて開き直し、旧画面が残る場合は拡張を再読み込みしてください。検証状況は元リポジトリの `docs/adr/0012-sports-day-host-ui.md` を参照してください。


## 現在の範囲

- React / TypeScriptのホスト画面とMCP Appsブリッジ。
- Node.jsのstdio MCPサーバー、UIリソース、接続アダプター。
- 明示的に選択するデモと、標準の未接続状態。
- 単独ビルド、画面プレビュー、配布用アーカイブ作成。
- 独立AI APIの接続状態と、実AIで生成したお題を確認する専用領域。

デモの参加チーム・得点はサンプルです。実AIの生成結果をサンプルの部屋・チーム・順位へ反映しません。sitesモードの実ゲーム接続と参加QRは実装済みで、確認範囲は以下に記録しています。ブラウザの検証ホストとネイティブのPlugin Extensions画面の確認は区別します。

0.2.1では、参加URLをローカルでQR化して表示します。外部QRサービスへ通信せず、参加リンクも残します。QRが出ない場合は0.2.1へ更新し、プラグインを再読み込みしてください。CLI一覧のバージョン、更新後の `installedPath` と `.env.local` の接続設定も確認します。

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

### 公開Sitesのゲームへ接続する（0.2.0）

登録済みpluginの `.env.local` に次を設定し、プラグインを再読み込みします。公開Sitesのためサービスアクセス資格情報やローカルOpenAIキーは不要です。

```dotenv
KARIMONO_MODE=sites
SITES_API_BASE_URL=https://karimono-one-lease.ahwenu.chatgpt.site
```

v1配備とpublic変更、インストール済み0.2.0の実MCP/HTTPでの部屋作成・匿名参加・実AI生成・開始・JPEG提出/実判定・勝利数順位・ラウンド終了を1例確認しました。ネイティブ拡張UIをCodexが直接クリックした記録とは区別します。部屋のホストCookieはMCP内部だけで保持し、MCP再起動後の復帰は未対応。30秒自動開始の既存動作があり、終了操作は現在のラウンド受付終了です。0.2.0のMCP登録キーは `karimono-host-sites`、推奨表示はfullscreenです。旧版の起動結果と区別し、更新後に新しい接続を読み込んでください。

### ローカル独立AI APIを使う

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

`artifacts/karimono-host-0.4.0.tar.gz` に `plugin.json`、`mcp.json`、README、`dist/server.mjs`、`dist/widget.html` をまとめます。秘密設定・ソース・依存フォルダ・ブラウザプレビューは含めません。展開してできる `karimono-host/` をプラグインのルートとして扱い、Node.js 22.13以上で `node dist/server.mjs` を起動します。`mcp.json` の `cwd` は `./`、サーバーは `dist/server.mjs` の相対参照です。登録するホストが別の基準ディレクトリを使う場合は、登録時の作業ディレクトリを展開先に合わせてください。

`test:portable` はアーカイブを空白を含む一時パスに展開し、`node_modules` のない配布物を別の作業ディレクトリから起動して確認します。パッケージ作成後に実行してください。

## ローカルPlugin Extensionsへ登録する

他の人に渡すときは `npm run share` で `artifacts/karimono-host-share-0.4.0.tar.gz` とSHA-256を作ります。marketplace宣言とビルド済みplugin・取り込み手順をまとめた共有用です。秘密設定・APIサーバーは含めません。受取人は[INSTALL.md](INSTALL.md)に従って展開・登録します。

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

QR修正の検証（0.2.1）：型チェック・ビルド・21件のテスト、通常/共有パッケージの可搬性が成功。インストール済みMCPのHTMLを未改変で公式AppBridge/PostMessageTransportの検証ホストへ表示し、画面の「部屋を作る」から実Sitesに部屋を作成してQRを確認しました。macOS Visionによる画面画像のQR読取で参加URLの完全一致を確認し、そのURLは匿名HTTP 200・ログイン不要でした。外部QR通信やCSP緩和は追加していません。ネイティブ拡張パネルの直接操作、参加登録、新しい有料AI呼出は今回の確認に含めません。

1. さが さんのゲームサービスとAhwenuのHTTP API契約を確定する。
2. `src/server/` のアダプターを実装し、操作の認可・冪等性・エラーをAPIへ接続する。ゲームの正本・採点・永続化をMCP側に複製しない。
3. `src/shared/contracts.ts` の暫定DTOと正式な共有契約を対応させる。親の `../contracts` を直接参照せず、変換境界で移行して可搬性を保つ。
4. 部屋権限の安全な保管、復帰、ポーリング、実際のスマホ参加と順位更新を検証する。

`SITES_API_BASE_URL` と `HOST_SERVICE_TOKEN` は将来の接続用の予約名です。現段階では設定してもSitesに接続しません。トークンをUI・ツール結果・ログ・配布物に含めないでください。

設計の正本は [Project.md](../Project.md)、[拡張仕様](../docs/08-plugin-extensions.md)、[フォルダ構成](../docs/09-repository-structure.md)、[ADR-0008](../docs/adr/0008-portable-plugin-scaffold.md) です。これらのリンクは元リポジトリ内で利用できます。フォルダ単独の移動・配布後も、このREADMEだけで起動・移動手順を確認できます。

## 更新時のAI接続設定

画面の更新と接続先の設定は別です。Sitesの部屋操作と独立AIのお題プレビューを両方利用する環境では、更新後のインストール先にも `KARIMONO_MODE`・`SITES_API_BASE_URL`・`KARIMONO_API_URL`・`KARIMONO_API_TOKEN_FILE` の4項目を引き継ぎます。Sitesだけの2項目へ置き換えると独立AIのお題プレビューは未設定になります。秘密設定は共有物へ同梱せず、利用者のローカル設定として復元します。

## 効果音

操作・部屋作成・参加者増加・準備完了・開始・加点・残り5秒・結果/全競技終了に同梱音源を使用します。上部の音ON/OFFは端末へ保存され、音がOFFのときもゲーム操作できます。初回状態取得や同じ定期応答で過去の音を再生しません。

効果音・ジングル：[OtoLogic](https://otologic.jp/) / [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。先頭・長さ・音量を調整し、フェードとモノラルMP3変換を行っています。クイズ、キラキラ、カメラ、カウントダウン、ジングル「やったぜ！」を使用。HTML内にもクレジットがあり、外部音源アクセスは不要です。
