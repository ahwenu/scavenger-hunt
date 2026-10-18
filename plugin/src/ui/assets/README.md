# ホスト画面の運動会素材

元資料：`docs/design/sports-day-ui-assets-v1/`（提供済み素材集）。元画素を変更せず、使用する8点のみをこの独立pluginへ同梱しています。

- `girl-flag.png` / `robot-flag.png` / `robot-judging.png` / `girl-cheer.png`：`09-aligned-sprites/`。320×320または160×160の原寸以下で配置。
- `bunting.png` / `trophy.png` / `crown.png` / `flag-blue.png`：`04-decorations/`。原寸以下の装飾。

PNGはビルド時にdata URLとしてHTMLへ埋め込みます。親フォルダや外部画像サーバーへの実行時参照はありません。お題・順位・名前・得点・時間・ボタン文字は画像にせずHTMLで描画します。QRは別の白黒SVGとして表示し、素材を重ねません。
