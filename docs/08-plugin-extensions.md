# Plugin Extensions：ホスト管理画面

## 必須の構成

**部屋を建てた人の画面はPlugin Extensions内に実装する。Sitesは参加者向けモバイル画面とバックエンド処理を担当する。** これはユーザーの追加指示による確定方針。ホストのSites管理ページへの置き換えは行わない。

Plugin ExtensionsはMCP AppのUIをホストアプリ内に表示する方式を使う。拡張の登録・UIリソース・表示方式は公式SDKに従う。[OpenAI: Plugin Extensions](https://developers.openai.com/plugins/build/extensions)、[MCP UI](https://developers.openai.com/plugins/build/chatgpt-ui)

MVPではCodexのローカルプラグイン＋stdio MCPサーバーを第一候補にする。この環境にあるBroadcast Deckの実装資料でも同方式を確認した。ChatGPTへの配布やリモートMCP接続の対応は別の作業であり、ローカル登録で両方が使えるとは扱わない。

## ホスト画面

拡張のユーザー向け表示名は「カリモノ」とし、制作チーム名は「ONE LEASE」、キャッチコピーは「借り物王に俺はなる！」とする。内部のツール名・リソースURIを名称表示のためだけに変更する必要はない。

| ID | 表示 | 操作 |
| --- | --- | --- |
| H01 部屋作成 | 接続先の表示、作成状態 | 新規部屋作成、既存部屋へ復帰 |
| H02 ロビー | コード、参加用URL/QR、参加チーム一覧、最終通信、お題準備状態 | AI生成、プリセット選択、開始 |
| H03 ゲーム進行 | 現在のお題、残り時間、提出/判定状況、全チーム順位 | 結果確認、次問、途中終了 |
| H04 最終結果 | 最終順位、総得点 | 写真削除、新規ゲーム作成 |

MVPで「誰が参加しているか」は代表端末で登録したチーム名を指す。個々のメンバー一覧は完成版の複数端末参加に含める。切断判定は断定せず、lastSeenAtを用いた「最終通信から○秒」を表示する。

参加用URLのQRはUI側で生成できる。hostTokenをQR・URL・画面テキストへ含めない。ホストは拡張パネル内で完結し、参加者はURLからSitesを開く。

## UI→MCP→Sitesの契約

UIからのツール呼出しはMCP Apps SDKのホストブリッジを使う。採用するSDKのメソッド名と対応ホストの能力は試作時に確定する。UIがSitesへ直接fetchする方式を必須にしない。

| MCPツール案 | 入力 | Sites API | UIに返すもの |
| --- | --- | --- | --- |
| `host_open` | 任意のroomId | 必要ならhost取得 | 管理画面リソース、選択部屋の安全な状態 |
| `host_create_room` | operationId | POST rooms | roomId、コード、joinUrl。hostTokenを除外 |
| `host_get_room` | roomId | GET rooms/:id/host | HostSnapshot＋serverTime |
| `host_prepare_topics` | roomId、source、operationId | POST topics | 準備状態 |
| `host_start` | roomId、expectedVersion、operationId | POST start | 最新状態 |
| `host_advance` | roomId、expectedVersion、operationId | POST advance | 最新状態 |
| `host_finish` | roomId、expectedVersion、operationId | POST finish | 最新状態 |
| `host_purge_images` | roomId、operationId | POST purge-images | 削除件数 |

operationIdをHTTPのIdempotency-Keyへ写す。roomIdは入力だけで信用せず、MCP側で保管する管理権限と照合し、Sitesでも認可する。ホストUIは2秒ポーリングで更新し、閉じた時は停止する。MCP実行の許可や呼出頻度の制約は初期検証で確認し、会話モデルに2秒ごとの実行を依頼する方式にはしない。

MCPツールの `structuredContent` は安全なDTOのみとし、UIリソースは `ui://scavenger-hunt/host-v1` 等でバージョン管理する。トークンはモデル向け出力にもUI向けメタデータにも入れない。

## 認証と接続設定

MVPのローカル構成では、配備者がその配備専用の `HOST_SERVICE_TOKEN` をMCPサーバーとSitesの秘密設定にそれぞれ設定する。プラグイン配布物へ共通トークンを埋め込まない。Sitesはこのトークンに部屋作成だけを許す。これはアプリ独自の認証であり、Sites標準のサービスアクセストークンと混同しない。

部屋作成APIで発行されるランダムな部屋限定hostTokenは、MCPサーバー側のOS資格情報ストア等の安全な保管先に保存し、以後の管理APIで使う。Sitesにはハッシュと有効期限だけを保存する。MCPプロセス再起動後の復帰で利用できる保存手段を最初に検証し、リポジトリ・UIのlocalStorageには置かない。

作成権限と部屋権限は24時間で失効させる初期案とし、更新/再設定と失効時の表示を実装時に決める。公開配布の完成版では、利用者ごとの認証と部屋所有権を検証するリモートMCP方式などを設計し直す。個人配備用の秘密トークンを不特定の利用者に配布しない。

公開Sitesはモバイル参加のために使い、管理APIは常に上記の部屋認可を要求する。非公開Sitesを採用する場合のプラットフォームアクセス制御は別途必要で、Bearerヘッダーだけで通過できるとは仮定しない。

UIはMCP経由だけで通信する構成を優先し、追加の外部通信が必要ならCSPを限定して宣言する。ホストアプリ固有のブリッジ・CSP設定は公式リファレンスと実機で確認する。[OpenAI: Plugins Reference](https://developers.openai.com/plugins/reference)

## 配置と担当

配備単位・依存・共有DTOの扱いを含む全体構成は[09 フォルダ構成・デプロイ](09-repository-structure.md)に従う。plugin/はSitesと独立してビルドし、配布先でSitesのソースやnode_modulesを必要としない形を検証する。

```text
plugin/
  plugin.json            # プラグイン宣言
  mcp.json               # MCP起動設定
  src/server/            # ツール・HTTP接続・資格情報管理
  src/ui/                # ホスト画面とMCP接続
  dist/                  # 配布用UI/MCPバンドル
```

- Akibako さん（デザイン）：主対象はモバイル。ホストにも使える色・文字・部品の共通トーンを提供する。
- 未定（Ahwenu）（Plugin Extensions画面）：ホストReact UI、MCP UIブリッジ、ポーリング、操作中表示、再表示時の復帰を実装する。Ahwenuは暫定候補。
- Ahwenu（API処理）：MCPサーバー、ツール、資格情報の保管、Sitesの管理APIルートとHTTP接続を実装する。
- さが さん（バックエンド）：部屋・参加チーム・順位の正本、ホスト権限の発行/検証、開始・次問・終了サービスを実装する。ゲーム記録の正本をMCP側に複製しない。
- mae さん（フロントエンド）：Sitesの参加者モバイル画面を担当する。Plugin Extensionsの画面開発は担当に含めない。

## MVPで必ず検証すること

1. Plugin Extensionsから管理画面を開き、部屋を作成できる。
2. スマホで参加したチームが拡張の参加一覧に現れる。
3. スマホ提出で加点され、拡張の順位に反映される。
4. 拡張から開始・次問・終了ができ、全スマホに反映される。
5. 拡張の再表示・MCP再起動でも部屋を復元でき、二重操作を防げる。
6. 他部屋の操作・トークン漏洩を防ぎ、API接続失敗時に古いデータと分かる表示になる。

拡張画面の表示・MCP呼出・認証が実証されることをMVPの必須条件にする。ブラウザ上の見本だけでは完了としない。
