/** MCP Appと開発専用のローカルプレビューを共通インターフェースへ揃える。 */
import { App } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { HostState } from '../shared/contracts.js';
import type { AIStatus, AIResult } from '../shared/ai-contracts.js';

const aiStatusSchema = z.object({ configured: z.boolean(), available: z.boolean(), notice: z.string() });
const aiResultSchema = z.object({
  data: z.object({
    challengeId: z.string(), title: z.string(), description: z.string(),
    criteria: z.array(z.string()), durationSeconds: z.number().positive(),
    reference: z.object({ url: z.string(), author: z.string(), licenseName: z.string(), licenseUrl: z.string(), sourcePageUrl: z.string() }).optional(),
  }),
  serverTime: z.string(),
});

/** AI専用の応答をホストのサンプル部屋へ混ぜず検証する。 */
export function readAIResponse(result: Pick<CallToolResult, 'isError' | 'content' | 'structuredContent'>, kind: 'aiStatus'): AIStatus;
export function readAIResponse(result: Pick<CallToolResult, 'isError' | 'content' | 'structuredContent'>, kind: 'aiResult'): AIResult;
export function readAIResponse(result: Pick<CallToolResult, 'isError' | 'content' | 'structuredContent'>, kind: 'aiStatus' | 'aiResult'): AIStatus | AIResult {
  if (result.isError) {
    const content = result.content.find(item => item.type === 'text');
    throw new Error(content?.type === 'text' ? content.text : 'AI APIの操作に失敗しました。');
  }
  const payload = result.structuredContent?.[kind];
  const parsed = (kind === 'aiStatus' ? aiStatusSchema : aiResultSchema).safeParse(payload);
  if (!parsed.success) throw new Error('AI APIの応答形式が一致しません。');
  return parsed.data;
}

const submission = z.object({
  submissionId: z.string(), roundId: z.string(), teamId: z.string(),
  status: z.enum(['queued', 'judging', 'completed', 'failed']),
  outcome: z.enum(['pass', 'fail', 'uncertain']).nullable(), reasonCode: z.string().nullable(),
  awardedPoints: z.number(), acceptedAt: z.string(), processingExpiresAt: z.string(), completedAt: z.string().nullable(),
});
const stateSchema = z.object({
  mode: z.enum(['demo', 'unconfigured', 'sites']), notice: z.string(), serverTime: z.string().optional(),
  snapshot: z.object({
    room: z.object({
      roomId: z.string(), roomCode: z.string(), status: z.enum(['lobby', 'playing', 'finished']),
      version: z.number().int().nonnegative(), roundCount: z.number().int().positive().nullable(),
      roomName: z.string().optional(), joinUrl: z.string().url().optional(), scoreUnit: z.enum(['points', 'wins']).optional(),
      currentRound: z.object({
        roundId: z.string(), number: z.number().int(), status: z.enum(['pending', 'active', 'closing', 'result']),
        title: z.string(), instruction: z.string(), startsAt: z.string(), deadlineAt: z.string(), settleUntil: z.string(), hint: z.string().max(500).nullable().optional(),
      }).nullable(),
      teams: z.array(z.object({ teamId: z.string(), name: z.string() })),
      leaderboard: z.array(z.object({ teamId: z.string(), name: z.string(), score: z.number(), rank: z.number(), totalMs: z.number().nonnegative().optional() })),
      me: z.object({ teamId: z.string(), attemptsUsed: z.number(), passed: z.boolean(), latestSubmissionId: z.string().nullable() }).nullable(),
    }),
    topicsStatus: z.enum(['empty', 'generating', 'ready', 'failed']),
    preparedTopics: z.array(z.object({ number: z.number(), title: z.string(), instruction: z.string() })),
    teams: z.array(z.object({ teamId: z.string(), name: z.string(), lastSeenAt: z.string().nullable(), latestSubmission: submission.nullable() })),
    sites: z.object({
      aiAvailable: z.boolean(), gameMode: z.enum(['ai', 'demo']), canPrepare: z.boolean(), canStart: z.boolean(),
      canAdvance: z.boolean(), canEndRound: z.boolean(), canSetHint: z.boolean().optional(), pendingJudgments: z.number().nonnegative(), automaticLobbyStart: z.boolean(),
      stages: z.array(z.object({ number: z.number().int().positive(), status: z.enum(['completed', 'active', 'locked']) })).optional(),
    }).optional(),
  }).nullable(),
});

/** 通知・呼出結果の両方を検証し、不正なDTOで画面を破壊しない。 */
export function readHostState(result: Pick<CallToolResult, 'isError' | 'content' | 'structuredContent'>): HostState {
  if (result.isError) {
    const message = result.content.find(item => item.type === 'text');
    throw new Error(message?.type === 'text' ? message.text : '操作に失敗しました。');
  }
  const parsed = stateSchema.safeParse(result.structuredContent);
  if (!parsed.success) throw new Error('管理画面の応答形式が一致しません。接続先のバージョンを確認してください。');
  return parsed.data;
}

/** UIが必要とする最小限のツール接続。 */
export interface HostBridge {
  connect(onState: (state: HostState) => void): Promise<void>;
  call(name: string, args: Record<string, unknown>): Promise<HostState>;
  close(): Promise<void>;
  checkAI(): Promise<AIStatus>;
  generateAI(requestId: string): Promise<AIResult>;
}

/** 実ホストではMCP、preview.htmlでのみloopback開発ブリッジを使う。 */
export function createHostBridge(preview = false): HostBridge {
  if (preview) {
    /** ローカルプレビューも実MCPプロセスを通してAI APIに接続する。 */
    const request = async (name: string, args: Record<string, unknown>) => {
      const response = await fetch('/tool', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, arguments: args }), signal: AbortSignal.timeout(70000) });
      if (!response.ok) throw new Error('開発用MCPに接続できませんでした。');
      return response.json() as Promise<CallToolResult>;
    };
    return {
      async connect() {},
      async call(name, args) {
        return readHostState(await request(name, args));
      },
      async close() {},
      async checkAI() { return readAIResponse(await request('ai_status', {}), 'aiStatus'); },
      async generateAI(requestId) { return readAIResponse(await request('ai_generate_challenge', { requestId }), 'aiResult'); },
    };
  }
  const app = new App({ name: 'karimono-host-ui', version: '0.3.1' }, {});
  return {
    async connect(onState) {
      app.ontoolresult = result => {
        try { onState(readHostState(result)); } catch { /* 操作呼出側でエラーを表示する。 */ }
      };
      await app.connect(undefined, { timeout: 10000 });
    },
    async call(name, args) { return readHostState(await app.callServerTool({ name, arguments: args }, { timeout: 70000 })); },
    async close() { await app.close(); },
    async checkAI() { return readAIResponse(await app.callServerTool({ name: 'ai_status', arguments: {} }), 'aiStatus'); },
    async generateAI(requestId) { return readAIResponse(await app.callServerTool({ name: 'ai_generate_challenge', arguments: { requestId } }, { timeout: 40000 }), 'aiResult'); },
  };
}
