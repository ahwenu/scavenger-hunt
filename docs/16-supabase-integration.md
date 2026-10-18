# Sitesの保存・参加者APIと事前招待の受け渡し

更新日：2026-10-18。現在の方針は[ADR-0020](adr/0020-sites-persistence-advance-invites.md)。このファイル名は既存リンクの互換のため維持する。以前のSupabase採用指示と未実施の移行計画は[ADR-0016](adr/0016-supabase-game-persistence.md)へ残し、今回の最新指示で置き換える。

## 確定した前提と現状

| 項目 | 現在の方針・確認した範囲 |
| --- | --- |
| 本番ゲーム記録 | 既存SitesのD1を継続。部屋、参加者、競技、提出、ヒントを永続化し、得点・順位をサーバーで確定 |
| 写真 | 既存の非公開R2へ一時保存し、判定後に削除 |
| フロント接続先 | `apps/cloud/app/participant/api.ts` から同一オリジンの `/api/rooms/:id`。Supabase直接接続はなく、実行ソースにSupabase SDK/呼び出しはない |
| 実演 | 同じQRから来る約100人が全員プレイヤー。人数と順位を画面へ自動反映する |
| 事前招待 | D1へ待機部屋を作り、同じ参加URL/QRを事前に配布。事前招待部屋はホストが明示開始するまで待つ |
| 現行認可 | 参加者は部屋限定Bearer、ホストは部屋別HttpOnly Cookie。認証方式は維持 |
| 今回の追加実装 | 部屋の開始方式、revision/live/activePlayers、QR保存・参加URLコピー、MCP再起動後のホスト部屋復帰。実装・検証結果は末尾へ記録 |

さが さんが保存・ゲーム進行・確定した得点/順位を、AhwenuがHTTP・AI接続を担当し、mae さんは取得した確定値を表示する。Pluginの正式な画面担当は未定（Ahwenu）。今回はSitesの既存D1/R2を継続するため、Supabase URL・秘密キー・スキーマの受領や移行を前提にしない。

## フロントとPluginの境界

| ルート | 入力と出力・追加契約 |
| --- | --- |
| `POST /api/rooms` | `{name,autoStart?:boolean}`。省略時trueを維持。Pluginの事前招待部屋はfalseを送る |
| `POST /api/rooms/:id/join` | JSON `{name}` → **201** `{id,token}`。上限100人、満員/終了409。手動開始部屋への参加で開始カウントダウンを作らない |
| `GET /api/rooms/:id/state` | Bearer →既存状態と `game,stages,ranks[].score/rank,mine[].awardedPoints`。追加：`room.autoStart,lobby.autoStart,revision,live,stats.activePlayers`。時刻はepochミリ秒 |
| `POST /api/rooms/:id/submit` | Bearer、multipart `roundId,requestId,photo` → 202 `{id,status,receivedAt}`。D1で重複受付・二重加点を防止し、同じrequestIdの再送は同じ提出ID |
| `GET /api/rooms/:id/hint?roundId=...` | 200 `{roundId,text,available}`、未用意null/false、対象外409。保存済み共通ヒントだけを返し、閲覧時にAI生成しない |
| `POST /api/rooms/:id/host/start` | 部屋別ホストCookieで初回/次競技を開始。手動開始部屋の初回はこの操作まで待つ。AI準備中は既存の202経路を使う |

既存フィールドの名前・意味と `sync: "polling"` は互換を保つ。旧UIブランチの200/200人という記述はmain統合前の履歴であり、現契約へ戻さない。エラーは現行互換の `{error: "画面に表示できる説明"}`。秘密値、他人の提出詳細、未来のお題は返さない。

10競技、各競技の最初の合格だけ500点、得点降順→合格受付までの累計時間→参加時刻→IDの順序、共通ヒント、finishedは既存の実装契約。正本は[ADR-0013](adr/0013-issue1-player-game-contract.md)、確定HTTP契約と公開v3の記録は[14](14-issue1-ahwenu-handoff.md)。当時照合したmain `29e6728` と公開100HTTPデモ記録・終盤transport失敗/補完結果を保持し、今回の再実行結果と混同しない。

## 事前QR配布と開始方式

Plugin Extensionsの新規作成は `autoStart:false` で部屋を作成する。参加者0人でも同じ `/rooms/:id/join` のQRを準備でき、事前参加後も `lobby.deadline=null` で待機する。参加者には「ホストが開始するまで待機」と表示し、当日に同じ部屋のホストが準備・開始する。事前参加した人のIDや順位を別部屋へコピーしない。

`autoStart` を省略した既存クライアント・既存部屋はtrueを保持し、初回参加から30秒で開始する従来の契約を継続する。falseの部屋に30秒の表示や締切を補ってはならない。

ホストは「参加QRを配布」から参加URLコピーとQR画像保存を行う。QRはローカルで生成し、参加URLだけを符号化する。画像保存にはMCP Apps SDKの標準ホスト機能を使い、未対応時は読み取り専用のURL欄を選択して手動コピーできるようにする。参加URL・QR・保存画像にはホストCookieやAPIキーを含めない。

準備と当日の間にMCPを再起動しても同じ端末・同じSites originの部屋へ戻れるよう、MCPサーバーがホストCookie等をユーザー状態ディレクトリの権限0600ファイルへ保存する。復帰時は保存したoriginの一致を検証する。ゲーム記録は引き続きD1の正本を取得し、ローカル状態をGit・配布物へ入れない。別端末へのホスト権限共有はこの機能の範囲外。

## 人数と順位のライブ更新

既存のstate定期取得を継続し、追加のリアルタイム基盤やSupabase Realtimeを前提にしない。次の項目を今回の追加契約とする。

- `revision: number`：D1に永続化する部屋の単調な版。人数、競技、提出結果、得点/順位の保存内容や認証通信記録の更新で増える。部屋共通データと同じスナップショットで取得し、別Workerの更新に対して古いキャッシュを返さない。時間経過だけで在席近似人数が減るときは同じrevisionとなるため、同じ版でも人数と残り時間を最新応答から表示する。
- `live: { pollIntervalMs: 2000, activeWindowMs: 30000, updatedAt: number }`：2秒の取得目安、在席近似の30秒窓、D1の部屋更新時刻。画面復帰時は全スナップショットを再取得する。
- `stats.players`：登録済みの全プレイヤー数。ブラウザを閉じても減らさない。
- `stats.activePlayers`：直近30秒以内に認証済み通信があった人数。players.lastSeenAtの更新は10秒に1回までとし、厳密なオンライン在席の保証とはしない。個々の最終通信時刻を参加者へ公開しない。
- `ranks`：全登録プレイヤーの確定した順序。`rank` は1始まり。同得点でも累計時間、参加時刻、IDで順序を決める。切断だけでは得点も順位も削除しない。

100画面を2秒間隔で取得すると平均約50 req/sとなる。人数/順位の変更が100画面へ反映されるまでp95 3秒以内を検証目標とし、保証値とはしない。実測の成功率・429/5xx・遅延と、デモ判定/実AI/スマホ実機の条件を分けて記録する。

## 環境設定とマイグレーション

参加者画面にDB資格情報を登録しない。同一オリジンのSites APIがD1/R2へアクセスする。

| 名前 | 設定場所・用途 |
| --- | --- |
| `DB` | SitesのD1バインディング。部屋・参加者・競技・提出等の正本 |
| `BUCKET` | SitesのR2バインディング。判定中の非公開写真 |
| `OPENAI_API_KEY` | 既存Cloud AIを使う場合のSitesサーバー秘密設定。Pluginへコピーしない |
| `SITES_API_BASE_URL` | Pluginの接続先。既存の接続設定を維持 |
| `KARIMONO_API_URL` / `KARIMONO_API_TOKEN_FILE` | Pluginの独立AI接続参照。Sites接続と分け、Plugin更新時にも引き継ぐ |

既存 `0003_issue1_round_hint` までのマイグレーションを保持し、開始方式・版・在席近似の項目は[0004_sites_live_and_advance_rooms.sql](../apps/cloud/drizzle/0004_sites_live_and_advance_rooms.sql)で追加する。旧部屋はautoStart=1・revision=0・updatedAt=0、旧参加者はlastSeenAt=0で開始する。updatedAt=0はAPIでcreatedAtを返し、lastSeenAtは以後の認証通信で更新する。過去のSQL・lockを手編集せず、秘密値や実際の秘密ファイル保存先を本文・Git・ログへ記録しない。

## 今回の実装・検証状況

Sites側では0004のスキーマ追加・更新トリガー、手動/自動開始の互換、revision/live/activePlayersと参加者向け待機説明を実装した。Workersハンドラー/SQLiteの16件（今回の回帰5件を含む）、最新mainの参加者トップ/音声を統合したルート全87件、Cloud9件、TypeScriptチェック、Drizzleのスキーマ差分なし、Sitesビルドの成功を担当エージェントが確認した。これはローカルの実装・自動検証であり、公開DBへの0004適用や新しい公開版の成功は示さない。

root担当が[verify-cloud-invitations.mjs](../scripts/verify-cloud-invitations.mjs)でビルド済みWorker＋MiniflareのD1/R2を実行し、事前参加後の手動待機、revision/在席近似人数、PNG/SVGのQR API・React参加ページ、ホスト認可、明示開始、写真のデモ合格500点、別参加者への順位同期・本人mineの分離を確認した。Git対象外レポートは `plugin/artifacts/advance-invitation-local.json`。これはローカルの実Worker結合で、デモ合格を実AI判定に読み替えない。

Pluginの追加で、実workerd/D1/R2による既存100人結合も成功し、100人参加・100写真受付・全員500点・本人結果の分離・100件の共通ヒント閲覧と確定イベントを確認した。429と5xxは0。状態取得p95は180.94ms、受付p95は610.07ms、結果取得p95は197.84msだった。これはローカルのHTTPクライアント試験であり、公開100端末や実AIの成績ではない。Git対象外の `.sites-runtime/issue1-local-verification.json` に記録した。

QR読取URL一致、保存機能、MCP再起動後復帰と公開実行環境の実施結果は確認後に追記する。既存D1/R2の公開配備や100HTTPデモの実績は[12](12-sites-deployment.md)・[14](14-issue1-ahwenu-handoff.md)、Pluginの各版の実装・検証は[08](08-plugin-extensions.md)に残す。実機撮影・実端末100台の未確認範囲は継続する。
