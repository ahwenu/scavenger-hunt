# 効果音の仕様と出典

2026-10-18。ユーザーの「モバイル・Plugin Extensions双方に無料の派手な効果音を入れる」という指示に基づく実装。[ADR-0014](adr/0014-game-sound-effects.md)を参照。

効果音・ジングル：**[OtoLogic](https://otologic.jp/)**、[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。[利用規約](https://otologic.jp/free/license.html)で無料利用と加工、クレジット要件を確認。各画面の「効果音クレジット」に作者・ライセンス・変更内容を表示する。

| 場面 | 元ファイル / 出典 | 使用秒数 | 加工記録 |
| --- | --- | --- | --- |
| ボタン・折りたたみ | [Quiz-Button03-2.mp3](https://otologic.jp/free/se/quiz01.html) | 0.28 | start 0.110s, length 0.28s, gain x2.3 |
| 写真受付・共通ヒント保存 | [Quiz-Button03-1.mp3](https://otologic.jp/free/se/quiz01.html) | 0.48 | start 0.176s, length 0.48s, gain x2.2 |
| 参加・部屋作成 | [Onoma-Sparkle13-5(Fast).mp3](https://otologic.jp/free/se/sparkle01.html) | 1.15 | start 0.085s, length 1.15s, gain x3.7 |
| シャッター・端末写真選択 | [Camera-Compact01-01(Shutter).mp3](https://otologic.jp/free/se/camera01.html) | 0.28 | start 0.101s, length 0.28s, gain x0.8 |
| お題開始 | [Quiz-Question02-3(High).mp3](https://otologic.jp/free/se/quiz01.html) | 1.15 | start 0.111s, length 1.15s, gain x1.5 |
| 正解・ホストの加点通知 | [Quiz-Ding_Dong05-2(Fast-Long).mp3](https://otologic.jp/free/se/quiz01.html) | 1.45 | start 0.100s, length 1.45s, gain x2.2 |
| 不正解・ホスト操作失敗 | [Quiz-Buzzer05-2(Short).mp3](https://otologic.jp/free/se/quiz01.html) | 0.38 | start 0.111s, length 0.38s, gain x3.5 |
| 残り5秒 | [Countdown06-5.mp3](https://otologic.jp/free/se/countdown01.html) | 0.25 | start 0.106s, length 0.25s, gain x3.4 |
| 撮影受付終了 | [Countdown06-1.mp3](https://otologic.jp/free/se/countdown01.html) | 0.85 | start 2.070s, length 0.85s, gain x2.6 |
| 競技結果発表 | [Quiz-Results01-1.mp3](https://otologic.jp/free/se/quiz01.html) | 3.10 | start 0.110s, length 3.10s, gain x1.6 |
| 全競技終了 | [yattaze!1.mp3](https://otologic.jp/free/jing/short1.html) | 3.60 | start 0.092s, length 3.60s, gain x1.2 |

全素材を44.1kHzモノラル・96kbps MP3へ変換し、短いフェードとピーク23,000/32,767への調整を適用。再生時の全体ゲインは0.65、通常操作と他者通知にはさらに個別の減衰を適用。合計164,738 bytes（約165KB）。「派手」は音色・アクセント・報酬音の優先度で表現し、同時に重ねて音量を増やさない。

## 再生の動き

- 参加・ボタン操作でAudioContextを起動する。ブラウザが許可しない場合は操作・視覚演出を継続する。ON/OFFは端末の `karimono:sound` に保存する。
- 初回の状態取得・再読込は基準値として扱い、過去の開始・参加・加点・終了音を再演しない。定期同期で変化を検知したときだけ鳴らす。
- 写真の圧縮成功や送信開始だけで正解音を鳴らさない。正解は既存のサーバー確定結果、Pluginの加点通知はサーバーのランキング増分を使う。
- モバイルの他者通過は小さいキラキラにまとめ、本人の正解音を優先する。Pluginでは同時に複数人が合格しても1回の通知へまとめる。
- 残り5秒は各秒1回。ロビー締切を超えても準備中なら開始音を鳴らさず、実際の開始状態を待つ。本人の正解後は撮影受付のカウント音を止める。
- OFFや画面非表示で再生中・復号待ちの演出を破棄する。900ms以上遅れた読み込み完了音を鳴らさない。優先度とクールダウンで重複を抑え、同時再生は1音にする。
- 音源のネットワーク取得はモバイルの同一オリジンのみ。Cloudの既存資産バンドルへMP3をbase64で格納し、Workerで元バイトへ戻して `audio/mpeg` として配信する。CSP緩和・外部CDN・追加依存は不要。
- Pluginは音源をdata URLでHTMLへ同梱する。ネットワークアクセスなしで復号でき、`plugin/` 単独ビルドの境界を保つ。

## 配置と更新

- モバイル：`apps/web/sound-*.js`、`apps/web/sounds/`。生成済みCloud資産の更新は `node scripts/sync-cloud-assets.mjs`。
- Plugin：`plugin/src/ui/sound-*`、`SoundControls.tsx`、`assets/sounds/`。独立配布のため再生エンジン・イベント監視処理はPlugin内へ同梱する。`sound-engine.js`・`sound-events.js`を変更する際は両方へ同じ修正を入れる。内容一致をテストする。
- 両方の `sounds/manifest.json` へ元ファイル・配布ページ・加工内容・SHA-256を記録する。モバイル/Plugin/Cloudのバイト一致もテストする。

## 検証

- ルート55件（効果音8件を含む）・Cloud9件・Plugin27件、合計91件成功。構文確認、Cloud/PluginのTypeScript確認が成功。
- CloudのVinext/WorkersビルドとPluginのHTML/MCPビルドが成功。ビルド済みWorkerをローカル起動し、全11音源のHTTP 200・audio/mpeg・SHA-256一致、3つの音声JSモジュールの一致を確認。
- 全11 MP3をffmpegで復号し、無音でないこと・フルスケールのクリップがないことを確認。
- 通常/共有のPlugin配布アーカイブを作成。別パス・別cwd・node_modulesなしで、未接続/明示デモの11 MCPツールとUIの可搬性確認が成功。
- ブラウザのローカルPluginプレビューでON/OFF・部屋作成・準備・開始・結果・ゲーム終了を確認。モバイル画面で参加確定による音声ON、OFF、再読込後のOFF保持、再ONを確認。カメラ許可や個人の写真の取得は行っていない。
- 検証画像：Git対象外 `plugin/artifacts/sound-controls-browser.png`。ローカルデモであり、公開部屋・実AIの採点記録へ混ぜない。

音色の試聴・iPhone/Android・ネイティブPlugin Extensionsパネルでの再生確認は未実施。ブラウザの「音 ON」はAudioContextの起動確認であり、音質を聴いて評価した記録ではない。公開Sites再配備・インストール済みPluginの更新は今回行っていない。
