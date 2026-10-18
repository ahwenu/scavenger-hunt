# カリモノ

**借り物王に俺はなる！**

公開URL、作った理由、遊び方、画面画像、技術スタックと審査観点への対応は、リポジトリ直下の[README](README.md)にまとめています。以下は開発方針・受け渡し・検証履歴の索引です。

Plugin 0.4.1では、初回接続失敗後の再試行と、部屋・独立AIの初期確認を分離しました。既存部屋からの新規作成ボタンと、参加者0人でゲーム用AI準備が無効な理由も表示します。調査時のAPIと実拡張は接続でき、ユーザーも復帰を確認済みです。47件・型チェック・両配布物の可搬性と、公式ブリッジでの初回タイムアウトからの復帰・実部屋作成・実AI生成を確認しました。元の症状と再現試験の結果、配備状況は[08 ホスト画面仕様](docs/08-plugin-extensions.md)へ分けて記録しています。SitesのAPI・認可・ゲームルールは変更しません。配備直前にmainをプルし、修正 `f6ca8d3` をpush後、2026-10-18 16:55 JSTにローカルPlugin 0.4.1をインストール・有効化しました。新規stdioのSites/独立AI接続と新UI URIを確認済みです。

ホスト画面を、Plugin Extensionsの表示領域内で進行できる一画面配置へ更新しました。狭いパネルではタブ、多人数の参加者・順位はページ切替を使い、ランキングの追加・加点・順位上昇・首位交代を視覚演出します。運動会テーマと既存のAPI・確定得点は継続します（[ADR-0017](docs/adr/0017-viewport-host-ranking-effects.md)）。0.4.0の39件・ビルド・通常/共有配布物の可搬性、ローカルfixtureの240項目とQR読取を確認しました。main `06fb7e5` をpush後、2026-10-18 16:44 JSTにローカルPlugin 0.4.0をインストール・有効化し、接続設定参照と最終バンドル一致を確認しました。実装・配備の確認結果は[08 ホスト画面仕様](docs/08-plugin-extensions.md)を参照してください。

Plugin Extensionsを自分の環境へ取り込む方は、[取り込み手順](plugin/INSTALL.md)を参照してください。配布者は `plugin/` の `npm run share` で、ビルド済み共有ファイルと手順をまとめます。

- チーム名：ONE LEASE
- アプリ名：カリモノ
- キャッチコピー：借り物王に俺はなる！

会場内でお題に合うものを探して撮影し、AIの判定による得点で競うスマホ向けブラウザゲーム。

Issue #1のバックエンド対応として、Sitesの既存 `/api/rooms/:id` を100人・最大10競技・各競技の初合格500点へ拡張しました。全10ステージ、確定得点・連番順位、競技ごとの共有ヒントを返します。さが さんの元実装・ローカル100人検証を保持し、後続のAhwenu担当作業でmain統合と公開v3配備・0003マイグレーション、Plugin 0.3.1のインストールを完了しました。公開100HTTPクライアントのデモ500点/finishedとヒント、実AIの条件不一致による不合格0点を確認済みです。実AIの合格500点・実端末100台・ネイティブパネル直接操作は未検証です。[受け渡し契約](docs/12-issue1-backend-handoff.md)と[ADR-0013](docs/adr/0013-issue1-player-game-contract.md)を参照してください。

Ahwenu宛5項目の実装・配備・ファイルでの受け渡しを完了しました。main `669731c` をcommit/push済み。公開100HTTPクライアントのデモ第1競技で100人参加・100写真受付・各500点・本人分離・共通ヒントを確認し、補完1人10競技もfinishedへ到達しました。終盤のtransport失敗、実AIの陰性経路、陽性加点の未検証を[14 Ahwenu受け渡し](docs/14-issue1-ahwenu-handoff.md)へ分けて記録しています。Issueを閉じる操作やコメント送信は行っていません。

Plugin Extensionsのホスト画面とMCPサーバーを、移動可能な `plugin/` にまとめています。[起動・移動手順](plugin/README.md)を参照してください。ローカル登録・有効化に加え、ユーザー操作と提供画像により実拡張内の表示・API接続確認・お題生成を確認済みです。Sitesソースは `apps/cloud/`、ローカルデモは `apps/server/`・`apps/web/` にあります。取り込み当初の未検証記録は[10](docs/10-demo-import.md)、今回の配備・実結合と残る未検証範囲は[14](docs/14-issue1-ahwenu-handoff.md)を参照してください。以下の文書を担当者間の実装契約に使います。

参加者画面の仕様と取り込み済みプロトタイプの差は[参加者画面の作業コンテキスト](docs/participant-frontend/mobile-frontend-context.md)に記録しています。

参加者向け画面は提供デザインをもとにTypeScriptで実装する方針です。このブランチの参加URLと画面見本の扱いは[ADR-0015](docs/adr/0015-participant-typescript-ui.md)を参照してください。ハッカソン実演では同じQRから入る約100人は全員プレイヤーとします。10競技・500点・共通ヒントのAPIはmainへ実装済みで、参加者画面はサーバーの確定値を表示します。Supabaseと人数/順位更新の追加契約は[Issue #1](https://github.com/ahwenu/scavenger-hunt/issues/1)の残依頼です。

本番ゲーム記録の保存先は、ユーザー指示により**Supabase**とします（[ADR-0016](docs/adr/0016-supabase-game-persistence.md)）。参加人数と順位の変化を画面へ自動反映することも実演の要件です。現行コードと既存Sites v3はD1/R2であり、Supabaseの接続・スキーマ・Supabaseでの100人同時利用は未確認です。D1の公開100HTTP試験記録は上記14へ分けています。参加者の同一オリジン `/api/rooms/:id` 境界を保つ引き渡しと設定項目は[16 Supabase統合](docs/16-supabase-integration.md)を参照してください。

ユーザー指定の運動会・猫耳キャラクターのスマホ案を参考に、0.3.0のホスト画面を実装しました。素材をpluginへ同梱し、参加者・勝利数・時間はHTMLで表示します。インストール済みHTMLの検証ホストで1280/390px表示・実部屋のQR読取/匿名参加ページ200、別MCPの明示デモ進行を確認済みです。この0.3.0画面確認ではネイティブ拡張パネルの直接操作、新しい参加登録・有料AI呼出は未実施でした。後続0.3.1の結果は14を参照してください（[ADR-0012](docs/adr/0012-sports-day-host-ui.md)、[素材ガイド](docs/design/sports-day-ui-assets-v1/README.md)）。

独立API実装時の作業範囲はAhwenuのAPI処理に限定し、`api/` でお題生成・写真判定を提供して拡張からMCP経由で接続しました。この段階ではSites側を変更せず、実AIの確認画面とゲームデモを分離しています。[11 API連携](docs/11-api-integration.md)に当時の契約・検証を記録しています。現在の新Sites配備・Cloud/Web反映は、下記の追加指示に基づく別フェーズです。

新Sitesのv1・v2本番配備と、ログイン不要のpublic変更が成功しました。CloudをSitesの実行ルート、全ソースを `repository/` の保存用スナップショットへ置いています。インストール済みplugin 0.2.0のsitesモードから実MCP/HTTPで、部屋作成→匿名参加→実AI生成→開始→JPEG提出/実判定→勝利数順位→ラウンド終了を1例確認しました。ネイティブ拡張UIの直接操作、スマホ実機・複数人評価は別途確認します。今回のCloud/Web・pluginの差分も元リポジトリで管理します。Sites専用ソースとGitHub mainのコミットは区別します。[12 新Sitesの配置と接続](docs/12-sites-deployment.md)を参照してください。

通常のお題生成はResponses APIのStructured Outputs、写真判定はDecisions APIを使います。ブラウザプレビューからMCP経由の実お題生成と、JPEG画像の実判定を1例確認しました。Agents APIは参考写真を明示的に有効にしたときだけ使い、このモードの成功は未確認です。標準生成の変更理由と検証結果は[ADR-0010](docs/adr/0010-independent-ai-api.md)に記録しています。

独立API実装時には、ユーザーのWork内実Plugin Extensionsでの「API接続確認」→「AI生成」操作と提供画像2枚から、接続済みと「文房具のペンを探そう」の表示を確認しました。当時未検証だったSitesの参加・得点・順位の結合は後続作業で検証し、現在の範囲と限界を14に記録しています。

モバイルとPlugin UIにOtoLogicの無料効果音11種類を同梱し、操作・参加・撮影・受付・開始・正解/不正解・残り5秒・結果発表で再生します。端末別ON/OFFとクレジットを追加し、初回/定期同期の重複再生を抑制します。出典・加工内容・検証範囲は[15 効果音仕様](docs/15-sound-effects.md)、方針は[ADR-0014](docs/adr/0014-game-sound-effects.md)を参照。公開Sitesへは後続指示により2026-10-18 16:35 JSTにv5を配備済み。匿名トップ200・全11 MP3の配信と元バイト一致を確認しました。インストール済みPluginへの更新・実機試聴は今回のSites配備に含めていません。

## 担当割り振り

| 領域 | 担当 | 実施すること |
| --- | --- | --- |
| デザイン | Akibako さん | 参加者のスマホ画面、色・文字・余白、状態別の表示と共通UI部品 |
| フロントエンド開発 | mae さん | Sitesのモバイル画面、参加・カメラ・写真送信・結果表示・API接続・復帰処理 |
| バックエンド開発 | さが さん | SitesのDB・画像保存・ゲーム進行・締切・加点・順位・認可・永続化 |
| APIの処理 | Ahwenu | HTTP API契約とルート、お題生成・写真判定などの外部API接続、MCPサーバーとSitesの橋渡し |
| Plugin Extensionsの画面開発 | 未定（Ahwenu） | ホストの部屋作成画面、参加者一覧、ランキング、進行操作、UIからのMCP接続 |

Plugin Extensionsの画面担当は未確定であり、Ahwenuを暫定候補として記載しています。mae さんの担当は参加者向けモバイル画面です。具体的な作業と担当間の受け渡しは[07 分担・開発手順](docs/07-delivery-plan.md)を参照してください。

## 開発文書

| 文書 | 内容 | 主に読む担当 |
| --- | --- | --- |
| [01 要件・スコープ](docs/01-product-scope.md) | MVP、完成版、ゲームルール、完了条件 | 全員 |
| [02 技術構成](docs/02-architecture.md) | Sites、技術選定、構成図、実行制約 | 全員 |
| [03 画面・フロントエンド](docs/03-ui-frontend.md) | スマホ画面、状態、コンポーネント契約 | デザイン・フロントエンド |
| [04 API契約](docs/04-api-contract.md) | 認可、エンドポイント、入出力、エラー | mae さん・さが さん・Ahwenu |
| [05 データ・ゲーム処理](docs/05-data-backend.md) | DB、状態遷移、加点、時間、画像管理 | バックエンド |
| [06 AI・外部連携](docs/06-ai-integrations.md) | お題生成、写真判定、参考写真 | Ahwenu・さが さん |
| [07 分担・開発手順](docs/07-delivery-plan.md) | 担当者別の責務、並行開発、検証、未決事項 | 全員 |
| [08 Plugin Extensions](docs/08-plugin-extensions.md) | ホスト管理画面、MCP、Sites接続 | 未定（Ahwenu）・Ahwenu・さが さん |
| [09 フォルダ構成・デプロイ](docs/09-repository-structure.md) | 担当別の編集先、独立ビルド、共有ファイルの更新ルール | 全員 |
| [10 デモアプリ取り込み](docs/10-demo-import.md) | 取り込み元の配置、既存方針との差分、配備時の注意 | 全員 |
| [11 API連携](docs/11-api-integration.md) | Ahwenuの独立AI API、拡張との接続、秘密設定、Sitesとの受け渡し | Ahwenu・さが さん・拡張画面担当 |
| [12 新Sitesの配置と接続](docs/12-sites-deployment.md) | 全ソースの保持、Cloud実行、publicアクセス・部屋認可、拡張の実ゲーム接続 | 全員 |
| [12 Issue #1バックエンド受け渡し](docs/12-issue1-backend-handoff.md) | 100人・10競技・500点の契約と、さが さんの初期実装/ローカル検証履歴 | さが さん・Ahwenu・mae さん |
| [13 MCP Events調査](docs/13-mcp-events-audit.md) | 公式イベント機能の未使用、2秒ポーリングと独自イベントの違い | Ahwenu・バックエンド・拡張画面担当 |
| [14 Issue #1 Ahwenu受け渡し](docs/14-issue1-ahwenu-handoff.md) | 5項目の対応、確定HTTP/MCP契約、mae向け応答例、公開版の検証 | Ahwenu・さが さん・mae さん |
| [16 Supabase統合](docs/16-supabase-integration.md) | 本番保存先、既存API互換、人数/順位の更新、環境設定、バックエンドへの受け渡し | mae さん・さが さん・Ahwenu |
| [当日の全体コンテキスト](docs/hackathon/README.md) | ゴールを決める項目、実演の1周、担当間の受け渡し、確認済みの範囲 | 全員 |
| [ADR：開発方針の決定記録](docs/adr/README.md) | 判断理由、採否、変更履歴、更新手順 | 全員 |
| [参加者画面の作業コンテキスト](docs/participant-frontend/mobile-frontend-context.md) | 現行仕様と追加メモ・取り込みコードの差、mae担当の受け渡し | mae さん・連携担当 |
| [参加者画面の整合計画](docs/participant-frontend/2026-10-18-参加者画面の整合計画.html) | 実コードの確認結果と整合手順 | 全員 |

構成：**ホスト画面＝Plugin Extensions／参加者スマホ画面とバックエンド＝Sites**。追加指示に従い、添付図からホスト画面の配置を変更しています。

最初に01で作る範囲を共有し、03・04の画面状態とAPI契約を合わせてから実装します。仕様変更時は関係する文書を同じ変更で更新します。

重要な方針決定・変更時は、[ADR](docs/adr/README.md)を同じ変更内で追加・更新します。確定したユーザー指示はAccepted、未検証の技術やMVP数値はProposedとして記録しています。作業時の継続更新ルールは[AGENTS.md](AGENTS.md)に記載しています。

配置はデプロイの容易さを最優先にします。Sitesをリポジトリ直下に置く案は未実現で、現在は取り込み元の `apps/cloud/` を維持しています。Plugin Extensionsは独立した `plugin/` とし、フォルダ単位で移せるよう依存・契約・ビルド設定・起動設定を内部に置きます（[ADR-0008](docs/adr/0008-portable-plugin-scaffold.md)）。実API接続はアダプター境界で追加し、デモ状態と本番のゲーム記録を区別します。担当別フォルダ、共有設定の取りまとめ、Sites側の未検証事項は09を参照してください。

添付された2枚の画像は製品構想の参考資料として扱っています。画像内の数値・サービス構成は実装済みの事実ではありません。文書内で「方針」「提案」「目標」「要検証」を区別しています。
