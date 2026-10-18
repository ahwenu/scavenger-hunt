# 新Sitesへの配置とPlugin Extensionsのゲーム接続

## 対象と現在の状態

本書はD1/R2で配備したSites v1/v2の記録。後続のユーザー指示により、本番ゲーム記録の保存先をSupabaseとする方針を[ADR-0016](adr/0016-supabase-game-persistence.md)に記録した。下記の配備・実AI結合結果はSupabase接続の検証ではない。移行の受け渡しは[16](16-supabase-integration.md)を参照。

最新mainの取得元は `a67a393695e291c1695598ca49a8f135d567a94e`。この版の全追跡ソースを新Sitesの作業フォルダへ配置し、実行対象のCloudアプリと保存用ソースを分ける。

| 項目 | 値・状態 |
| --- | --- |
| 新Sites | `appgprj_6ad4611142408191ae99be09e3b27efb` |
| 配置先 | `/Users/anubis/Documents/mycodes/sites/karimono-one-lease-d8rvXt/app` |
| URL | `https://karimono-one-lease.ahwenu.chatgpt.site` |
| アクセス | 初期privateから追加指示によりpublicへ変更済み。ログイン不要 |
| 実行対象 | Cloudアプリ。Sitesのテンプレートとビルド/配備構成を維持 |
| その他のソース | 初期591ファイル。v2は最新mainと今回の作業差分を合わせた、秘密除外済み598ファイルのスナップショット |
| 実行時OpenAI設定 | 利用者承認済みの既存キーをSitesの `OPENAI_API_KEY` 秘密設定に登録済み。値は記録しない |
| v1配備 | 成功。private維持、実行環境revision 1、D1/R2とマイグレーション適用成功 |
| 実ゲーム接続 | インストール済み0.2.0の実stdio MCPとHTTPで、部屋→参加→生成→開始→提出/判定→順位→ラウンド終了を1例確認 |

v1の配備IDは `appgdep_6ad462f18d608191a41e409bb8ef2825`、version IDは `appgprj_6ad4611142408191ae99be09e3b27efb~appgver_2b38ad261b4c81918393cfa28b1faad9`、配備ソースcommitは `ad363f15138b8ef45cc2e77719f68f3651ff78f6`。元リポジトリ取得時点のcommitと配備用差分を区別する。所有者のサインイン後、ブラウザでトップ画面の表示を確認した。部屋作成やゲーム操作の成功とは別の検証結果。

その後、ユーザーの追加指示でpublicへ変更し、アクセス設定revision 2を確認した（更新日時2026-10-18 15:17 JST）。サービスアクセス資格情報を必要としない接続へ切り替える。OpenAIキーはサーバー秘密設定、ホストの部屋操作は部屋Cookieによる認可を継続する。

v2の本番配備も成功（2026-10-18 15:27 JST）。version IDは `appgprj_6ad4611142408191ae99be09e3b27efb~appgver_091fee001ac88191b5cf2f33c22e29fe`、配備IDは `appgdep_6ad466b44b2c81918dde0ee0f898e590`、SitesソースSHAは `296f926a0146a660821af3180ca4efefbe2ebe66`。実行環境revision 1、publicを維持した。v2配備時点では元リポジトリの追加差分はGitHubへ未pushだった。今回のコミットにはCloud/Web・pluginの差分を含めるが、Sitesの配備ソースSHAとGitHub mainのSHAは区別する。

v2配備後の匿名HTTP確認でトップ `/` は200・リダイレクトなし・ログイン要求なし、`/app.js` も200で見本画像なし時の条件案内が更新されていることを確認した。公開トップのブラウザ表示も確認し、画像はGit対象外の `plugin/artifacts/sites-public-v2.png` に保存する。

## 配置と実行の境界

```text
Sites作業ルート app/
├── <SitesテンプレートとCloudの実行ソース>
├── <Sitesビルド・DB・画像保存の設定>
└── repository/
    ├── apps/cloud/           # 取得時点の元ソース
    ├── apps/server/・web/    # ローカルデモの保存
    ├── api/                  # Node版AI APIの保存
    ├── plugin/               # stdio MCP拡張の保存
    └── <仕様・素材・その他の全追跡ソース>
```

「全コードをSitesに入れる」は、全ソースを保持しつつ、対応する実行環境へ載せる構成とする。Node/Express/Sharpの `api/` やstdioの `plugin/` をWorkers上で起動しない。`repository/` はTypeScriptのチェック/ビルド対象から除外し、全追跡ソースを保存する役割にする。ブラウザからソースを配信する公開ディレクトリへ置かない。

旧Sitesの `hosting.project_id` は保存時に除去し、新サイトの設定へ混入させない。秘密設定、キー、サービス資格情報、Cookie、部屋の実行時状態、依存フォルダ、生成物はスナップショットへ含めない。取得後の配備用差分と、取得元の版を区別する。

## CloudのAIとデータ

ローカル独立APIで実接続を確認したResponsesの単発生成をCloudへ移植する。標準は文章のお題、`AI_REFERENCE_PHOTOS=true` を明示した場合だけAgentsと参考写真を利用する。写真判定はDecisions APIを継続する。

OpenAIキーはSitesのサーバー実行時秘密設定だけから参照し、画面・MCPツール結果・保存用ソース・配布物へ渡さない。CloudのDBと画像ストレージは部屋・参加・提出・判定・順位の正本を持ち、ローカル `api/` のメモリ状態は引き継がない。

現在のCloudは勝利数（wins）を順位に使い、アプリ全体を終了する操作は持たない。Plugin Extensionsの表示も勝利数とラウンド操作へ合わせる。従来仕様の「1問10点」「ゲーム全体の終了」を、接続アダプターが実装済みとして見せない。

## ソースへ戻す変更とv2の再現手順

今回の新Sites配備・連携に必要な範囲として、配備ルートで検証したWorkers向けAIの変更を元リポジトリへ戻す。初期の独立API作業で設けたSites非変更の範囲を、この作業に限って拡張する。

1. 元リポジトリの取得元commitを記録し、同じ作業差分を用意する。v2配備時点の取得元commitだけでは最終状態を再現できない。Cloud/Web・plugin連携を含む今回のコミットも取得する。
2. `apps/cloud/lib/cloud-ai.ts`、`cloud-api.ts`、`text-agent.mjs` と対応する2テストへ、標準Responses生成・キー設定時の新規部屋AIモードを反映する。Node/Express版のサービスをWorkersで起動せず、Cloud専用アダプターを使う。
3. `apps/web/` の見本画像なし時の表示と説明を合わせる。AIの条件文で探す場合に、参考写真があるような案内を出さない。
4. 元リポジトリの最新作業ツリーから、plugin・文書・上記変更を含む全ソースをSitesの `repository/` へ同期する。秘密・依存・生成物・実行時状態を除外し、旧project_idを引き継がない。
5. Sitesの実行ルートにもCloud/Webの対応する差分を反映し、型チェック・Cloud9件のテスト・Sitesビルドを実行する。pluginの21件と単独配布物も別に確認する。
6. Sites公式フローでv2を保存・配備し、URL・public設定・配備ID・バージョン・ソースcommitと、匿名アクセス/ゲームAPIの結果を記録する。

保存用スナップショットは型チェック/ビルド対象に戻さない。実行時のOpenAIキーはSitesの秘密設定を使い続け、同期や配布物へコピーしない。

## Plugin Extensionsからの接続

明示的な `KARIMONO_MODE=sites` を追加し、未接続・ローカルデモと区別する。

plugin 0.2.0ではMCPサーバー登録キーを `karimono-host-sites` とし、旧プロセスのキャッシュと接続を分ける。プラグイン名は `karimono-host`、ツール名は従来と同じ。UIの推奨表示はfullscreenにする。実際の再読み込み・接続結果は検証後に記録する。

| pluginのサーバー設定 | 役割 |
| --- | --- |
| `KARIMONO_MODE=sites` | 新Sitesのリモートホストアダプターを選択 |
| `SITES_API_BASE_URL` | 新SitesのベースURL |
| `SITES_SERVICE_ACCESS_TOKEN_FILE` | private接続向けの任意設定。今回のpublicサイトでは不要 |

ベースURLはHTTPSのoriginだけを指定し、ローカル検証ではループバックHTTPを許す。今回のpublicサイトにはサービスアクセス資格情報を送らず、部屋のホストCookieで管理操作を認可する。privateサイトで任意設定を使う場合だけMCP側で `OAI-Sites-Authorization: Bearer ...` を付け、通常の `Authorization` へ転記しない。Cookie・トークンを画面や参加URLへ載せない。

| MCP側の操作 | 接続先のCloud API |
| --- | --- |
| 部屋作成 | `POST /api/rooms`。作成後、キーが利用可能ならAIモードを設定 |
| 状態/参加者/順位取得 | `GET /api/rooms/:id/state` |
| AIモード選択 | `POST /api/rooms/:id/host/mode`（`mode: ai`） |
| お題準備 | `POST /api/rooms/:id/host/prepare` |
| 準備中から開始 | `POST /api/rooms/:id/host/start-now` |
| 次のお題へ進行 | `POST /api/rooms/:id/host/start` |
| 現ラウンドの受付終了 | `POST /api/rooms/:id/host/end` |

ホスト作成時のCookieはMCPサーバー内のmapで保持し、その部屋の取得・参加状況/順位ポーリング・準備・開始・次問・ラウンド終了へ利用する。MCP再起動でmapを失うため、再起動後の部屋復帰は未解決の制約として表示する。資格情報の永続保管・ホスト復帰を、初回通信の成功だけで実証済みと扱わない。

同じMCPプロセスで再表示した場合は最新の部屋へ戻れる。操作IDの重複防止と状態のversionはMCP内の処理であり、Cloudの永続的な冪等性やCASを実証するものではない。POSTは最大60秒、UIは70秒で待機を打ち切り、リダイレクトと暗黙のデモ切り替えを行わない。

順位は勝利数の降順、合計時間の昇順、参加時刻、IDの順で並べる。問題数上限は未設定。AIが利用できない状態やCloudがデモモードの場合は、参加用URLを表示せず、準備・開始操作を許可しない。`host_finish` は現ラウンド受付終了に対応し、全体のfinished状態を作らない。

現在のCloudは、参加登録後や初回の状態取得により最初のお題準備が進む契約を持つ。状態取得を完全な読み取り専用と仮定せず、参加前後・再表示時の進行を結合検証する。

publicへの設定変更により、参加者にプラットフォームのログインを要求しない。参加URLからの一般参加者の動作と、ホスト操作の認可は実機で別途確認する。

## 検証と引き継ぎ

次を順番に確認し、実行結果を本書とADRへ追記する。

1. 新Sitesのビルドと配備成功、URLのアクセス条件。
2. 設定済み秘密を使ったCloudの実お題生成と写真判定。
3. MCPからpublic Sitesへ接続し、部屋作成・Cookie付き状態取得/管理操作。
4. 参加者ブラウザの参加と、拡張の参加者/勝利数表示。
5. お題準備・開始・次問・ラウンド終了の操作と状態の同期。
6. 再読込・失効・MCP再起動時のエラー/復帰の制約と、秘密値が出ないこと。

Cloudの標準Responses生成/キー設定時の既定AIモードに関する9件、pluginの21件のテストが成功。キーがある新規部屋は最初からAIモードとする。

public変更後、匿名でトップにアクセスしHTTP 200・ログイン要求なしを確認。インストール済み0.2.0の実stdio MCPと、新Sitesへの実HTTP通信で以下を確認した。

1. MCPで部屋を作成し、`aiAvailable: true`・`mode: ai` を取得。
2. 匿名参加者「接続確認」の参加がHTTP 200で成功し、MCP側の参加チーム1件へ反映。
3. 実Responses APIで「カップを探そう」を生成し、MCPの `host_start` で開始。
4. バナナ画像をJPEGで提出しHTTP 202で受理。実Decisions APIが不合格（rejected）を返した。
5. MCPで参加者1件のランキング・勝利数を取得し、`host_finish` で現在のラウンドがresultになったことを確認。

これはインストール済み配布物の実MCP/HTTP結合の1例。Codexがネイティブの実拡張UIを直接クリックした記録ではなく、スマホ実機・複数人負荷・判定精度の評価も未実施。秘密を含まない検証結果はGit対象外の `plugin/artifacts/sites-live-verification.json` に保存する。

既存プロトタイプの30秒自動開始の挙動、全体ゲーム終了の未対応、MCP再起動後のホストCookie復帰未対応は残る。最新plugin・文書とCloud/Web差分を含む598ファイルの保存用スナップショットを反映し、v2本番配備は成功した。実MCP/HTTPの一連の結合は上記の実施時点の1例として記録し、v2配備成功と混同しない。0.2.0の通常/共有パッケージ再生成と、それぞれの可搬性検証も成功。

ローカルAPIとWork内実拡張の過去の成功例は[11](11-api-integration.md)を参照し、新Sitesの成功記録と区別する。

判断の記録：[ADR-0011](adr/0011-new-sites-deployment.md)。
