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

## 従来のモバイル画面・Pluginの再生の動き

この節は `apps/web/` とPluginへ実装したWeb Audio版の記録。現在のTypeScript参加者画面への追加適用は、本書の追記で区別する。

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

## 従来のモバイル画面・Pluginの検証

後続のホストUI改修で、2026-10-18 16:44 JSTに音源同梱のPlugin 0.4.0をローカルへインストール・有効化した。最終distとのバンドル一致と接続参照の復元を確認。以下の「インストール済みPlugin未更新」は効果音追加時点の記録であり、現在の配備状況は[08 ホスト画面仕様](08-plugin-extensions.md)を参照する。実機で音色を試聴した記録は追加していない。

- ルート55件（効果音8件を含む）・Cloud9件・Plugin27件、合計91件成功。構文確認、Cloud/PluginのTypeScript確認が成功。
- CloudのVinext/WorkersビルドとPluginのHTML/MCPビルドが成功。ビルド済みWorkerをローカル起動し、全11音源のHTTP 200・audio/mpeg・SHA-256一致、3つの音声JSモジュールの一致を確認。
- 全11 MP3をffmpegで復号し、無音でないこと・フルスケールのクリップがないことを確認。
- 通常/共有のPlugin配布アーカイブを作成。別パス・別cwd・node_modulesなしで、未接続/明示デモの11 MCPツールとUIの可搬性確認が成功。
- ブラウザのローカルPluginプレビューでON/OFF・部屋作成・準備・開始・結果・ゲーム終了を確認。モバイル画面で参加確定による音声ON、OFF、再読込後のOFF保持、再ONを確認。カメラ許可や個人の写真の取得は行っていない。
- 検証画像：Git対象外 `plugin/artifacts/sound-controls-browser.png`。ローカルデモであり、公開部屋・実AIの採点記録へ混ぜない。

音色の試聴・iPhone/Android・ネイティブPlugin Extensionsパネルでの再生確認は未実施。ブラウザの「音 ON」はAudioContextの起動確認であり、音質を聴いて評価した記録ではない。公開Sites再配備・インストール済みPluginの更新は今回行っていない。


## 後続の公開配備（2026-10-18 16:35 JST）

ユーザーの「コミットしてプッシュして、デプロイして」という追加指示により、公開Sitesへv5を配備した。上の「今回未実施」は効果音実装時点の記録として残す。

- 公開URL： https://karimono-one-lease.ahwenu.chatgpt.site
- 元リポジトリの実装：`29e6728ecf10c752e050368642717c0bdab4efd2`。GitHub mainへpush済み。
- Sitesの配備ソース：`fdb36b65b0926458a50aa5aea04df76a513ef866`。コミット済み元ソース659ファイルを秘密除外・旧project_id除去のうえsnapshotへ保存した。
- version：`appgprj_6ad4611142408191ae99be09e3b27efb~appgver_ce8d7bcbbf9481919911837bc14c27b7`（v5）。
- deployment：`appgdep_6ad476b311848191a33fd9380179a648`、`succeeded`。publicと実行環境revision 1を維持。
- 配備用の `scripts/sync-game-assets.mjs` に音声3モジュールと11 MP3を追加。Workerのバイナリ復元も反映。配備専用TypeScript・Cloud9件・公式ビルド/ソースpush/アーカイブ保存が成功。
- 公開URLで匿名トップ200、全11 MP3の200・audio/mpeg・SHA-256一致、app/camera/音声3モジュールの完全一致を確認。AI呼出・新規部屋作成・採点は実施していない。
- 実機試聴とインストール済みPluginの更新はこのSites配備に含めない。並行作業中のPlugin 0.4.0や未コミットの画面変更は、今回の配備snapshotへ含めていない。

## TypeScript参加者画面への接続（2026-10-18）

`apps/cloud/app/participant/ParticipantGame.tsx` に、同じOtoLogic 11種類を接続した。従来画面の音源がリポジトリにあるだけでは、新しいTypeScript画面での再生にはつながっていなかった。旧撮影音・成功音への参照を置き換え、既存の `/sounds/` 配信を使う。Plugin・旧Web画面・APIや得点処理は今回の変更対象外。

| 場面 | 再生する音 | 再生条件 |
| --- | --- | --- |
| ボタン・開閉 | `tap` | 有効なボタン・開閉操作。シャッターと音切替は別扱い |
| 参加 | `join` | 参加APIの成功後 |
| 撮影・端末写真選択 | `shutter` | 写真の取り込み開始 |
| 写真受付 | `submit` | サーバーがqueued等の受付状態を返したとき。同じ受付は1回 |
| お題開始 | `start` | 新しい競技またはactiveへの遷移 |
| 本人の合否 | `success` / `retry` | accepted / rejectedの新しい確定結果。error・failedは無音 |
| 他者の合格 | `peer` | サーバーの他者winsの増分を1回へまとめる。参加音を小さく再利用 |
| 残り5秒 | `tick` | 各秒1回。本人の合格後は停止 |
| 受付終了 | `timeup` | 残り時間が0へ進んだとき |
| 競技結果 | `result` | closedかつ保留判定0件へ進んだとき |
| 全競技終了 | `victory` | finishedへ進んだとき |

### 音の設定と復帰

追加指示に従い、初期設定はオン。`karimono:sound` に保存済みのオフ設定は尊重する。最初の参加やタップで、BGM・声・効果音の3つのHTMLAudio要素を起動し、以後は再利用する。ブラウザが再生を拒否しても画面操作を継続する。

OtoLogic効果音は優先度・クールダウンで同時1音へ整理する。定期取得と提出ACKを同じ提出IDで照合し、確定結果を再演しない。初回取得・部屋変更・タブ復帰では現在値を基準にする。音オフ、タブ非表示、画面破棄で効果音・声・BGMと待機中の演出を止める。復帰ではBGMだけを再開し、過去の声・結果を追いかけない。

マナーモードでの再生に向け、従来のWeb Audio版とは分けてHTMLAudioのメディア経路を使い、対応ブラウザでは `navigator.audioSession.type = 'playback'` を指定する。根拠と適用境界は[ADR-0018](adr/0018-participant-media-audio.md)。iPhone/Androidの消音設定を含む実機試聴は未確認であり、端末のメディア音量・ブラウザの許可状態に依存する。

ユーザー指定BGMは通常0.16、声の再生中は0.07へ下げる。声は0.78、効果音は上表の素材ゲインに全体0.65と個別減衰を掛ける。猫・ロボットの声は再生速度0.85倍・音程保持でゆっくり再生する。音の出典・ライセンス・加工内容は遊び方画面の「音について・クレジット」に表示する。猫の声9本の台詞と素材の採用状況は[音声の引き渡し](design/participant-assets-and-audio.md)を参照。

### 今回の確認範囲

- 既存音8件、参加者イベント監視12件、HTMLAudio境界11件、計31件の自動確認が成功。初回基準化、ACK/ポーリング重複、古いrevision、本人・他者の分離、残り5秒、保存済みオフ、同じ要素の再利用、BGMループ、音声セッション、遅延破棄、非表示/オフ/破棄時停止を含む。
- HTMLAudioの確認は模擬環境での再生呼び出し・停止・設定を検証したもので、端末から実際に聞こえたことやiPhoneの消音スイッチを検証した記録ではない。
- 新トップと新しい声9本を接続後にTypeScript型検査・Cloudビルドが成功。参加先入力の検証4件も成功。ローカル配信の `tap_Quiz-Button03-2.mp3` と採用した `success-ja.mp3` はHTTP 200と元ファイルのSHA-256一致を確認。
- Chromeで新トップ・参加先入力・外部URL拒否、音の初期オン、オフ設定の再読込後保持、再オン、遊び方クレジットを確認。トップとヒント確認時のコンソールエラー・警告はなし。これは出音の実機試聴を確認した記録ではない。
- 猫9本は指定Voice IDの「さっちゃん」・Eleven v4で生成し、MP3復号と音量の確認を実施。今回の公開再配備・実機マナーモード・100台の確認は未実施。[作業レポート](ai-reports/2026-10-18-参加者効果音と音声の接続.html)に範囲を記録し、既存v5の公開配備を今回の画面・声の配備成功として扱わない。
