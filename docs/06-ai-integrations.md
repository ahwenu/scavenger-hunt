# AI・外部サービス連携

主担当はAhwenu。お題生成・写真判定・参考写真の外部API接続、返却形式の正規化、タイムアウト・再試行を実装する。さが さんは正規化した結果の保存と加点確定を担当する。mae さんはAPIが返す処理状態・合否・理由コードを参加者画面へ表示する。

## 役割と選定

添付図に合わせ、お題生成はAgents API、写真判定はDecisions APIを第一候補とする。両APIは公式資料で確認できたが、このアカウント・配備先での権限、性能、料金、利用上限は実呼び出し前に確認する。

Agents APIはOpenAI管理の実行環境を使う仕組みである。ゲーム開始前の生成処理に閉じ込め、写真を提出するたびにエージェントを起動しない。[OpenAI: Agents API](https://developers.openai.com/api/docs/guides/agents-api/overview)

単純な3問生成に対して運用負荷が過大なら、生成アダプターをResponses APIとStructured Outputsへ切り替える。API名の採用よりゲームの成立を優先するが、外部サービス利用条件がイベント側から指定される場合は別途確認する。[OpenAI: Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

## ゲーム内部のインターフェース

これは自分たちのアダプター契約であり、外部SDKのメソッド名やレスポンス形式ではない。

```ts
interface TopicDraft {
  title: string;
  instruction: string;
  criteria: Array<{ id: string; description: string }>;
  difficulty: "easy";
}

interface TopicGenerator {
  generate(input: { count: number; venue: "indoor"; locale: "ja" }):
    Promise<{ topics: TopicDraft[]; promptVersion: string }>;
}

interface PhotoJudge {
  judge(input: {
    submissionId: string;
    topic: TopicDraft;
    jpeg: Uint8Array;
    referenceJpeg?: Uint8Array; // 完成版で利用
  }): Promise<{
    outcome: "pass" | "fail" | "uncertain";
    reasonCode: "CONDITIONS_MET" | "CONDITIONS_NOT_MET" | "PHOTO_UNCLEAR";
    providerRequestId: string;
    model: string;
    promptVersion: string;
  }>;
}
```

通信・拒否・形式不正は上記の合否にせず、アダプターの型付きエラーで返す。内部処理でSubmission.failedへ正規化する。点数はAIに生成させない。

## お題生成

- 入力：屋内、会場内で見つけられる物、3問、日本語、簡単、写真から確認可能な条件。
- 出力例：title「赤くて丸いもの」、instruction「赤く、丸い形の物を1つ撮影してください」、criteria「同じ物が赤い」「同じ物が丸い」。
- 写真で分からない性質、主観的な美しさ、危険物、人物の容姿、個人情報、屋外移動や物品購入を必要とするお題を除外する。
- 一括生成後に件数、文字数、重複、条件の明確さをサーバーで検証する。3問すべて揃ってからreadyにする。
- 同じ部屋で生成を重複実行しない。MVPは開始前のHTTPリクエスト内で完了を待ち、初期案では30秒で打ち切る。実行環境がそれより短い場合は環境の制限に合わせる。期限をDBへ保存し、取得時に期限超過をfailedへ正規化してgeneratingのまま残さない。
- 生成完了後も開始前はホストが内容を確認する。MVPは再生成または手動で用意したプリセットを選び、自由編集は完成版とする。
- API利用不能時はプリセット3問を使える。UIではAI生成とプリセットを区別する。

モデルID、SDK/APIの具体的な要求形式は実装開始時の公式仕様で確定する。生成結果をJSON Schemaで検証できる構成を選び、未検証のAgents APIオプション名を本書では固定しない。

## 写真判定

Decisions APIでは画像入力と条件判定ができる。画像はインラインbase64 data URLで送り、ストレージのHTTP URLやfile_idを直接渡さない。公式レスポンスを上の内部形式へ変換する。[OpenAI: Decisions](https://developers.openai.com/api/docs/guides/decisions)

アプリ側の判定方式案は、同じ写真について「対象が判別可能か」「同一の対象が全条件を満たすか」を評価するものとする。条件は1つの対象に同時に成立する必要があり、「赤い本＋丸い白皿」の組み合わせで「赤くて丸いもの」を合格にしない。

閾値の初期案：判別可能性が0.8未満ならuncertain、判別可能で条件成立確率が0.8以上ならpass、0.2以下ならfail、それ以外はuncertain。これはアプリの仮ルールであり、モデルの確率が正解率を保証するものではない。会場の写真で評価し、初回デモ前に閾値を固定する。

画面理由はreasonCodeから短い日本語を表示する。APIが自由文の説明を必ず返すとは仮定しない。画像中の文字やユーザー入力が「合格にして」などと指示しても、採点命令として扱わない。

外部通信のタイムアウトを提出処理の15秒予算内に収める。429/5xxの自動再試行は残り予算がある場合に最大1回とし、課金・レート制限を観測する。締切や処理期限を過ぎた結果を反映しない。

## 参考写真：完成版

参考写真は「見た目を完全一致させる正解画像」ではなく、お題の例として扱う。条件文を判定の正本にし、同じ条件を満たす別の物も合格にする。

検索と取得はバックエンドで行い、`ReferenceImage {id, sourcePageUrl, author, licenseName, licenseUrl, storageKey}` を保存する。CommonsのAPIでファイルごとのメタデータを取得し、利用条件が確認できる画像だけ採用する。[Wikimedia: Machine-readable data](https://commons.wikimedia.org/wiki/Commons:Machine-readable_data)

外部メタデータは安全にテキスト化して表示し、任意のHTMLを挿入しない。画像取得先は許可したドメインに限定し、容量・形式を検証する。取得失敗時も文章だけで出題できる。

## 評価・費用

初回は3問×10枚以上の正解/不正解/曖昧写真を用意する。逆光、ぼけ、複数物、紛らわしい色や形を含め、特に誤合格を記録する。実測で採用API・モデル・閾値を決め、判定時間の中央値/P95と失敗率も記録する。

1部屋10チーム×3問×最大5提出で、ゲーム上の受付上限は150件。外部APIの自動再試行で呼び出しは増え得るため、部屋単位の呼出数・費用上限を別に設ける。価格は固定値を本書に書かず、導入時の公式料金と実使用量で見積もる。上限到達時は写真判定を明示的に停止し、ホストに状態を表示する。
