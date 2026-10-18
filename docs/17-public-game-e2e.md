# 公開ゲームの一連確認（2026-10-18）

対象：`https://karimono-one-lease.ahwenu.chatgpt.site/`。ホストはインストール済みPlugin Extensions 0.4.1の実パネル、参加者は390×844のブラウザ表示を使用した。スマホ実機のカメラ撮影とは区別する。

## 確認した流れ

1. 実拡張の「新しい部屋を作る」で確認用部屋 `2b5254d15b084801b015f0bda31fbe08` を作成し、招待QRと `/rooms/:id/join` の参加URLを表示。
2. そのURLを開き、参加者「公開E2E確認A」を画面から登録。参加者画面と実拡張の両方で1人を確認。
3. ゲーム用AIの準備完了後、実拡張から開始。Responses APIのお題「カラフルな紙コップを探そう」を公開状態APIと画面で確認。
4. 写真選択から実物の赤い紙コップ写真を選び、プレビュー後に「写真を送る」を実行。写真はブラウザの通常のJPEG変換を通し、条件に合わせる色変更や画像生成は行っていない。
5. 「AIが判定中」から「CLEAR!!・+500pt・1位・1/10」へ進み、実拡張にも同じ参加者の500ptが自動反映。
6. 参加者のランキングで500pt・1位、実拡張の順位タブで500pt・1位が一致。参加ページ再読み込み後もクリア画面と500点が復帰した。

部屋はAIモードで、お題の `provider` は `Responses API`。写真判定は公開サーバーのDecisions API経路で実行され、固定の合格応答へ切り替えていない。判定基準は「対象は飲み物を入れる紙コップである」「紙コップの側面に色や模様が見える」。実AIの合格加点と両画面への順位反映を今回の一連操作で確認した。

![参加者の合格500点](images/public-e2e/participant-accepted.jpg)

![実Plugin Extensionsの順位と500点](images/public-e2e/plugin-ranking.jpg)

## 発見した不具合と修正

React参加者画面はお題のタイトル・説明だけを表示し、AIが必須判定に使う `challenge.criteria` を表示していなかった。上記の2条件は公開APIにはあるが、写真提出画面には出ていないことを確認した。

`ParticipantGame.tsx` と `participant.css` で、サーバーの判定基準全件と「条件に合う実物を撮影してください。画面や印刷された写真は使えません。」をお題カード内へ追加した。採点・API・DBは変更していない。最新mainの事前招待用の待機表示を保持して取り込んだ。

修正はJSX構文検査、React静的描画（基準・注意文・欠落データ・HTMLエスケープ）、TypeScript noEmit、Cloud9テスト、差分チェックを通過。GitHub mainへ `d195b6e` をcommit/pushした。

## 修正の公開反映と再確認

2026-10-18 17:34 JSTにSites v8の公開配備が成功した。並行作業で公開されたv7（ソース `2ff06b7d198d0057f7e2204dcac1022793d11134`）を開き直し、実行ルートの参加者UI2ファイルだけへ修正を適用。v7のD1/R2・0004マイグレーション・事前招待/手動開始・APIを保持した。公式ヘルパーで型チェック・Cloud9件・本番ビルドが成功し、対応するソースのpushと配布物の保存後に配備した。

- Sitesソース：`2e1c492cd5da161088cae26940ecbaf46c1ea0a2`
- version：`appgprj_6ad4611142408191ae99be09e3b27efb~appgver_1b75a8ccfaec8191adf04d17a7abfd45`（v8）
- deployment：`appgdep_6ad484818c5081919b9cd1f91f757615`、`succeeded`、実行環境revision 1

公開参加ページを再読み込みし、実拡張の「AIで次のお題へ」から第2問「付箋を探そう」を開始した。参加者画面で「対象は紙製の付箋である」「付箋は四角い形が見える」の2件と注意文を確認。参加人数1人・前問の500点と1位が引き継がれ、390×844と320×568の両方で横はみ出しはなかった。写真選択とカメラのボタンを表示し、縦スクロールでヒントへ進める。第2問の写真提出は行っていない。

![公開v8の判定基準と撮影操作](images/public-e2e/criteria-fixed.jpg)

## 写真の出典と範囲

- 写真：[Hands holding a cup of coffee, Quebec City](https://commons.wikimedia.org/wiki/File:Hands_holding_a_cup_of_coffee,_Quebec_City.jpg)
- 撮影者：Wilfredor、ライセンス：[CC0](https://creativecommons.org/publicdomain/zero/1.0/)。既存の `plugin/artifacts/red-paper-cup.jpg` を使用。
- 公開済みの実物写真を写真選択で提出した確認であり、会場で撮影したこと、実機カメラ、判定精度全般、100実端末の性能を検証したものではない。
- 参加者の認証情報、ホストCookie、OpenAIキーは画像・本文・Gitへ含めていない。
