# カリモノをPlugin Extensionsに追加する

ONE LEASE / **借り物王に俺はなる！**

受け取った共有ファイルを展開し、3つのコマンドでローカルに追加します。画面を開くだけなら、ソース取得・`npm ci`・ビルド・OpenAIキーの設定は不要です。

以下のコマンド例はmacOS/Linuxのターミナル向けです。Windowsでの一連の導入は未検証です。


## 0.4.2の事前招待QR

「招待QRを事前に作る」から待機部屋を作り、「招待」タブの「参加QRを配布・保存」でURLコピー・PNG/SVG保存を使います。画像保存に対応しないホストでも参加URLを配布できます。参加だけでは開始せず、当日に同じ部屋の「進行」タブからお題準備・ゲーム開始を行います。

ホスト権限はプラグインの外にあるユーザー状態ディレクトリへ0600で保存され、同じPC・同じSites接続先では再起動後も最後の部屋へ戻ります。共有ファイルや配布QRにホスト権限を含めません。保存先を変更する場合は `.env.local` の `KARIMONO_HOST_SESSION_FILE` でGit管理外の場所を指定し、更新時に設定参照を引き継いでください。旧版だけで作成した部屋の権限は復元できません。

## 0.4.1の接続・操作更新

初回の部屋状態取得と独立AI接続確認を別々に行います。「AI確認」では接続エラーを確認・再試行でき、既存部屋からも「＋ 新しい部屋」で部屋を作れます。ゲーム用の「AIのお題を準備」は参加者が1人以上必要です。参加者0人でも独立AIの「AIでお題を生成」は利用できます。

更新後は画面を閉じて開き直し、新しい部屋作成ボタンを確認してください。既に起動した旧MCPプロセスは、再インストールだけでは切り替わらない場合があります。旧画面が残る場合はプラグインを再読み込みしてください。

## 0.3.0の画面更新

運動会・猫耳キャラクターのデザインを取り入れています。イラストは配布物へ同梱し、外部画像サービスへの接続は不要です。部屋を作ると参加用QRと参加URLが表示されます。更新後は開いている拡張を閉じて開き直してください。旧画面が残る場合は拡張を再読み込みするか、アプリを再起動して新しいUIリソースを読み込んでください。


## 1. 用意するもの

- Node.js 22.13以上。ターミナルで `node --version` を確認します。
- `codex plugin` に対応したCodex CLIと、ローカルプラグインを利用できるデスクトップ環境。
- `karimono-host-share-0.4.2.tar.gz` と `karimono-host-share-0.4.2.tar.gz.sha256`。配布者から受け取ってください。

Work内のPlugin Extensionsでも起動・API接続確認・お題生成を確認しています。利用できるUIやメニュー名はアプリのバージョンによって異なります。

## 2. 展開して登録する

共有ファイルを置いたフォルダでターミナルを開き、次を実行します。ファイル名を変更した場合は読み替えてください。

```sh
shasum -a 256 -c karimono-host-share-0.4.2.tar.gz.sha256
tar -xzf karimono-host-share-0.4.2.tar.gz
cd karimono-local
codex plugin marketplace add . --json
codex plugin add karimono-host@karimono-local --json
codex plugin list --marketplace karimono-local --json
```

最後の結果に `installed: true`、`enabled: true`、`version: 0.4.2` があれば登録できています。`plugin add --json` が返す `installedPath` は、後で接続を設定するときに使うため控えてください。`plugin list` の結果にはこのパスは含まれません。

展開したフォルダはmarketplaceの参照元になるため、更新するときまで残してください。公開ディレクトリへの申請、サイトの公開、スマホでの参加は、このローカル登録に必要ありません。

CLIに `plugin` コマンドがない場合は、アプリ側のプラグイン管理画面でローカルmarketplaceまたはローカルソースを追加できるか確認してください。参照元は展開した `karimono-local/`、プラグインソースを直接選ぶ方式なら中の `plugin/` です。対応項目がなければ、ローカルプラグインに対応したアプリ・CLIへ更新してください。

## 3. 画面を開く

アプリのPlugin Extensionsから「カリモノ」を選びます。必要なら新しいチャットを開くか、アプリを再起動して登録内容を読み込みます。

0.2.1から部屋作成後に参加QRを表示します。参加リンクも利用できます。QRが出ない場合は、下記の更新手順で最新の0.4.2を入れ直し、一覧のバージョンと新しい `installedPath` の接続設定を確認してからプラグインを再読み込みしてください。旧版の画面が残る場合はアプリを再起動します。

接続設定を入れていない初回は、ゲームが「未接続」、AIも「未設定」と表示されます。公開Sitesへの設定後は実部屋の作成・参加URL発行・ゲーム操作ができます。独立AIプレビューは別設定で、ゲームの部屋へお題を反映しません。

## 4. 自分のPCで実AIも使う場合

### 公開Sitesへ接続する場合

0.2.0では、公開されたSitesのゲームへ接続する設定を追加しています。手順2の `installedPath` にある `.env.local` へ次を保存し、プラグインを再読み込みします。

```dotenv
KARIMONO_MODE=sites
SITES_API_BASE_URL=https://karimono-one-lease.ahwenu.chatgpt.site
```

この方式はローカルAPIのインストール・OpenAIキー・サービスアクセス資格情報を必要としません。v1配備とログイン不要のpublic設定、インストール済み0.2.0の実MCP/HTTPによる部屋→匿名参加→実生成→開始→JPEG提出/実判定→勝利数順位→ラウンド終了を1例確認済みです。ネイティブ拡張UIの直接操作・スマホ実機・複数人評価は別途確認します。0.2.0当時はCookieのプロセス内保持・再起動復帰未対応・30秒自動開始でした。0.4.2では上記の安全な保存と手動開始を使います。終了操作は現在のラウンド受付終了を意味します。

MCPの登録キーは0.2.0で `karimono-host-sites` へ変わり、推奨表示はfullscreenです。旧版が動き続ける場合は、プラグインを再読み込みするかアプリを再起動して新しい接続を読み込んでください。

### 自分のローカルAPIを使う場合

この共有ファイルにはOpenAIキー、サービス用トークン、AI APIサーバーのソースを含めません。ローカル独立APIは `127.0.0.1` 専用なので、他の人のPCからAhwenuのPCへ自動接続することもありません。この方式を選ぶ場合は各自のPCでAPIを起動し、自分が利用できるOpenAIキーを設定します。上記の公開Sites方式とは別の開発用接続です。

### APIのソースを用意する

公開済みのリポジトリから、独立APIのソースを取得できます。

```sh
git clone https://github.com/ahwenu/scavenger-hunt.git
cd scavenger-hunt/api
npm ci
```

既にリポジトリを取得している場合は、同じフォルダを作り直さず最新の内容を取り込んで `api/` を利用してください。Sitesのソースや設定を編集する必要はありません。

### サービス用トークンを作る

`api/` の中で次を実行します。ランダムな値をファイルへ保存し、ターミナルには表示しません。これはOpenAIキーとは別の、pluginとAPIの通信用トークンです。

```sh
mkdir -p .local
node --input-type=module -e "import { randomBytes } from 'node:crypto'; import { writeFileSync } from 'node:fs'; writeFileSync('.local/service-token', randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });"
```

既にファイルがあると上書きせず停止します。その場合は既存ファイルを利用し、値をチャットや共有資料へ貼り付けないでください。

### APIにキーの参照先を設定する

OpenAIキーは、既存のdotenvファイルに `OPENAI_API_KEY` として保存されているものを参照します。キーの値をプラグインへコピーしません。

既存ファイルがなければ、自分のローカルdotenvファイルに `OPENAI_API_KEY=<自分のキー>` を保存し、所有者だけが読める権限にして、そのファイルを参照できます。

`api/.env.local` をテキストエディターで作り、次の2つのパスを**自分のPCの絶対パス**に置き換えます。空白を含むパスはダブルクォートで囲みます。

```dotenv
OPENAI_KEY_FILE="/absolute/path/to/your-existing-env-file"
API_SERVICE_TOKEN_FILE="/absolute/path/to/scavenger-hunt/api/.local/service-token"
PORT=4318
AI_REFERENCE_PHOTOS=false
```

その後、APIを起動します。

```sh
chmod 600 .env.local
npm start
```

`http://127.0.0.1:4318` で起動したことを確認し、このターミナルは開いたままにします。標準のお題生成はResponses API、写真判定はDecisions APIを使います。実AI生成・判定はOpenAI APIの利用料金が発生します。参考写真付きのAgentsは任意機能で、一連の動作は未検証です。

### インストール済みpluginに接続先を設定する

手順2で控えた `installedPath` のフォルダに `.env.local` を作成し、次を記入します。トークンファイルのパスはAPIに指定したものと同じにします。

```dotenv
KARIMONO_API_URL=http://127.0.0.1:4318
KARIMONO_API_TOKEN_FILE="/absolute/path/to/scavenger-hunt/api/.local/service-token"
```

このファイルも所有者だけが読める権限にします。ターミナルで `installedPath` のフォルダへ移動して `chmod 600 .env.local` を実行してください。OpenAIキーをこのファイルに入れる必要はありません。

プラグインを再読み込みし、「API接続確認」→「AI生成」を選びます。API利用可能・接続済みとお題が表示されれば接続できています。APIが停止すると利用できないため、先ほどのサーバーを起動しておきます。

## 更新する場合

以下はローカル配布更新の手順案です。初回登録と区別し、更新の一連の動作は未検証です。

配布者は変更後に `npm run share` で共有ファイルを作り直します。受取人は次の順番で更新します。

1. 現在のインストール先の `.env.local` があれば、所有者だけが読める別の場所へ控えます。
2. 新しい共有ファイルを展開し、登録済みmarketplaceの参照元を同じパスの新しい内容へ置き換えます。
3. 次のコマンドでプラグインを入れ直します。

```sh
codex plugin remove karimono-host@karimono-local
codex plugin add karimono-host@karimono-local --json
codex plugin list --marketplace karimono-local --json
```

`marketplace upgrade` はGit由来のmarketplace更新向けなので、このローカルフォルダ配布では上記の再インストールを使います。

更新・再インストール後は `plugin add --json` の `installedPath` を再確認し、控えた `.env.local` を必要に応じて戻して権限を0600に設定します。Sitesと独立AIを両方使う場合は `KARIMONO_MODE`・`SITES_API_BASE_URL`・`KARIMONO_API_URL`・`KARIMONO_API_TOKEN_FILE` の4項目をすべて引き継ぎ、Sitesの2項目だけで上書きしないでください。プラグインを再読み込みまたはアプリを再起動し、「API接続確認」で設定を確認してください。秘密設定は共有ファイルから復元されません。

## 共有ファイルの中身

```text
karimono-local/
├── INSTALL.md
├── .agents/plugins/marketplace.json
└── plugin/
    ├── plugin.json
    ├── mcp.json
    ├── README.md
    ├── INSTALL.md
    └── dist/
        ├── server.mjs
        └── widget.html
```

Node.jsは必要ですが、受取人の画面起動にnpm依存のインストールは不要です。ソース・`node_modules`・秘密設定は共有ファイルに含めません。

## 配布物の確認状況（2026-10-18）

0.2.1のインストール・有効化、型チェック・ビルド・21件のテスト、通常/共有配布物の可搬性を確認済みです。インストール済みHTMLを公式ブリッジを使う検証ホストへ表示し、部屋作成後のQRを画面確認・macOS Visionで読取して参加URLと完全一致、参加ページは匿名200・ログイン不要を確認しました。ネイティブ拡張パネルの直接操作・参加登録・新しい有料AI呼出は今回行っていません。

共有ファイル生成、SHA-256照合、含まれるファイルの検査、空白を含む別パス・別の作業ディレクトリ・node_modulesなしでのMCP起動を確認済みです。未接続/デモの両モードで10ツールとUIリソースを確認しました。別PCでの実機導入、Windows、更新手順の一連の操作は未検証です。
