/** ホスト拡張のMCPツールと、配布物内のHTMLリソースを登録する。 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { OpenAIUiResourceMetadataSchema, OpenAIUiToolMetadataSchema } from '@openai/mcp-extensions';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { HostState } from '../shared/contracts.js';
import { DemoHostAdapter, HostOperationError, NotConfiguredHostAdapter, type HostAction, type HostInput } from './adapters.js';
import { AiServiceClient, AiServiceError, type AiServiceOptions } from './ai-client.js';
import { SitesHostAdapter, type SitesAdapterOptions } from './sites-adapter.js';

export const HOST_RESOURCE_URI = 'ui://scavenger-hunt/host-v1';

export interface ServerOptions {
  mode?: 'demo' | 'unconfigured' | 'sites';
  htmlPath?: string;
  now?: () => number;
  ai?: AiServiceOptions;
  sites?: SitesAdapterOptions;
}

/** Node起動元に依存せず、同じdistディレクトリ内のHTMLを開く。 */
export function createServer(options: ServerOptions = {}): McpServer {
  const mode = options.mode ?? process.env.KARIMONO_MODE ?? 'unconfigured';
  if (mode !== 'demo' && mode !== 'unconfigured' && mode !== 'sites') {
    throw new Error('KARIMONO_MODE must be demo, unconfigured or sites.');
  }
  const adapter = mode === 'sites' ? new SitesHostAdapter(options.sites) : mode === 'demo' ? new DemoHostAdapter(options.now) : new NotConfiguredHostAdapter();
  const htmlPath = options.htmlPath ?? fileURLToPath(new URL('./widget.html', import.meta.url));
  const server = new McpServer({ name: 'karimono-host', version: '0.2.0' });
  const ai = new AiServiceClient(options.ai);

  registerAppResource(server, 'カリモノ ホスト画面', HOST_RESOURCE_URI, {}, async () => ({
    contents: [{
      uri: HOST_RESOURCE_URI,
      mimeType: RESOURCE_MIME_TYPE,
      text: await readFile(htmlPath, 'utf8'),
      _meta: {
        ui: { csp: { connectDomains: [], resourceDomains: [] } },
        'openai/ui': OpenAIUiResourceMetadataSchema.parse({
          preferredDisplayMode: 'fullscreen', availableDisplayModes: ['inline', 'fullscreen'],
        }),
      },
    }],
  }));

  /** 各操作の例外を、安全なDTOと固定文言のツールエラーへ変換する。 */
  const handle = (action: HostAction) => async (input: HostInput): Promise<CallToolResult> => {
    try {
      const state = await adapter.execute(action, input);
      return result(state);
    } catch (error) {
      const code = error instanceof HostOperationError ? error.code : 'INTERNAL_ERROR';
      const message = error instanceof HostOperationError ? error.message : '操作に失敗しました。再度お試しください。';
      return {
        isError: true,
        content: [{ type: 'text', text: `${code}: ${message}` }],
        structuredContent: {
          mode, snapshot: null, notice: `${code}: ${message}`,
          serverTime: new Date(options.now?.() ?? Date.now()).toISOString(),
        },
      };
    }
  };
  const roomId = z.string().min(1).max(200);
  const operationId = z.string().uuid();
  const expectedVersion = z.number().int().min(1);
  const mutation = { readOnlyHint: false, destructiveHint: false, openWorldHint: mode === 'sites' };
  const appOnly = { ui: { visibility: ['app'] } } as const;

  registerAppTool(server, 'ai_status', {
    title: 'AI APIの接続を確認', description: '独立AI APIの利用可否を確認する。部屋やデモ状態は変更しない。',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }, _meta: appOnly,
  }, async () => {
    const aiStatus = await ai.status();
    return { content: [{ type: 'text', text: aiStatus.notice }], structuredContent: { aiStatus } };
  });
  registerAppTool(server, 'ai_generate_challenge', {
    title: 'AIでお題を生成', description: 'Ahwenu担当APIでお題候補を一つ生成する。有料APIを呼び出すが、部屋や順位へは反映しない。',
    inputSchema: { requestId: z.string().uuid() },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, _meta: appOnly,
  }, async ({ requestId }) => {
    try {
      const aiResult = await ai.generateChallenge(requestId);
      return { content: [{ type: 'text', text: 'AIのお題候補を生成しました。ゲームには未反映です。' }], structuredContent: { aiResult } };
    } catch (error) {
      const safe = error instanceof AiServiceError ? error : new AiServiceError('UNAVAILABLE');
      return {
        isError: true, content: [{ type: 'text', text: safe.message }],
        structuredContent: { aiError: { code: safe.code, message: safe.message } },
      };
    }
  });

  // OpenAIExtensionsのコンストラクターは設定・メンション・入力フォーム用。
  // この画面はUIメタデータだけを利用し、未使用の拡張機能を宣言しない。
  registerAppTool(server, 'host_open', {
    title: 'カリモノを開く',
    description: 'Plugin Extensions内にホスト画面を開く。Sites実接続・未接続・デモを区別する。',
    inputSchema: { roomId: roomId.optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: {
      ui: { resourceUri: HOST_RESOURCE_URI },
      'openai/ui': OpenAIUiToolMetadataSchema.parse({ entrypoints: [{ type: 'global' }, { type: 'thread' }] }),
    },
  }, handle('open'));
  registerAppTool(server, 'host_create_room', {
    title: '部屋を作成', description: '部屋作成の接続境界。デモの場合はメモリ上のサンプル部屋を作る。',
    inputSchema: { operationId }, annotations: mutation, _meta: appOnly,
  }, handle('create_room'));
  registerAppTool(server, 'host_get_room', {
    title: 'ホスト状態を取得', inputSchema: { roomId },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }, _meta: appOnly,
  }, handle('get_room'));
  registerAppTool(server, 'host_prepare_topics', {
    title: 'お題を準備', description: 'Sites接続ではAI、デモではプリセットだけ利用可能。SitesのAIお題生成は有料APIを呼ぶ。',
    inputSchema: { roomId, operationId, source: z.enum(['ai', 'preset']) }, annotations: mutation, _meta: appOnly,
  }, handle('prepare_topics'));
  for (const [name, action, title] of [
    ['host_start', 'start', 'ゲームを開始'],
    ['host_advance', 'advance', '次のお題へ進む'],
    ['host_finish', 'finish', 'ゲームを終了'],
  ] as const) {
    registerAppTool(server, name, {
      title: mode === 'sites' && action === 'finish' ? '現在ラウンドの受付を終了' : title,
      description: mode === 'sites' ? action === 'finish' ? 'Sitesの現在ラウンドだけ受付を終了する。部屋全体の終了ではない。' : 'Sitesの実AIゲームを進める。お題準備状況によって有料AIの生成を伴う。' : undefined,
      inputSchema: { roomId, expectedVersion, operationId }, annotations: mutation, _meta: appOnly,
    }, handle(action));
  }
  registerAppTool(server, 'host_purge_images', {
    title: '提出写真を削除', description: '終了後の写真削除の接続境界。デモでは写真を保持していない。',
    inputSchema: { roomId, operationId },
    annotations: { ...mutation, destructiveHint: true }, _meta: appOnly,
  }, handle('purge_images'));
  return server;
}

/** ツール本文とstructuredContentに、秘密値を含まない同一状態を載せる。 */
function result(state: HostState): CallToolResult {
  return { content: [{ type: 'text', text: state.notice }], structuredContent: { ...state } };
}
