# MCP Eventsの利用状況調査

確認日：2026-10-18。**現在のカリモノは公式MCP Eventsを利用していない。** ホスト画面は2秒間隔でMCPツールを呼び、Sitesの状態を取得している。本書は調査記録であり、導入判断や実装変更は行っていない。

## 公式機能との違い

公式MCP Eventsは、ChatGPTがイベントを発見・購読し、署名付きWebhookで変更を受け取って処理する仕組み。MCP 2.0（protocol `2026-07-28`）、認証・認可、イベント宣言、購読の永続化、コールバック検証と署名配信が必要になる。[OpenAI公式：MCP Events](https://developers.openai.com/plugins/build/mcp-events)

画面を開いている間のゲーム状態同期と、ChatGPTへの監視イベント配信は別の用途。導入しても現在のUIポーリングが自動で置き換わるものではない。

## 実装・プロトコルの確認結果

| 確認箇所 | 現在の動作 |
| --- | --- |
| 実MCPをInMemoryTransportで初期化 | サーバー能力は `resources` と `tools`。イベント能力の宣言はない |
| `server/discover` | JSON-RPC `-32601`（Method not found） |
| `events/list` | 同じく `-32601` |
| `events/subscribe` | 同じく `-32601` |
| `events/unsubscribe` | 同じく `-32601` |
| [main.tsx](../plugin/src/ui/main.tsx) 45〜61行 | 部屋があり、操作中でなく、画面が非表示でない場合に `host_get_room` を呼び、2秒後に次回を予約 |
| [bridge.ts](../plugin/src/ui/bridge.ts) 102〜113行 | MCP Appsの `callServerTool` と `ontoolresult` を利用。通常のUIツール結果通知であり、監視イベント購読ではない |
| [sites-adapter.ts](../plugin/src/server/sites-adapter.ts) 166〜170行 | `GET /api/rooms/:id/state` で状態を取得しDTOを検証 |
| [cloud-api.ts](../apps/cloud/lib/cloud-api.ts) 56・237行 | `sync: polling` を返す。Cloudの部屋 `/events` は定期同期を使う旨の404応答 |
| [pass-events.ts](../apps/cloud/lib/pass-events.ts) 10〜17行 | D1へ合格履歴を原子的に記録するアプリ独自の処理。MCP Eventsの購読・Webhookではない |
| [ローカルNode版](../apps/server) | 独自のSSE同期。公式MCP Eventsの登録/購読/署名配信とは別実装 |

`ontoolresult` の通常の `ui/notifications/tool-result` や、ゲーム内データの `events` という名前だけを、公式MCP Eventsの利用証拠とは扱わない。上記は調査時のコードとプロトコル応答の記録であり、行番号は後続変更で変わり得る。

## 導入を検討する場合

MCP 2.0対応の認証付き接続、利用者が閲覧できる部屋のイベント定義、購読/解除/更新の永続化、署名付きWebhookと失効・再送の設計を別作業として扱う。現在のローカルstdioサーバーやメモリ内の部屋Cookieだけで対応済みとはしない。導入を決める時点で用途と責務をADRへ記録する。

今回は読み取りとプロトコル確認のみ。アプリ実装・配備・購読・Webhook送信・有料AI呼出は行っていない。外部通信は公式ドキュメントの取得を行った。
