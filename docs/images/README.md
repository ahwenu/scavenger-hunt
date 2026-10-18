# README掲載画像の取得記録

取得日：2026-10-18。READMEには公開ゲームの一連操作と、判定基準の修正を反映したSites v8の画面を掲載する。参加者はスマホ幅のブラウザ、ホストは実Plugin Extensions 0.4.1のパネルで取得し、JPEGで保存した。

| ファイル | 取得元・表示条件 | 画面の状態 |
| --- | --- | --- |
| [public-e2e/criteria-fixed.jpg](public-e2e/criteria-fixed.jpg) | 公開Sites v8、390×844、全ページ | 第2問「付箋を探そう」。判定基準2件と実物写真の注意文、撮影操作を表示 |
| [public-e2e/participant-accepted.jpg](public-e2e/participant-accepted.jpg) | 公開Sitesの同じ部屋、390×844 | 実物の紙コップ写真を提出し、実AI合格で500点・1位 |
| [public-e2e/participant-ranking.jpg](public-e2e/participant-ranking.jpg) | 同じ参加者ブラウザ | 公開E2E確認Aの500点・1位 |
| [public-e2e/plugin-ranking.jpg](public-e2e/plugin-ranking.jpg) | インストール済み実Plugin Extensions 0.4.1の順位タブ | 同じ部屋・参加者の500点・1位が自動反映 |

参加者画像は実機スマホのカメラ撮影ではない。既存の実物写真を選択して提出し、実AIの判定と加点を確認した。写真の出典・確認操作・公開反映の詳細は[17 公開ゲームの一連確認](../17-public-game-e2e.md)へ記載する。認証情報や秘密設定は画像に含めていない。

## 旧画像の取得記録

以下はREADME差し替え前の記録として保持する。

| ファイル | 取得元・表示条件 | 画面の状態 |
| --- | --- | --- |
| [mobile-join.jpg](mobile-join.jpg) | `https://karimono-one-lease.ahwenu.chatgpt.site/rooms/:id/join` の実部屋の参加ページ。表示領域390×844、表示領域内のみを取得 | 猫耳キャラクターとロボットを配したReact / TypeScriptの参加前画面。ニックネーム入力のみで、参加者0人。参加登録・カメラ撮影は行っていない |
| [plugin-host.jpg](plugin-host.jpg) | `plugin/` 0.4.1をビルドし、既存のブラウザプレビューを `KARIMONO_MODE=sites` で起動。1280×720の表示領域で取得 | 公開SitesへMCP経由で部屋を作成。参加QR、進行操作、参加者0人のランキングを表示 |

スマホ向け画像は、公開Sitesに反映した `apps/cloud/app/participant/` の画面をスマホ幅で表示したもの。スマホ実機での撮影ではない。ホスト向け画像はPlugin Extensions用UIのブラウザプレビューで、ネイティブ拡張パネルの直接取得ではない。

この取得では、お題生成・写真判定のAI呼び出し、参加登録、写真の投稿、競技開始は行っていない。ホスト認証Cookieや秘密設定は画像に含めていない。掲載QRは取得時に作成した部屋を指すため、新しいゲームではホストから発行したQRを使う。
