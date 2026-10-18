# フォルダ構成・デプロイ・競合を減らす作業境界

> 2026-10-18追記：デモ実装を元の配置で取り込んだため、現状のSitesルートは `apps/cloud/`。以下の直下配置は将来の構成案であり未実現。取り込み範囲と方針との差分は[10 デモアプリ取り込み](10-demo-import.md)を参照。

> API担当の現在の作業先は独立した `api/`、拡張は `plugin/`。Sites担当の `apps/cloud/` や配備設定をAPI作業で変更しない。両パッケージはルートのデモ用ワークスペースから分離する。接続契約は[11 API連携](11-api-integration.md)を参照。

## 基本方針

**Sitesを配備しやすく保ち、Plugin Extensionsは独立した配布単位にする。** Sitesを直下に置く初期案は以下に残すが、現在の `apps/cloud/` の移動は行わない。ルートの既存npmワークスペースはローカルデモ用で、pluginは参加させない。フォルダは人名ではなく機能で分け、担当者が変わっても配置を変えずに済むようにする。

以下は将来の全体配置案で、現在のファイルツリーではない。Sites・ブラウザ画面・バックエンドのデモソースは取り込み済みで、現配置は10を参照する。今回追加する自己完結した `plugin/` の骨格は、既存デモと直接結合しない。拡張骨格の詳細と操作手順は[plugin/README.md](../plugin/README.md)、今回の暫定契約の判断は[ADR-0008](adr/0008-portable-plugin-scaffold.md)を参照。

## 配置案

```text
scavenger-hunt-20261018/
├── Project.md                       # 全体方針・担当・仕様への入口
├── AGENTS.md                        # 作業境界・ADR更新ルール
├── README.md                        # Project.mdへの案内
├── package.json                     # Sitesのみの依存とスクリプト
├── <starterのlockfile>              # Sites用。1種類だけ採用
├── <starterのbuild/TS設定>          # Sites統合を維持
├── .openai/
│   └── hosting.json                 # Sitesの配備設定・DB/R2バインディング
├── .env.example                     # Sites用の変数名だけ。実値は含めない
├── app/
│   ├── layout.tsx                   # 最小限の全体レイアウト
│   ├── globals.css                  # tokens.cssの読込などだけ
│   ├── page.tsx                     # 参加入口の組み立て
│   ├── play/[roomId]/page.tsx        # 参加者ページの組み立て
│   └── api/v1/                      # HTTPルートの薄い入口
│       ├── rooms/...
│       ├── rounds/...
│       └── submissions/...
├── components/                      # Akibako さん
│   ├── ui/                          # Button、Card等の共通表示部品
│   └── game/                        # TopicCard、Leaderboard等
├── styles/                          # Akibako さん
│   └── tokens.css                   # 色・文字・余白。巨大な共通CSSを避ける
├── public/
│   ├── brand/                       # 共通の名称・ロゴ等の静的素材
│   └── mobile/                      # モバイル向け画像
├── features/                        # mae さん
│   ├── join/                        # 参加処理・入力状態
│   ├── camera/                      # 撮影・圧縮・プレビュー
│   ├── game/                        # お題・結果・順位の画面状態
│   └── session/                     # 復帰・セッション管理
├── lib/mobile/                      # mae さん。APIクライアント等
├── contracts/                       # Ahwenuが取りまとめ、利用者が確認
│   ├── room.ts                      # HTTP/MCPで共通利用するDTO
│   ├── submission.ts
│   ├── errors.ts
│   └── schemas/                     # 依存なしのJSON Schema等
├── server/
│   ├── game/                        # さが さん。進行・採点・締切
│   ├── auth/                        # さが さん。認証情報の発行・権限検証
│   ├── storage/                     # さが さん。R2・画像検証・保持期限
│   ├── repositories/                # さが さん。D1の読込・更新
│   ├── http/                        # Ahwenu。入力検証・サービス呼出・DTO変換
│   │   ├── rooms/
│   │   ├── submissions/
│   │   └── composition/             # バックエンドとAIの接続・依存の組立て
│   └── integrations/                # Ahwenu。外部APIのアダプター
│       ├── topics/
│       ├── judge/
│       └── references/
├── db/                              # さが さん
│   ├── schema.ts                    # スターターの入口を維持
│   ├── index.ts                     # スターターのDB接続
│   └── <starterのmigration関連>     # SQLと生成メタデータ
├── plugin/                          # Sitesとは独立したビルド単位
│   ├── package.json                 # プラグインだけの依存・build/package
│   ├── <pluginのlockfile>           # プラグイン用。ルートと分離
│   ├── plugin.json                  # Ahwenu。登録・表示名
│   ├── mcp.json                     # Ahwenu。MCP起動設定
│   ├── .env.example                 # 接続先等の変数名だけ
│   ├── src/
│   │   ├── server/                  # Ahwenu。MCPツール・Sites接続
│   │   ├── ui/                      # 未定（Ahwenu）。ホスト画面
│   │   └── shared/                  # 骨格用の暫定DTO。親をimportしない
│   ├── tests/server/                # Ahwenu
│   ├── tests/ui/                    # 未定（Ahwenu）
│   └── dist/                        # 生成物。手編集しない
├── tests/
│   ├── mobile/                      # mae さん
│   ├── backend/                     # さが さん
│   ├── api/                         # Ahwenu
│   └── integration/                 # 関係担当で結合検証
└── docs/
    ├── 01-...09-*.md                # 現在の仕様・構成
    └── adr/                         # 判断理由と変更履歴
```

各機能は個別ファイルからimportし、全員が変更する巨大な `index.ts` や単一の共通サービスを作らない。表示部品のスタイルは部品の近くに置き、features側は処理と画面の組み立てを持つ。

## 担当ごとの編集範囲

| 担当 | 主な編集先 | 原則として直接編集しない箇所 |
| --- | --- | --- |
| Akibako さん | components、styles、public/brand・mobile | features、API、server、db |
| mae さん | features、lib/mobile、appの参加者ページ・layout、tests/mobile | componentsの表示仕様、app/api、server、db、plugin |
| さが さん | server/game・auth・storage・repositories、db、tests/backend | app/api、server/http・integrations、plugin UI |
| Ahwenu | app/api、server/http・integrations、contracts、plugin/src/server、tests/api | 参加者画面、表示部品、DB所有の実装 |
| 未定（Ahwenu） | plugin/src/ui、plugin/tests/ui | MCPサーバー、Sites側のゲームルール |

これはアクセス禁止ではなく、同じファイルへの同時編集を減らす取り決め。他担当領域の修正が必要なら変更範囲を共有して小さい変更にする。API接続だけのためにバックエンド実装を複製しない。

## 共有ファイルの取りまとめ

| 競合しやすい箇所 | 取りまとめ担当（初期案） | 更新ルール |
| --- | --- | --- |
| Sites側のpackage.json・lock・ビルド/TS設定・hosting.json・CI | Sites担当と調整 | API担当が一括変更しない。必要な差分を共有して順番に統合 |
| apiのpackage.json・lock・起動設定 | Ahwenu | plugin/Sitesの依存へ混ぜない。秘密設定はローカルだけに保持 |
| pluginのpackage.json・lock・manifest・配布設定 | Ahwenu | 画面担当の依存追加もここで調整。Sitesのlockに混ぜない |
| contractsとAPIサンプル | Ahwenu | mae さん・さが さん・拡張画面担当と互換性を確認 |
| DBスキーマ・SQL・生成メタデータ | さが さん | マイグレーション生成を直列化。適用済み履歴を上書きしない |
| tokens.css・共通UI | Akibako さん | mae さんは必要なpropsや表示変更を提案して取り込む |
| ADR一覧・Project.md | 方針変更の担当者 | 短い独立変更で統合。ADR番号は最新の一覧を確認して確保 |

設定取りまとめは追加の実装担当を作るものではない。各担当は自分の依存が必要になった時点で、用途と対象ビルドを明記する。配備設定を複数ブランチで並行変更しない。

## 依存方向と受け渡し

- 参加者：`appのページ → features → lib/mobile → HTTP API`。表示は `components` を利用する。
- API：`app/api → server/http → server/game・auth・storage`。DBはrepositories経由に寄せる。
- 外部AI：HTTPのcomposition層がバックエンドとintegrationsを組み合わせる。ゲーム層からHTTPルートや画面をimportしない。
- 拡張：`plugin UI → MCPブリッジ → plugin server → Sites HTTP API`。pluginからD1/R2を直接操作しない。
- contractsにはDTO・エラーコード・依存なしのスキーマだけを置く。React、Workers、DB、秘密設定をimportしない。ライブラリ依存の実行時バリデーターは各実行環境側に置く。
- 今回のplugin骨格では `src/shared/contracts.ts` に暫定DTOを置き、親の `contracts/` をimportしない。共有契約が定まったらアダプターで対応し、契約同期時は双方を検証する。ビルド・配布先で `../contracts` やSitesのnode_modulesを必要としない方針を維持する。
- SitesとpluginのUIコンポーネントは直接共有パッケージ化しない。最初はデザイントークンの仕様を共有し、ビルド間の結合を増やさない。

## デプロイと配布

現在のSites作業ルートは `apps/cloud/`。下表のSites行は将来の配置案であり、移動済み・配備済みとは扱わない。取り込み元の設定は本環境での接続先・所有権を確認してから利用する。

| 単位 | 作業ルート | 必要な入力 | 成果物・配備先 |
| --- | --- | --- | --- |
| Sites | リポジトリ直下 | ルートの依存、app/features/components/server/db/contracts、Sites設定 | Sites公式ビルド/配備フローの出力 |
| Plugin Extensions | plugin/ | plugin内の依存・src/shared・manifest・設定 | UI/MCPを含む単独のプラグイン配布物。実ホスト登録は別途確認 |

Sitesのチェック・ビルド対象からpluginのソース・dist・node_modulesを除外し、プラグインのインストールやビルドをSitesの前提にしない。配備アーカイブもSitesの対応する除外機構で不要なプラグイン生成物・依存を含めない。マニフェストやスターターの必須ファイルは維持する。具体的な除外方法はスターター導入時に検証する。

pluginにもSitesのビルド出力を含めず、接続先URLは設定で切り替える。秘密値はどちらの配布物にも含めない。出力先を共通のdistに集めない。Node専用MCP依存がWorkersのバンドルへ混入しないことを確認する。

CIはSitesとpluginを別ジョブに分ける。contracts変更時は両方を検証し、db変更時はSitesとマイグレーションを検証する。docsのみの変更では文書リンク等を確認する。スクリプト名は各package.json作成時に固定し、公式Sitesビルドを独自コマンドで置き換えない。

## 競合を減らす進め方

1. 初回にスターター・ルート設定・plugin骨格をまとめて整え、小さい状態で各ビルドを確認してから担当別の作業を始める。
2. 共有DTO、ゲームサービスの引数/結果、コンポーネントのpropsを小さな先行変更で揃え、各担当は同じ契約のモックを使う。
3. デザイン変更とAPIロジックを同じファイルに入れない。appのルートは薄く保ち、詳細は担当別フォルダへ置く。
4. 依存・DB・配備設定は上記担当が順番に統合する。全員が同じlockやmigrationメタデータを再生成しない。
5. 全体整形・全ファイルのimport並べ替え・大規模リネームを機能開発に混ぜない。必要なら独立した変更で先に合わせる。
6. 小さい単位で最新ブランチを取り込み、契約は当面追加変更を優先する。DTO削除などの破壊的変更はSites/pluginの両方を移行してから行う。

フォルダ分離だけでコンフリクトがゼロになるわけではない。特に共有型、設定、生成ファイルの担当固定と変更順序が重要になる。

## 構成の確認条件

- pluginの依存をインストールせずSitesをクリーンビルドできる。
- Sitesをビルドせずpluginをビルドでき、配布物を別の場所へ移しても動く。
- contracts変更で両方の型/ビルド検証が走る。
- Workers出力にMCP/Node依存やホスト資格情報が混入しない。
- DBマイグレーションが所定のSitesフローで適用できる。

plugin骨格のローカル検証と、Sitesを含む上記の構成検証を区別する。Sitesのビルド分離・Workers出力・DB移行は未検証。全体の実証後に[ADR-0006](adr/0006-deployment-and-folder-boundaries.md)の提案部分の採否を確定する。
