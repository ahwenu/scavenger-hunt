# データモデル・バックエンド処理

主担当はさが さん。DB/R2、ゲームルール、認可、加点・順位確定を実装する。HTTP受付・外部AI呼出・APIレスポンス化はAhwenuが担当し、本書のサービスを呼び出す。写真判定フローのうち外部AI通信はAhwenu、受付制限と保存・判定結果の確定はさが さんが受け持つ。

## D1のテーブル案

| テーブル | 主な列 | 制約・用途 |
| --- | --- | --- |
| rooms | id、code、status、version、currentRoundId、expiresAt | code一意。ホストの部屋操作単位 |
| host_credentials | roomId、tokenHash、expiresAt、revokedAt | 生トークンはDB保存しない |
| teams | id、roomId、name、joinedAt、lastSeenAt | UNIQUE(roomId, name)、ロビー参加上限 |
| participant_sessions | tokenHash、teamId、expiresAt | 部屋を越える権限を付けない |
| rounds | id、roomId、number、status、topicId、startsAt、deadlineAt、settleUntil | UNIQUE(roomId, number) |
| topics | id、roomId、title、instruction、criteriaJson、source、promptVersion | 生成時に検証し、開始後は変更不可 |
| submissions | id、roundId、teamId、status、outcome、reasonCode、imageKey、acceptedAt、processingExpiresAt、completedAt | 同一チーム・ラウンドでqueued/judgingは最大1件 |
| score_events | id、roundId、teamId、submissionId、points、createdAt | UNIQUE(roundId, teamId)、points=10 |
| idempotency_records | actorScope、route、key、requestHash、resourceId、responseJson、expiresAt | UNIQUE(actorScope, route, key) |

外部キー・関連IDの部屋一致をサーバーで検証する。D1の対応範囲内で一意制約・条件付き更新・原子的batchを使い、read→writeだけで競合回避したことにしない。ラウンド進行はversionを条件にした更新で1回だけ成功させる。スキーマ変更はSQLマイグレーションとして保存する。

## 状態遷移

部屋：`lobby → playing → finished`。問題：`pending → active → closing → result`。最後のresultからホストの終了操作でfinishedにする。ホストの途中終了は任意の状態からfinishedにできる。

- `start`：最低1チーム・検証済み3問が必要。第1問の `startsAt` をサーバー現在時刻、締切を120秒後、settleUntilを締切30秒後にする。
- `closing`：締切以後、新規提出不可。受付済み処理だけ確定可能。
- `result`：settleUntil以後に確定。期限切れ提出はfailedへ変え、全員の順位を取得できる。
- `advance`：resultのみ。最終問なら進めず、終了操作を案内する。
- `finish`：未確定の提出をGAME_FINISHEDで失敗確定し、以後のAI結果を無視する。途中終了でも確定済み得点は保持する。

ポーリングと各操作の冒頭で時刻に基づく状態整合を実施する。アクセスがない間にDBの表示上の状態が古くても、次のリクエストで必ず締切を適用する。ブラウザのタイマーイベントに進行の正しさを依存させない。

## 写真判定と加点の整合性

1. 参加者認証、部屋・ラウンド一致、JPEG実データとサイズ・寸法を確認する。
2. サーバー時刻で締切・部屋状態・残回数を確認する。冪等キー登録、受付記録、同時提出枠の取得を競合に強い方法で行う。
3. R2に保存してjudgingにし、写真をサーバーからAIへ渡す。R2失敗時も枠を解放してfailedにする。
4. 判定返却時に、提出の未確定状態・処理期限・ゲーム終了状態を再確認する。
5. passならscore_eventsを一意制約付きで作成する。提出確定と加点を原子的に反映し、既存加点なら新しい10点を作らない。
6. fail/uncertainは0点。AI通信失敗・拒否・形式不正・期限切れはfailedで0点。処理失敗と写真不合格を区別する。
7. 得点と順位はscore_eventsから集計する。SubmissionのawardedPointsも実際の加点記録から算出する。

部屋のversionは、参加・お題準備・問題進行・提出状態・得点などスナップショットの意味が変わる更新ごとに単調増加させる。lastSeenAtだけの更新は対象外とする。

## R2と保存期間

キー案：`rooms/{roomId}/rounds/{roundId}/{submissionId}.jpg`。バケットは非公開とし、画像取得APIで本人/ホスト認可を確認する。OpenAIに渡すためのパブリック公開は不要。

送信時は2 MiB以下のJPEG、長辺1280px以下、デコード後のピクセル数上限も検証する。Content-Typeの申告だけを信じない。画像変換・検証ライブラリのWorkers適合性は技術検証で確定する。クライアントのCanvas変換ではEXIFを引き継がない設計とするが、直接API提出も想定し、サーバーでメタデータを検査・除去できない場合の拒否方針を決める。

保持期間案は部屋作成から24時間。画像APIは期限後にアクセス拒否する。実ファイルの物理削除はR2ライフサイクルがSitesで設定可能か検証し、利用できなければ配備者の期限切れ削除コマンド/APIで実施する。ホストの終了後削除も提供する。自動削除を実装・検証するまで自動削除済みとは表示しない。

APIキー・写真のbase64・トークンをログに出さない。部屋ID、提出ID、処理時間、失敗コード、モデル/プロンプトバージョンを記録し、撮影前に写真が外部AIへ送られることと保持期間を画面で説明する。
