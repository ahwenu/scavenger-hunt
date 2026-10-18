# Issue #1：AhwenuのAPI・Plugin・公開版受け渡し

対象：[Issue #1](https://github.com/ahwenu/scavenger-hunt/issues/1)、[API担当への5項目](https://github.com/ahwenu/scavenger-hunt/issues/1#issuecomment-6246770810)。ゲーム・DBを担当したさが さんの[受け渡し契約](12-issue1-backend-handoff.md)と[ADR-0013](adr/0013-issue1-player-game-contract.md)を基に、HTTP/API・MCP・公開環境の対応を記録する。

## 5項目の進捗

| 依頼 | 現在の対応 | 完了の確認 |
| --- | --- | --- |
| 1 最新mainとの統合 | PR #2を競合解消・レビューしmainへ統合（`1278769`）。Responses標準生成、キー設定時AIモード、参考写真オプションと新ゲーム契約を併存 | 統合時のルート47件・Cloud9件、型チェック、Workersビルド、ローカル100人デモ検証は成功。今回の追加変更の最終チェックは別途記録 |
| 2 SitesHostAdapter/MCPの新契約 | `game.status/totalRounds` と `ranks[].score/rank` を優先し、確定500点・全10競技・finishedへ対応。終了後の準備/次問を停止 | 実装と追加3件を含む24件のテストを確認。公開版との最終結合は結果待ち |
| 3 共通ヒント登録経路 | `host_set_hint` と運動会UIの保存/削除を追加。MCPの部屋Cookieから `POST host/hint` へ接続し、閲覧時のAI生成は行わない | ヒント追加後の27件・型チェック成功。ビルド/公開保存/参加者取得は結果待ち |
| 4 公開版への適用・結合 | 既存の公開Sitesへ0003マイグレーションとWorkerを適用し、公開100クライアント相当のデモ試験と実AI試験を分けて実施予定 | v3配備・本番DB移行・100クライアント・実500点/10競技finishedは結果待ち |
| 5 mae さんへ確定応答と配備版 | 下記のAPIと例を受け渡す。公開URLは同じ。最終の配備ID・ソース・検証結果を本書へ追記する | ファイルでの契約共有を先行。公開版の最終番号/実測は結果待ち。Issueコメントは送信していない |

さが さん：ゲーム/DB・加点・順位・締切・保存。Ahwenu：統合・HTTP/MCP・ヒント登録・配備/結合。mae さん：サーバー確定値に基づく参加者画面。元PRの検証記録を本書の公開成功へ読み替えない。

## 現在のソースと公開版の違い

| 対象 | 契約・確認範囲 |
| --- | --- |
| PR #2統合後のソース | 100人・10競技・初合格500点・連番順位・保存済みヒント・0003マイグレーション |
| この作業開始時の公開v2 | 旧版の勝利数順位・ラウンド単位の進行。Issue #1の追加契約はこの時点では未配備 |
| 今回のv3とplugin 0.3.1 | 新契約を適用する対象。配備/実結合の結果を確認してから完了へ更新 |
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

運動会UIの競技進行欄に共通ヒントのtextarea・保存・削除を置き、現在の受付中競技以外は無効化する。`sites.canSetHint` を操作可否に使い、`currentRound.hint` はMCPが保存成功で確認した値だけを返す（省略は未取得、nullは削除済み）。別競技・終了/期限・参加者権限・二重操作を拒否するテストを追加した。全10ステージをホストへそのまま渡す一覧は追加作業中で、公開確認は結果待ち。

## 検証・配備記録

PR統合時のローカル100人デモ・500点・順位・ヒントの記録は、元の受け渡しとADR-0013に残す。今回の公開試験は別記録にする。初期復旧ではローカルAI接続設定を回復し、インストール済みUIで「文房具のクリップを探そう」の生成表示を確認した。最初の一時的な生成失敗と最終成功を区別し、これは公開Sitesの500点/10競技試験の代わりにしない。

現在の結果待ち：公開v3の配備ID/ソース・0003適用、公開100クライアント相当のデモ成功件数/429/5xx/遅延、実AI提出と500点/順位、次競技/10競技終了、ヒント保存/全員取得、更新済みpluginインストール、今回のcommit/push。実機100台やネイティブ拡張パネルの直接操作を実施済みとは扱わない。

公開試験の計画は、concurrency 16の独立HTTPクライアント100人、64×64 JPEG100枚のデモ第1競技、100回の共有ヒント取得と本人結果分離を対象とする。2〜10競技は各競技1人の合格でfinishedを確認する予定で、100人×10競技の負荷試験とは扱わない。実施後の件数・遅延を追記する。
