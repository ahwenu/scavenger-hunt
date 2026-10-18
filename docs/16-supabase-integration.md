# Supabase統合と参加者APIの受け渡し

更新日：2026-10-18。対象：`feat/participant-image-ui` の現行Cloud APIとバックエンドへの追加依頼。方針は[ADR-0016](adr/0016-supabase-game-persistence.md)、依頼先は[Issue #1](https://github.com/ahwenu/scavenger-hunt/issues/1)。

## 確定した前提と現状

| 項目 | 状態 |
| --- | --- |
| 本番ゲーム記録 | SupabaseのPostgresへ保存する方針。接続・SQL・マイグレーションは未実装/未確認 |
| 実演 | 同じQRから来る約100人が全員プレイヤー。人数と順位を画面へ自動反映する |
| 現行コード | `apps/cloud/lib/cloud-api.ts` はD1/R2。既存Sites v2の検証もこの構成 |
| フロント接続先 | `apps/cloud/app/participant/api.ts` から同一オリジンの `/api/rooms/:id`。Supabase直接接続はない |
| 現行認可 | 参加者は部屋限定Bearer、ホストは部屋別HttpOnly Cookie。保存先変更と認証方式変更を一括にしない |
| 未受領・未確認 | Supabase URL、サーバー用資格情報、既存スキーマ、画像保存先の変更、100人のSupabase実接続・実AI・実機撮影の負荷評価 |

さが さんが保存・ゲーム進行・確定した得点/順位を、AhwenuがHTTP・AI接続を担当する。mae さんは取得した確定値を表示する。D1からSupabaseへの切替、既存部屋の移行要否、戻す手順をバックエンドPRに含める。

## フロントとの境界

| ルート | 現行の入力と出力 | 依頼する追加 |
| --- | --- | --- |
| `POST /api/rooms/:id/join` | JSON `{name}` → **200** `{id,token}`。現行上限200人 | 同時に100人参加しても個別IDを返す。登録上限は既存200を保つ |
| `GET /api/rooms/:id/state` | Bearer → `room,mode,serverTime,lobby,players,ranks,round,mine,stats` 等。時刻はepochミリ秒 | `game,stages,revision,live`、`ranks[].score/rank`、`mine[].awardedPoints`、`stats.activePlayers` |
| `POST /api/rooms/:id/submit` | Bearer、multipart `roundId,requestId,photo` → 202 `{id,status,receivedAt}` | Supabaseへ受付を永続化し、重複受付・二重加点を防ぐ。再送は同じ提出ID |
| `GET /api/rooms/:id/hint?roundId=...` | フロント側に呼出関数あり。現行サーバーは404 | 200 `{roundId,text,available}`。現在競技の保存済みヒントを全員へ返す |

既存フィールドの名前・意味と `sync: "polling"` は互換を保つ。現在の `join` は201ではなく200であり、今回の依頼本文も200に合わせる。エラーは現行互換の `{error: "画面に表示できる説明"}` とし、機械判定コードは追加フィールドに置く。秘密値、他人の提出詳細、未来のお題は返さない。

10競技、各競技の最初の合格だけ500点、得点降順→合格受付までの累計時間→参加時刻→IDの順序、ヒントはIssueの実装依頼。現行コードは勝利数順位で、点数・全ゲーム終了・ヒントは未実装。

## 人数と順位のライブ更新

初期の互換経路はstateの定期取得。追加の方式は、Supabase Realtimeをサーバーで受けて認可付き配信へ変換する方式やSSE等を、配備環境で検証して決める。秘密キーをクライアントへ渡すことを前提にしない。

- `revision: number`：部屋の表示内容が変わったとき増える単調な版。人数、競技、提出結果、得点/順位を同じ版のスナップショットとして返し、古い応答の上書き防止に使う。
- `live: { pollIntervalMs: 2000, activeWindowMs: 30000, updatedAt: number }`：初期の依頼値。負荷試験で変更する場合は実測とともに契約へ反映する。
- `stats.players`：登録済みの全プレイヤー数。ブラウザを閉じても減らさない。`stats.activePlayers`：直近30秒以内に認証済み通信があった人数。集計を実装してから数値を返し、未対応は `null`。オンラインの厳密な在席保証とはしない。
- `ranks`：全登録プレイヤーの確定した順序。`rank` は1始まり。同得点でも累計時間、参加時刻、IDで順序を決める。切断だけでは得点も順位も削除しない。

100画面を2秒間隔で取得する場合は平均約50 req/sとなるため、部屋共通部分の集計・キャッシュを共有し、自分の `mine` は認可後に合成する。人数/順位の変更が100画面へ反映されるまでp95 3秒以内を検証目標として依頼する。保証値ではなく、実測の成功率・429/5xx・遅延を記録する。

再接続・タブ復帰は全スナップショットを再取得する。新方式で差分イベントを使う場合も、欠落/版の不連続で同じGETへ戻す。イベントに他人の写真、判定理由、トークン、自己紹介を含めず、必要な表示名・得点・順位と版だけを扱う。

## 環境設定の受け渡し

現行の参加者画面にはSupabaseキーを登録しない。同一オリジンのSites APIが接続を受け持つ。以下は**バックエンドへ依頼する設定名**であり、現在のコードが読み取る実装はまだない。

| 名前 | 設定場所・用途 |
| --- | --- |
| `SUPABASE_URL` | Sites APIのサーバー実行環境。実プロジェクトのURL |
| `SUPABASE_SECRET_KEY` | Sites APIの秘密設定。旧形式なら `SUPABASE_SERVICE_ROLE_KEY` 等、実装が読む名前をREADMEに固定する |
| `OPENAI_API_KEY` | 既存Cloud AIを使う場合のSitesサーバー秘密設定。Supabaseの資格情報とは別 |
| `DB` / `BUCKET` | 現行D1/R2バインディング。移行と写真保存先の判断に応じてバックエンド担当が更新 |

ローカルのサーバー設定はバックエンド実装が読むGit対象外ファイルへ置く。Cloud/Wranglerの `.dev.vars` を採用する場合は、読み込みを検証してサンプルへ**名前だけ**追記する。`.env.local` というファイルを置くだけで現在のCloudが自動でSupabaseへつながるわけではない。秘密値はIssueや引き渡し文へ貼らず、配備先の秘密設定へ登録する。

Supabaseのsecret/service_roleキーはRLSを迂回できるため、ブラウザへ渡さず、API側で部屋・参加者・ホストの認可を行う。公開可能なキーだけでゲーム記録を読めない権限も検証する。[Supabase公式のAPIキー説明](https://supabase.com/docs/guides/getting-started/api-keys)と[データ保護](https://supabase.com/docs/guides/database/secure-data)に基づく。既存プロジェクトのRLS・Data API公開設定は未確認。

## 引き渡し完了の確認

バックエンドPRには、SQLと切替/戻す手順、確定した全状態のJSON、環境変数の名前と登録場所、保存期間、100人の負荷記録を含める。参加→撮影→判定→順位と人数の変化→切断/復帰→最終競技までを同じ部屋で確認する。デモ判定の負荷、実AIの少数例、Supabaseの実接続、iPhone/Androidカメラを別の証拠として記録する。
