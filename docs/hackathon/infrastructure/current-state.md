# 現状と未検証の境界

更新: 2026-10-18。対象コミット: `c318550`。ここは**実装の有無と検証の主体**を分ける索引です。秘密値、写真本体、チームDM全文は記録しません。

| 領域 | コード・資料で確認できること | 実行の確認 | まだ確認できていないこと |
| --- | --- | --- | --- |
| 公開Sites | さがさんが `https://karimono.sagasa.chatgpt.site/` を共有。ブラウザで入口の「部屋を作成する」と遊び方の表示を確認 | 2026-10-18のブラウザでトップ画面のみ | そのURLで部屋作成から実AI判定まで通ること、Pluginとの結合 |
| 取り込みプロトタイプ | `apps/web/app.js` に参加・撮影・提出・結果更新・ランキング表示、`apps/web/live-camera.js` にカメラ処理。`apps/cloud/` と `apps/server/` は取り込み元デモ | 既存テストと過去の[検証記録](../../10-demo-import.md)がある。今回の公開先での全周確認とは別 | 01/04の新仕様への適合、公開Sitesと独立AI APIの接続 |
| Plugin Extensions | `plugin/src/server/server.ts` にホストのMCPツールと `ai_status` / `ai_generate_challenge`。`plugin/src/server/adapters.ts` の標準は未接続で、デモはサンプル部屋・固定順位 | 公式CLIの登録と、ユーザー操作による実拡張内のAPI接続/お題表示を各1例[11](../../11-api-integration.md)に記録 | 実部屋・実スマホ参加・実得点を取得するSitesアダプター、写真判定UI |
| 独立AI API | `api/src/app.mjs` に認証付きのお題生成・JPEG写真判定・参考画像取得。ゲームの得点は返さない。標準生成はResponses、判定はDecisions、Agents参考写真は明示時のみ | [11](../../11-api-integration.md)にローカルMCP経由の生成1例・判定1例と自動テストを記録 | 参考写真付きAgentsの成功、公開配備、Sitesサーバーからの到達、実ゲームへの確定 |
| デザイン | `docs/design/README.md` は画像・README下書き・発表素材の共有場所 | 2026-10-18時点のGitツリーではREADMEのみ | デザイン画像の受領、画面への組込み、端末幅の確認 |

## 境界をまたぐときに注意すること

- **Pluginの実AIお題表示 ≠ ゲームのお題公開。** `ai_generate_challenge` の結果はサンプルの部屋・順位に反映されず、`host_prepare_topics` のデモはプリセットだけを使う（[MCPツール](../../../plugin/src/server/server.ts)、[デモアダプター](../../../plugin/src/server/adapters.ts)）。
- **AIの合否 ≠ 得点。** 独立AI APIは `pass/fail/uncertain` と理由コードを返す。締切・再送・加点・順位の正本はSitesゲーム側（[API実装](../../../api/src/app.mjs)、[ADR-0010](../../adr/0010-independent-ai-api.md)）。
- **ローカルAPI ≠ 公開Sitesからの接続。** 独立APIはローカルHostに制限され、サービス用トークンが必要。`challengeId`とお題の保持はメモリ内20分で、再起動すると消える。公開接続先・認証・期限を決める必要がある。
- **過去のデモ検証 ≠ 今回の結合。** 取り込み元の公開検証やブラウザプレビューの実AI成功を、Plugin↔Sites↔スマホのゲーム成立として記録しない。
- **会議の構想 ≠ 最新の確定方針。** 10月17日の議事録の参加者Plugin案、Supabase案、17:45の目安は、後のADR・現在のコード・X共有の17:15と区別する。

## 次の技術的な接続点

1. `Pluginホスト → Sitesゲーム`: 実部屋の作成・取得・進行・認可を、サンプルアダプターとは別に実装する担当を決める。
2. `Sitesゲーム → 独立AI API`: 公開先、サービス認証、お題IDとラウンドIDの対応、失敗・20分期限の扱いを決める。
3. `スマホ画面 → Sitesゲーム`: 使うAPI契約を1つに揃え、撮影写真の受付・結果更新・再送を公開環境で確認する。
4. `デザイン画像 → スマホ画面`: 受領した画像と状態・文言を照合し、既存のカメラ/通信へ組み込む。
