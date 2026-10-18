# ADR-0016: ゲーム記録の本番保存先をSupabaseにする

- 状態：Accepted
- 作成日：2026-10-18
- 最終更新：2026-10-18
- 関係担当：さが さん（保存・ゲーム処理）、Ahwenu（HTTP/AI）、mae さん（参加者画面）
- 決定の根拠：ユーザーの「実際はsupabaseに繋ぐ」という確定指示。QRからの約100人が全員プレイヤーであること、人数と順位をライブ更新することもユーザー指示
- 置き換えるADR：[ADR-0003](0003-sites-runtime-storage.md) のD1を本番のゲーム記録の正本とする構成案
- 後継ADR：なし

## 背景

取り込み済みCloudはD1とR2を使い、ADR-0011の新Sites v2配備もその構成で行われた。参加者画面の追加作業中に、本番統合先をSupabaseとする指示があった。既存のD1検証結果と、これから作るSupabase接続を区別する必要がある。

## 決定と範囲

- 部屋、参加者、競技、提出状態、得点・順位の永続化先をSupabaseのPostgresとする。採用方針のAcceptedであり、接続・マイグレーション・負荷試験の完了ではない。
- 参加者はスマホのSites画面から同じ部屋のQRに入り、約100人全員をプレイヤーとして扱う。観覧専用の参加区分を追加しない。参加人数と順位の変化を画面へ自動反映する。
- [ADR-0011](0011-new-sites-deployment.md) のSites実行配置・publicアクセス・部屋認可、[ADR-0015](0015-participant-typescript-ui.md) の参加者TypeScript画面は維持する。現行の `/api/rooms/:id` を境界に保存実装を移すため、ブラウザからのSupabase直接アクセスやSupabase Authへの認証変更は本ADRで採用しない。
- 更新方式は未確定。既存のスナップショット取得を互換経路として残し、Supabase Realtimeをサーバーで受ける方式や認可付きイベント配信を検証する。接続方式・更新間隔・100人時の性能をAccepted扱いしない。
- 写真の保存サービスは、この指示だけでは確定しない。現行は非公開R2へ一時保存し、判定後に削除する実装である。Supabase Storageへの変更は、保存期間・認可・削除を含めて別途実装仕様へ記録する。
- 10競技・初回合格500点・ヒント等は[Issue #1](https://github.com/ahwenu/scavenger-hunt/issues/1)の実装依頼内容であり、本ADRのAcceptedをもって検証済みゲームルールにしない。

## 代替案と理由

D1を本番の正本として続ける案はユーザーの最新指示と合わない。Supabaseへブラウザから直接接続する案は、既存の参加者Bearer・ホストCookie・部屋権限を同時に変更するため、今回の保存先変更には含めない。

## 影響と引き渡し

さが さんがPostgresのスキーマ・マイグレーション・原子的な判定確定と加点を担当し、AhwenuがSitesのHTTP/AI境界を接続する。mae さんはAPIから確定値を表示する。移行時はD1とSupabaseの二重書き込みを暗黙に行わず、使用する正本と切替手順をバックエンドのPRに記載する。

接続URL、サーバー用秘密設定、スキーマ、移行要否、実環境での権限設定は未受領・未確認。秘密値はコード、Issue、ブラウザ、ログへ記録しない。具体的な受け渡しと設定名の依頼は[16 Supabase統合](../16-supabase-integration.md)に置く。

## 検証・見直し条件

今回コードで確認したのは `apps/cloud/lib/cloud-api.ts` のD1/R2実装と `apps/cloud/app/participant/api.ts` の同一オリジンAPI呼び出し。Supabase SDK、接続設定、SQL、実接続は未実装・未確認。Supabaseへ接続した部屋で参加・写真提出・判定・得点・再取得を通し、100ブラウザ相当の負荷と実機撮影を別々に記録する。

## 関連仕様

[Project.md](../../Project.md)、[04 API契約](../04-api-contract.md)、[05 保存とゲーム処理](../05-data-backend.md)、[12 既存Sites配備](../12-sites-deployment.md)、[16 Supabase統合](../16-supabase-integration.md)

## 変更履歴

- 2026-10-18：ユーザーのSupabase・100人プレイヤー・人数/順位ライブ更新の指示を採用方針として記録。既存D1/R2の実装・配備実績を維持し、未実施の統合と分けた。
