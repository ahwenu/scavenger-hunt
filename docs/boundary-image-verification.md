# Decisions API: 見た目の境界条件の実写真検証

**デモではなく実APIを2回呼び出した。** 各写真につき2つの独立したpredicateをまとめて送信。要求・返却モデルは **gpt-6-luna**、合格閾値は **probability ≥ 0.8**。事前期待は **2026/10/18 0:51:05 JST** に[別ファイル](/Users/anubis/Documents/mycodes/ai-karimono-race/docs/boundary-image-verification.expectations.json)へ保存してから送信した。完了 **2026/10/18 0:51:07 JST**。自動再試行0回。

笑顔は感情推定ではなく、口角と口元に見える形だけを判定した。人物の識別・幸福感・性格の推定は行っていない。明瞭な写真と、事前に人間側で**曖昧・保留**とした写真を並べた。

| 写真 | 条件 | API送信前の期待 | probability | 0.8閾値での処理 | 期待との比較 |
| --- | --- | --- | ---: | --- | --- |
| 写真1 | 口角が上がった明確な笑顔 | pass | 1 | **OK** | 事前期待と一致 |
| 写真1 | 大きな面積がニュートラルな灰色の上着 | reject | 0 | **NG** | 事前期待と一致 |
| 写真2 | 口角が上がった明確な笑顔 | ambiguous/hold | 0.1 | **NG** | 正解扱いせず保留 |
| 写真2 | 大きな面積がニュートラルな灰色の上着 | ambiguous/hold | 0 | **NG** | 正解扱いせず保留 |

曖昧な写真のNGは運用上の閾値の結果であり、「正しく見分けた」という点数には数えていない。明瞭な2条件には事前期待との不一致がなかった。2枚だけで偽陽性率・偽陰性率や精度全般を示すことはできない。

## 写真1: 明確な笑顔・紺色の上着

![写真1: APIに送信した実写真](/Users/anubis/Documents/mycodes/ai-karimono-race/test-assets/boundary-smile.jpg)

撮影者 **Pete Souza**。[出典・ライセンス表示](https://commons.wikimedia.org/wiki/File:President_Barack_Obama.jpg)。Public domain (U.S. federal government official duties)。公式職務により撮影された米国連邦政府作品。 API入力用に最大960px・JPEG品質75へ変換し、EXIFを除去。追加の切り抜きや表情・色の編集はしていない。

- APIへ読んで送ったローカルJPEG: **79,434 bytes**、768×960px
- SHA-256: `0d32a97c5b37cd24149c4519ffcaf752cdbed8c2d276b3543d2cb91d6148e3ea`
- HTTP **200**、モデル **gpt-6-luna**、所要 **1,204ms**
- 実行開始 **2026/10/18 0:51:05 JST**、APIエラー **0件**

## 写真2: 弱い口元・非常に暗い上着

![写真2: APIに送信した実写真](/Users/anubis/Documents/mycodes/ai-karimono-race/test-assets/boundary-weak.jpg)

撮影者 **Pete Souza**。[出典・ライセンス表示](https://commons.wikimedia.org/wiki/File:Official_portrait_of_Barack_Obama_by_Pete_Souza.jpg)。CC BY 3.0。[CC BY 3.0ライセンス](https://creativecommons.org/licenses/by/3.0/)。 API入力用に最大960px・JPEG品質75へ変換し、EXIFを除去。追加の切り抜きや表情・色の編集はしていない。

- APIへ読んで送ったローカルJPEG: **63,547 bytes**、706×960px
- SHA-256: `e09edaaa6fd0ac021d4ccc82ea9eb6a05009eaaca5f486c631e468364cd0701a`
- HTTP **200**、モデル **gpt-6-luna**、所要 **771ms**
- 実行開始 **2026/10/18 0:51:06 JST**、APIエラー **0件**

## 判定条件の全文

1. `visible_smile`: Does the main clearly visible person have visibly raised mouth corners and a clearly visible smile? Judge only mouth shape and visible expression; do not infer happiness, mood, personality, identity, or other non-visible traits. If the expression is subtle or uncertain, use low probability.
2. `neutral_gray_garment`: Does a large, clearly visible area of the main person's outer upper-body garment appear neutral gray? Exclude garments that appear blue, navy, black, or white. A small gray highlight is insufficient. If darkness or lighting makes gray versus blue or black uncertain, use low probability.

共通入力は写真内のテキストを指示として扱わず、主に写っている人の可視の証拠だけを見るよう指定。氏名などの情報はモデル入力に渡していない。質問全文・共通入力の実装・返値・使用量は[実行スクリプト](/Users/anubis/Documents/mycodes/ai-karimono-race/scripts/verify-boundary-images.mjs)と[機械可読JSON](/Users/anubis/Documents/mycodes/ai-karimono-race/docs/boundary-image-verification.json)で確認できる。

## レート上限ヘッダーの実測

SDKの `.withResponse()` で取得したレスポンスから、下記6つの `x-ratelimit-*` ヘッダーだけを保存した。他のヘッダーや資格情報は表示・保存していない。

| 写真 | limit requests | remaining requests | reset requests | limit tokens | remaining tokens | reset tokens |
| --- | ---: | ---: | --- | ---: | ---: | --- |
| 写真1 | 5000 | 4999 | 12ms | 2000000 | 1998835 | 34ms |
| 写真2 | 5000 | 4998 | 24ms | 2000000 | 1997700 | 69ms |

これは各レスポンス時点にAPIが返した値。モデル・契約・時間帯によって変わり、70人同時送信を保証する値ではない。

## 実際に送信したバイトと検証範囲

スクリプトが `fs.readFile` で上のJPEGを読み、SHA-256照合後、同じバイトを `data:image/jpeg;base64,...` にして `input_image.image_url` に渡した。画像URLだけを送った代替ではない。既存 `loadCredential()` を実行時に利用し、秘密の値・リクエストヘッダー・SDK例外全文は出力していない。

この検証はDecisions APIへの直接入力。ゲームの撮影→アップロード→キュー処理や70人の負荷試験とは別の範囲。[既存のバナナOK・自動車NGの検証](/Users/anubis/Documents/mycodes/ai-karimono-race/docs/real-image-verification.md)も参照。写真内の物体、撮影時刻、本人撮影の証明を保証しない。確率値はモデル推定であり保証値ではない。

再実行: `node scripts/verify-boundary-images.mjs`。毎回2回の有料実API呼び出しが発生する。[OpenAI公式Decisions API仕様](https://developers.openai.com/api/docs/guides/decisions)。
