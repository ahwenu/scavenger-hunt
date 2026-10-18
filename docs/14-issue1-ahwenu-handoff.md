# Issue #1：AhwenuのAPI・Plugin・公開版受け渡し

対象：[Issue #1](https://github.com/ahwenu/scavenger-hunt/issues/1)、[API担当への5項目](https://github.com/ahwenu/scavenger-hunt/issues/1#issuecomment-6246770810)。ゲーム・DBを担当したさが さんの[受け渡し契約](12-issue1-backend-handoff.md)と[ADR-0013](adr/0013-issue1-player-game-contract.md)を基に、HTTP/API・MCP・公開環境の対応を記録する。

5項目の実装・配備とファイルでの受け渡しを完了した。デモでの500点/10競技終了と、実AIの条件不一致による不合格0点は確認済み。**実AIの合格500点、実端末100台、ネイティブ拡張パネルの直接操作は未検証**。Issueを閉じる操作やコメント送信は行っていない。

## 5項目の進捗

| 依頼 | 現在の対応 | 完了の確認 |
| --- | --- | --- |
| 1 最新mainとの統合 | PR #2を競合解消・レビューしmainへ統合（`1278769`）。Responses標準生成、キー設定時AIモード、参考写真オプションと新ゲーム契約を併存 | ルート47件・Cloud9件・Plugin27件、型チェック、ビルド成功。main `669731c` をcommit/push済み |
| 2 SitesHostAdapter/MCPの新契約 | 確定score/rank・全10競技・finishedと終了後の操作停止に対応。サーバーの全10stagesを非操作一覧へ表示 | 0.3.1をインストール済み。公式ブリッジの検証ホストで10競技一覧・ヒント欄・QR・API利用可能を表示確認。ネイティブパネル直接操作とは区別 |
| 3 共通ヒント登録経路 | `host_set_hint` と運動会UIの保存/削除を追加。MCPの部屋Cookieから `POST host/hint` へ接続し、閲覧時のAI生成は行わない | 公開ヒント保存と参加者取得、同じ文の100回GETを確認。追加AI生成なし |
| 4 公開版への適用・結合 | v3/0003適用、公開100人デモと補完1人10競技を実行。実Responses生成・ヒント・実写真の不合格0点/順位/再送/受付終了も確認 | 実装/配備と下記検証を完了。実AIの合格500点は未検証。100人試験の終盤transport失敗を保持し、補完結果と分けて記録 |
| 5 mae さんへ確定応答と配備版 | 下記API例、v3配備ID/ソース、公開実測と失敗/未検証範囲をファイルで共有 | 本書を最終受け渡しとする。Issueコメントは送信していない |

さが さん：ゲーム/DB・加点・順位・締切・保存。Ahwenu：統合・HTTP/MCP・ヒント登録・配備/結合。mae さん：サーバー確定値に基づく参加者画面。元PRの検証記録を本書の公開成功へ読み替えない。

## 現在のソースと公開版の違い

| 対象 | 契約・確認範囲 |
| --- | --- |
| PR #2統合後のソース | 100人・10競技・初合格500点・連番順位・保存済みヒント・0003マイグレーション |
| この作業開始時の公開v2 | 旧版の勝利数順位・ラウンド単位の進行。Issue #1の追加契約はこの時点では未配備 |
| 今回のv3とplugin 0.3.1 | 新契約を配備・インストール済み。公開デモ500点/finished、共通ヒント、実AIの不合格0点経路を確認。実AIの合格加点は未検証 |
| ローカル独立 `api/` | `/api/v1/ai/...`、`{data,serverTime}` のAI確認サービス。今回のSitesゲーム契約とは別。公開接続を新たに必須化しない |

公開先は `https://karimono-one-lease.ahwenu.chatgpt.site`。publicアクセスと、参加者Bearer/ホストCookieの認可は別。キー、Cookie、トークンは応答例・画像・コメントへ載せない。

## mae さんが使う確定HTTP契約

ベースパスは `/api/rooms/:id`、JSONは**直下形式**、時刻はUnixミリ秒、GETはno-store。初期仕様04の `/api/v1` やCookie参加者案へ切り替えない。

| 操作 | 入力 | 応答・扱い |
| --- | --- | --- |
| 参加 | `POST .../join`、JSON `{name}` | 201 `{id,token}`。同一QR/部屋で全員プレイヤー、最大100人、満員/終了409 |
| 状態 | `GET .../state`、部屋別参加者Bearer | `room/serverTime/round/mine/ranks/stats` 等を維持し、`game`、全10件の `stages`、確定score/rank/awardedPointsを追加 |
| 写真 | `POST .../submit`、Bearer、multipart `roundId/requestId/photo` | 1MiB以下。202 `{id,status:"queued",queued:true,receivedAt}`。stateで本人結果を確認 |
| 再送 | 同じ参加者・requestId | 同じ提出ID。処理中202、確定後200と `duplicate:true`。新規提出/加点にしない |
| 共通ヒント | `GET .../hint?roundId=...`、Bearer | 200 `{roundId,text,available}`。未用意はnull/false、未来/終了競技409。閲覧では生成しない |

失敗・締切・他競技・参加前競技・試行上限等の詳細と全既存フィールドは[バックエンド受け渡し](12-issue1-backend-handoff.md)を参照。追加型は[game-contract.ts](../apps/cloud/lib/game-contract.ts)。`mine` は本人の提出だけを表示し、他プレイヤーの提出結果を流用しない。

### 状態の説明用サンプル

以下は実ユーザーの記録ではなく、新規/主要項目の説明用抜粋。実際の応答には従来フィールドと部屋全員の順位を含む。

```json
{
  "room": {"id":"room-example","name":"カリモノ"},
  "serverTime":1792300000000,
  "game":{"status":"playing","totalRounds":10},
  "round":{"id":"r3","number":3,"status":"active","challenge":{"title":"赤いペンを探そう","description":"実物を撮影してください","criteria":["ペンが写っている","赤い部分がある"],"durationSeconds":120},"endsAt":1792300030000},
  "stages":[
    {"number":1,"status":"completed"},{"number":2,"status":"completed"},
    {"number":3,"status":"active"},{"number":4,"status":"locked"},
    {"number":5,"status":"locked"},{"number":6,"status":"locked"},
    {"number":7,"status":"locked"},{"number":8,"status":"locked"},
    {"number":9,"status":"locked"},{"number":10,"status":"locked"}
  ],
  "mine":[{"id":"s3","roundId":"r3","status":"accepted","awardedPoints":500,"verdict":{"pass":true,"reason":"条件に合っています"}}],
  "ranks":[
    {"id":"p1","name":"まえ","wins":1,"score":500,"rank":1,"totalMs":1200},
    {"id":"p2","name":"参加者2","wins":0,"score":0,"rank":2,"totalMs":0}
  ],
  "stats":{"players":2,"answered":1,"accepted":1,"pending":0}
}
```

- 開始前は `game.status=lobby`、`round=null`、全10ステージlocked。
- 競技間は `playing` と直前のclosedラウンドを保持する。「次のお題へ」は次競技の開始権限ではなく、ホストが開始した状態へ移る導線。
- 受付済み判定が残る最終競技はplaying。10競技目の受付終了と全判定確定後にfinished、全ステージcompleted。11競技目は作らない。
- 画面は `score`、`rank`、`awardedPoints`、`stages` をそのまま使う。`wins*500` や配列順から順位/解放を計算しない。
- 合格の最初の確定だけ500点、rejected/errorは0点。順位は得点降順→累計受付時間→参加時刻→IDの連番。
- ヒント未用意の例は `{"roundId":"r3","text":null,"available":false}`。用意済みはtextとavailable:trueを表示する。

## Plugin Extensionsとホストの受け渡し

参加者のstateは全10ステージを返す。Plugin側は新契約の確定得点/順位・現在問/全10問・finishedを反映し、旧公開版との互換用wins表示と区別する。ホストのCookieはMCPサーバー内だけに保持する。MCPのプロセス内操作ID/versionを、Cloudの永続冪等性/CASの保証として扱わない。

共通ヒントはホストが現在の受付中競技へ一度保存し、全参加者へ同じ文を返す。AI生成を100回のGETへ分散させない。追加したUI限定ツールは `host_set_hint`、入力は `{roomId,roundId,text,expectedVersion,operationId}`、返却はHostState。textは1〜500文字、nullで削除する。11ツール構成となる。

運動会UIの競技進行欄に共通ヒントのtextarea・保存・削除を置き、現在の受付中競技以外は無効化する。`sites.canSetHint` を操作可否に使い、`currentRound.hint` はMCPが保存成功で確認した値だけを返す（省略は未取得、nullは削除済み）。別競技・終了/期限・参加者権限・二重操作を拒否するテストを追加した。

全10ステージはサーバー値を `snapshot.sites.stages` として通し、未解放/進行中/完了の非操作一覧へ表示する。未来のお題など未知フィールドは通さず、旧Sitesでstagesがなければ一覧を表示しない。finished時に全completedとなるケースもモックで確認した。

## 検証・配備記録

PR統合時のローカル100人デモ・500点・順位・ヒントの記録は、元の受け渡しとADR-0013に残す。今回の公開試験は別記録にする。初期復旧ではローカルAI接続設定を回復し、インストール済みUIで「文房具のクリップを探そう」の生成表示を確認した。最初の一時的な生成失敗と最終成功を区別し、これは公開Sitesの500点/10競技試験の代わりにしない。

### v3の配備・ソース（2026-10-18 16:08 JST）

- 元リポジトリmainは `669731c6715a59a6236eae29e323d2977816a7d0` をahwenu名義でcommit/push済み。
- SiteのソースSHA：`df6813631353211b2ff52d1a89df22dd36b951f1`。
- version：`appgprj_6ad4611142408191ae99be09e3b27efb~appgver_bc7c0dbeeef88191857c824951236574`。
- deployment：`appgdep_6ad4705c8e088191a7709d630c552030`、succeeded。public・実行環境revision 1を維持。
- D1/R2と `0003_issue1_round_hint` を適用。秘密除外済み621ファイルのスナップショットを保持。
- Plugin 0.3.1をインストールし、11ツールの通常/共有配布物の可搬性を確認。ローカルAI接続の設定参照も引き継ぐ。
- 依存導入後にルート47件・Cloud9件・Plugin27件、型チェック・ビルドが成功。

### 公開100クライアント相当のデモ試験

独立HTTPクライアント100人・concurrency 16、64×64 JPEG100枚（合計290,648 bytes）を使った。実AI、100台の実ブラウザ、最大1MiB画像、会場回線の試験ではない。

| 項目 | 結果 |
| --- | --- |
| 参加 | 100件すべて201、101人目409 |
| 第1競技の写真受付/判定 | 100件すべて202、デモ判定100合格・各500点 |
| 結果分離/通知 | 各Bearerの本人mineを分離し、distinctな `mine.passEventId` 100件を確認。stateのevents配列は直近40件の窓 |
| 共通ヒント | 同じ保存済み文のGET100回成功 |
| HTTP 429/5xx | 0件/0件 |
| P95 | join 293.74ms、state 339.48ms、submit 925.98ms、本人結果取得157.9ms |
| 完了時間 | 第1競技の全判定5.433秒、全本人結果6.132秒 |

2〜10競技は各競技1人の合格を確認する流れで実行し、100人×10競技の写真負荷試験とは区別した。第2競技で不合格0点→再提出500点、同requestIdの同じ受付IDも確認。第10競技のホスト受付終了直前にtransport失敗が1件あり、元のレポートは `success:false` を保持した。その後の同部屋GET（2026-10-18 16:11 JST）で自然締切後のfinished・全stage completed・首位5000点/10クリアを確認した。

補完の別1人デモ試験では、10競技すべてを正規のホスト開始/終了で進め、finished・5000点・11競技目409を確認。`success:true`、36.012秒、transport/429/5xxは0件。不合格0→再提出500、再送の同受付ID、終了後409、認可401/403も確認した。

レポートはGit対象外の `plugin/artifacts/issue1-public-http-verification.json` と `issue1-public-ten-round-verification.json`。再現は `node scripts/verify-public-issue1.mjs --run`、補完は `--run --players=1`。デモでのゲーム操作を伴う明示実行用で、通常の単体テストから自動実行しない。

### 実AIとインストール済みUIの確認

最終試験では実Responsesのお題「紙コップを探そう」（紙コップ、白/淡色の条件）へ赤い実物の紙コップ写真を提出し、実Decisionsでrejected/0点、MCPでscore 0・順位1を確認した。同じrequestIdの再送は同じ提出IDとduplicateを返し、共通ヒントの保存/削除と現在ラウンドの受付終了も成功した。

使用写真はWilfredorの[Hands holding a cup of coffee, Quebec City](https://commons.wikimedia.org/wiki/File:Hands_holding_a_cup_of_coffee,_Quebec_City.jpg)、CC0。縮小/JPEG変換のみで、色を条件へ合わせる加工は行っていない。生成条件と写真の色は一致しないため、この結果を実AIの陽性加点確認には使わない。

最終レポートはGit対象外の `plugin/artifacts/issue1-public-real-ai-final-negative.json`、`positiveScoringVerified:false`。**実AIで合格して500点になる経路は未確認**と確定し、条件が合うまで有料のお題生成を繰り返す試験は行わなかった。前の写真確認待機で受付期限を超えて409となった試行も失敗として残し、アプリ不具合とは断定しない。公開デモでの500点確認と、実AIの陰性経路の確認を分ける。

インストール済み0.3.1のHTMLを公式AppBridgeのsandbox検証ホストで表示し、QR・全10競技・ヒント欄・API利用可能を確認。新部屋の参加者0人・10ステージlocked・ポイント表示も確認した。画像 `plugin/artifacts/issue1-host-stages-hint-0.3.1.png`（Git対象外）をmacOS Visionで読取り、QRと画面の参加URLの完全一致を確認した。公開設定も再取得してpublicのv3を確認。ネイティブ拡張パネルの直接操作・実機100台は未実施。最新の保存ソースと最終配備IDはSitesのバージョン履歴を参照し、本書に記録したv3の検証と区別する。
