# Issue #1：バックエンドからHTTP/API・参加者画面への受け渡し

2026-10-18。対象：[Issue #1](https://github.com/ahwenu/scavenger-hunt/issues/1)、[ADR-0013](adr/0013-issue1-player-game-contract.md)。本書はさが さんの**初期ローカル実装・未配備時点の受け渡し記録**を保持する。後続作業でmain統合と公開v3/0003適用・Plugin 0.3.1インストールを完了し、公開デモ500点/finishedと実AI陰性経路を確認した。最終結果と残る未検証範囲は[14 Ahwenu受け渡し](14-issue1-ahwenu-handoff.md)を参照。既存 `/api/rooms/:id` への追加契約であり、04の `/api/v1` 初期提案やPluginデモのDTOとは別。

## 使う契約

全JSONは既存と同じ直下形式・時刻はUnixミリ秒。GETはno-store。参加者は部屋別Bearer、管理操作は作成したブラウザの部屋別HttpOnly Cookie。Sitesプラットフォームの公開範囲とは別の認可である。

| 操作 | 入力・応答 |
| --- | --- |
| `POST /api/rooms/:id/join` | JSON `{name}`、任意のprofileも従来どおり。201 `{id,token}`、満員/終了済み409。最大100人、同名も個別ID |
| `GET /api/rooms/:id/state` | 参加者Bearerで本人のmineを取得。既存room/serverTime/round/mine/ranks/stats/events等を保持。追加項目は下記 |
| `POST /api/rooms/:id/submit` | Bearer、multipart `roundId,requestId,photo`、写真1MiB以下。202 `{id,status:"queued",queued:true,receivedAt}`。既存のdemoResultはデモ判定専用 |
| 同じrequestIdの再送 | 同じ提出ID。処理中202、確定後200、`duplicate:true`。締切後や次問への移行後も既存提出の再取得は可能。新規提出とは区別する |
| `GET /api/rooms/:id/hint?roundId=...` | Bearer必須。200 `{roundId,text,available}`。未用意はnull/false、現在参加可能な競技以外409、未認証401 |
| `POST /api/rooms/:id/host/hint` | ホストCookie、JSON `{roundId,text}`。textは1〜500文字、nullで削除。現在の受付中競技だけ更新。参加者403 |
| `POST /api/rooms/:id/host/start` | 初回開始または次競技開始。競技進行中/判定待ち/最終競技後は409。次競技の開始権限は参加者に与えない |
| `POST /api/rooms/:id/host/end` | 現在競技の受付をclosedにする。受付済み判定は確定を待つ。10競技未満では全体finishedにはしない |

写真の締切後・他競技・参加前の競技への新規提出は409。同時処理中/合格済み/同じ画像も409、キュー・試行上限は429、保存失敗は503。内部uploadingはmineと再送応答ではqueuedに正規化する。rejected/errorは0点でverdict.reasonを返す。

## 状態応答の例

下記は新しい項目と主要既存項目の抜粋。実際の応答には従来のplayers・events・finishers・queue・lobbyなどもあり、ranksには部屋全員を返す。

```json
{
  "room": {"id":"room-a","name":"カリモノ"},
  "serverTime":1792300000000,
  "game":{"status":"playing","totalRounds":10},
  "round":{"id":"r3","number":3,"mode":"demo","status":"active","challenge":{"title":"赤いもの","description":"実物を撮影","criteria":["赤い実物"],"durationSeconds":120,"provider":"デモ生成"},"startedAt":1792299970000,"endsAt":1792300090000},
  "stages":[
    {"number":1,"status":"completed"},{"number":2,"status":"completed"},
    {"number":3,"status":"active"},{"number":4,"status":"locked"},
    {"number":5,"status":"locked"},{"number":6,"status":"locked"},
    {"number":7,"status":"locked"},{"number":8,"status":"locked"},
    {"number":9,"status":"locked"},{"number":10,"status":"locked"}
  ],
  "mine":[{"id":"s3","roundId":"r3","status":"accepted","awardedPoints":500,"verdict":{"pass":true,"reason":"条件に合っています"}}],
  "ranks":[
    {"id":"p1","name":"まえ","joinedAt":1792299900000,"wins":1,"score":500,"rank":1,"totalMs":1200},
    {"id":"p2","name":"さが","joinedAt":1792299901000,"wins":0,"score":0,"rank":2,"totalMs":0}
  ],
  "stats":{"players":2,"answered":1,"accepted":1,"pending":0,"queued":0,"processing":0}
}
```

- 最初の開始前：`game.status=lobby`、`round=null`、10ステージすべてlocked。
- 競技間：`game.status=playing`、直前のroundをclosedとして保持。既出ステージはcompleted、未開始はlocked。クライアントの「次のお題へ」で競技を開始しない。
- 最終競技の受付後：closedでも未確定提出がある間はplaying。全件確定するとfinished、全ステージcompleted。結果は再読込後もD1から復元する。
- 各プレイヤー・競技の最初の期限内受付の合格だけ500点。scoreは合計、winsはクリア数。順位はscore降順→totalMs昇順→joinedAt昇順→ID順の連番で、同点同順位にはしない。
- 締切前の受付済み写真は、締切後でも有効な処理リース内で確定可能。新しい写真の締切後受付は不可。
- ヒントの取得は生成しない。出題内容にhintがあれば初回保存し、現在の生成器がhintを返さない場合はホスト/API担当がhost/hintで設定するまで未用意となる。ヒント生成のAI実装は追加していない。

追加型は[game-contract.ts](../apps/cloud/lib/game-contract.ts)。Workers/UI/DB依存なし。Pluginの独立デモDTOを変更・混在させていないため、Plugin連携担当は後続のアダプターで対応する。

## DB適用・検証

- `rounds.hint` を追加する `apps/cloud/drizzle/0003_issue1_round_hint.sql` と生成snapshot/journalを追加した。既存行のhintはnull。過去SQLは未変更。配備時に未適用マイグレーションを適用する。
- apps/cloudの依存導入後、ルートで `node --test tests/cloud-issue1.test.mjs tests/camera.test.mjs tests/camera-app.test.mjs tests/pass-events.test.mjs`。今回32件成功。
- apps/cloudでTypeScriptチェックとSites公式buildを実施済み。ローカルビルド後、ルートで `node --import ./apps/cloud/scripts/sites-env.mjs <このリポジトリの絶対パス>/scripts/verify-cloud-issue1.mjs`。最初にローカルへ移動する環境読込があるため、mainスクリプトは絶対パスを使う。
- 検証スクリプトはビルド済みWorker・一時的なローカルD1/R2に限定し、公開Sitesには接続しない。OpenAIキーを渡さずdemoモードを確認し、100人参加・100枚JPEG・順位反映・100回ヒントを試す。ログ/生成レポートにトークンを出さない。
- 最新ローカル検証（2026-10-18T06:41:59Z）：100人全員500点、100件の合格通知、429/5xxなし。写真受付P95約2586ms、送信開始から全結果取得約3943ms。64×64のJPEGであり、大きな写真・会場回線・実AI・100台の実ブラウザを検証した結果ではない。

未完了：再配備、本番DB移行、公開Sites上の100ブラウザ相当試験、実AI性能、スマホ実機、Plugin接続、独立AI APIからのお題登録。Issueの公開環境の完了条件はまだ満たしていない。実装検証後のユーザー指示で `sagasa` ブランチへローカルコミットする。プッシュ・Issueコメント/closeは行わない。

## PR #2の統合レビュー追記（2026-10-18）

後続のユーザー指示により、最新mainとの競合解消・レビュー・マージを実施する。上記「プッシュしない」は元の実装時点の指示記録であり、この追加作業には適用しない。mainの実AI設定とPlugin接続ソースは保持し、追加状態フィールドを既存応答へ併記する。

最終競技はDBのstatus更新を待たず、期限を過ぎた時点で新規joinを409にする。統合後はルート47テストとCloud9テスト、TypeScript、構文チェック、Workersビルド、ローカル100人・100JPEG受付/500点/通知/ヒントの確認が成功した。公開SitesのコードとDBは更新していないため、公開環境で本契約が有効になったという意味ではない。詳細はADR-0013の統合レビュー記録を参照。
