/** ホスト表示とMCPツールの接続・更新を組み立てる入口。 */
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HostDashboard } from './App.js';
import { createHostBridge, readInitialConnectionState, type HostBridge } from './bridge.js';
import type { HostAction, HostState } from '../shared/contracts.js';
import type { AIStatus, AIChallenge } from '../shared/ai-contracts.js';
import { AiPreview } from './AiPreview.js';
import { SoundCredits } from './SoundControls.js';
import { CompactDialog } from './CompactDialog.js';
import { hostSounds } from './sound-effects.js';
import { createGameSoundObserver } from './sound-events.js';
import type { InvitationFile } from './join-invitation.js';

declare global { interface Window { __KARIMONO_PREVIEW__?: boolean } }

const initial: HostState = { mode: 'unconfigured', snapshot: null, notice: 'ホストのMCP接続を確認しています。' };
const gameSounds = createGameSoundObserver(name => { void hostSounds.play(name); });

/** 古いポーリング応答を除き、部屋操作と定期更新を直列にする。 */
function HostController() {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const bridge = useRef<HostBridge | null>(null);
  const current = useRef(state);
  const inFlight = useRef(false);
  const active = useRef(true);
  const [aiStatus, setAIStatus] = useState<AIStatus | null>(null);
  const [challenge, setChallenge] = useState<AIChallenge | null>(null);
  const [aiBusy, setAIBusy] = useState(false);
  const [aiError, setAIError] = useState<string | null>(null);
  const aiInFlight = useRef(false);
  const serverOffset = useRef(0);
  const [toolsPanel, setToolsPanel] = useState<'ai' | 'credits' | null>(null);

  /** 同一部屋の古いversionは適用しない。 */
  function apply(next: HostState) {
    if (!active.current) return;
    const previous = current.current.snapshot?.room;
    const room = next.snapshot?.room;
    if (previous && room?.roomId === previous.roomId && room.version < previous.version) return;
    if (next.serverTime && Number.isFinite(Date.parse(next.serverTime))) serverOffset.current = Date.parse(next.serverTime) - Date.now();
    gameSounds.observe(room ? {
      roomId: room.roomId, roundId: room.currentRound?.roundId,
      phase: room.status === 'finished' ? 'finished' : room.currentRound?.status ?? room.status,
      ready: next.snapshot?.topicsStatus === 'ready',
      participants: next.snapshot?.teams.map(team => team.teamId),
      scores: room.leaderboard.map(team => ({ id: team.teamId, score: team.score })),
    } : null);
    current.current = next;
    setState(next);
  }

  useEffect(() => {
    active.current = true;
    /** 文字入力や定期同期では起動せず、ボタン操作で音声を有効化する。 */
    function gesture(event: MouseEvent) {
      const target = (event.target as Element | null)?.closest('button,summary');
      if (!target || target.matches(':disabled,.sound-toggle')) return;
      void hostSounds.unlock().then(unlocked => { if (unlocked) void hostSounds.play('tap'); });
    }
    document.addEventListener('click', gesture, true);
    const soundTimer = setInterval(() => {
      const round = current.current.snapshot?.room.currentRound;
      gameSounds.tick(round?.status === 'active' ? `round:${round.roundId}` : null, Date.parse(round?.deadlineAt ?? ''), Date.now() + serverOffset.current);
    }, 250);
    const connection = createHostBridge(window.__KARIMONO_PREVIEW__ === true);
    bridge.current = connection;
    let timer: ReturnType<typeof setTimeout>;
    /** 画面が存在する間だけ最新状態を取得し、操作と競合させない。 */
    async function poll() {
      if (!active.current) return;
      const room = current.current.snapshot?.room;
      if (room && !inFlight.current && document.visibilityState !== 'hidden') {
        inFlight.current = true;
        try { apply(await connection.call('host_get_room', { roomId: room.roomId })); setError(null); }
        catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : '状態の更新に失敗しました。'); }
        finally { inFlight.current = false; }
      }
      if (active.current) timer = setTimeout(poll, 2000);
    }
    setAIBusy(true);
    aiInFlight.current = true;
    void (async () => {
      let aiCheckStarted = false;
      try {
        await connection.connect(apply);
        const { host, ai } = readInitialConnectionState(connection);
        aiCheckStarted = true;
        void ai.then(result => {
          if (!active.current) return;
          if (result.status === 'fulfilled') setAIStatus(result.value);
          else setAIError(result.reason instanceof Error ? result.reason.message : 'AI APIに接続できませんでした。「API接続を確認」で再試行できます。');
        }).finally(() => { aiInFlight.current = false; if (active.current) setAIBusy(false); });
        const result = await host;
        if (result.status === 'fulfilled') apply(result.value);
        else if (active.current) setError(result.reason instanceof Error ? result.reason.message : '部屋の接続状態を取得できませんでした。');
      } catch (cause) {
        if (active.current) {
          const message = cause instanceof Error ? cause.message : 'Plugin Extensionsから開いてください。';
          setError(message);
          setAIError(message);
        }
      } finally {
        if (!aiCheckStarted) { aiInFlight.current = false; if (active.current) setAIBusy(false); }
        if (active.current) { timer = setTimeout(poll, 2000); setBusy(false); }
      }
    })();
    return () => { active.current = false; clearTimeout(timer); clearInterval(soundTimer); document.removeEventListener('click', gesture, true); hostSounds.stop(); gameSounds.observe(null); void connection.close(); };
  }, []);

  /** 管理操作ごとに冪等キーと現在のversionを送る。 */
  async function onAction(action: HostAction) {
    if (!bridge.current || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const room = current.current.snapshot?.room;
      const name = { create: 'host_create_room', refresh: room ? 'host_get_room' : 'host_open', prepare: 'host_prepare_topics', start: 'host_start', advance: 'host_advance', finish: 'host_finish' }[action];
      const args: Record<string, unknown> = action === 'create' ? { operationId: crypto.randomUUID() } : action === 'refresh' ? room ? { roomId: room.roomId } : {} : action === 'prepare' ? { roomId: room?.roomId, source: current.current.mode === 'sites' ? 'ai' : 'preset', operationId: crypto.randomUUID() } : { roomId: room?.roomId, expectedVersion: room?.version, operationId: crypto.randomUUID() };
      apply(await bridge.current.call(name, args));
      // 新しい状態を受け取るまでは接続エラーを維持し、復帰時に過去の順位差分を再演しない。
      setError(null);
      if (action === 'create') void hostSounds.play('join');
    } catch (cause) { void hostSounds.play('retry'); setError(cause instanceof Error ? cause.message : '操作に失敗しました。'); }
    finally { inFlight.current = false; if (active.current) setBusy(false); }
  }

  /** 受付中競技だけにホストの共通ヒントを保存し、ポーリングと二重送信を直列化する。 */
  async function onSetHint(roundId: string, text: string | null): Promise<void> {
    if (!bridge.current || inFlight.current) return;
    const room = current.current.snapshot?.room;
    if (current.current.mode !== 'sites' || !room || room.currentRound?.roundId !== roundId) return;
    inFlight.current = true;
    setBusy(true);
    try {
      apply(await bridge.current.call('host_set_hint', { roomId: room.roomId, roundId, text, expectedVersion: room.version, operationId: crypto.randomUUID() }));
      setError(null);
      void hostSounds.play('submit');
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : '共通ヒントを保存できませんでした。'); }
    finally { inFlight.current = false; if (active.current) setBusy(false); }
  }

  /** 生成APIを明示操作でだけ実行し、部屋データのデモとは分離する。 */
  async function aiAction(generate: boolean) {
    if (!bridge.current || aiInFlight.current) return;
    aiInFlight.current = true;
    setAIBusy(true);
    setAIError(null);
    try {
      if (generate) {
        const result = await bridge.current.generateAI(crypto.randomUUID());
        if (active.current) { setChallenge(result.data); void hostSounds.play('ready'); }
      } else {
        const status = await bridge.current.checkAI();
        if (active.current) setAIStatus(status);
      }
    } catch (cause) { if (active.current) { void hostSounds.play('retry'); setAIError(cause instanceof Error ? cause.message : 'AI APIに接続できませんでした。'); } }
    finally { aiInFlight.current = false; if (active.current) setAIBusy(false); }
  }

  /** 配布画像をSitesやAIへ送らず、ユーザーが選んだ保存操作へ渡す。 */
  async function onDownloadInvitation(file: InvitationFile): Promise<void> {
    if (!bridge.current) throw new Error('ホスト接続を確認してください。');
    await bridge.current.downloadInvitation(file);
  }

  return <><HostDashboard state={state} busy={busy} error={error} onAction={onAction} onSetHint={onSetHint} onOpenAI={() => setToolsPanel('ai')} onOpenCredits={() => setToolsPanel('credits')} onDownloadInvitation={onDownloadInvitation} />{toolsPanel === 'ai' && <CompactDialog title="独立AIのお題プレビュー" onClose={() => setToolsPanel(null)}><AiPreview status={aiStatus} challenge={challenge} busy={aiBusy} error={aiError} onCheck={() => void aiAction(false)} onGenerate={() => void aiAction(true)} /></CompactDialog>}{toolsPanel === 'credits' && <CompactDialog title="効果音の出典" onClose={() => setToolsPanel(null)}><SoundCredits /></CompactDialog>}</>;
}

createRoot(document.getElementById('root')!).render(<HostController />);
