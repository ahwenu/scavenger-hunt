/** ホスト表示とMCPツールの接続・更新を組み立てる入口。 */
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HostDashboard } from './App.js';
import { createHostBridge, type HostBridge } from './bridge.js';
import type { HostAction, HostState } from '../shared/contracts.js';
import type { AIStatus, AIChallenge } from '../shared/ai-contracts.js';
import { AiPreview } from './AiPreview.js';

declare global { interface Window { __KARIMONO_PREVIEW__?: boolean } }

const initial: HostState = { mode: 'unconfigured', snapshot: null, notice: 'ホストのMCP接続を確認しています。' };

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

  /** 同一部屋の古いversionは適用しない。 */
  function apply(next: HostState) {
    if (!active.current) return;
    const previous = current.current.snapshot?.room;
    const room = next.snapshot?.room;
    if (previous && room?.roomId === previous.roomId && room.version < previous.version) return;
    current.current = next;
    setState(next);
  }

  useEffect(() => {
    active.current = true;
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
    void (async () => {
      try {
        await connection.connect(apply);
        apply(await connection.call('host_open', {}));
        try { const status = await connection.checkAI(); if (active.current) setAIStatus(status); } catch { /* 接続確認ボタンでも再取得できる。 */ }
        timer = setTimeout(poll, 2000);
      } catch (cause) {
        if (active.current) setError(cause instanceof Error ? cause.message : 'Plugin Extensionsから開いてください。');
      } finally { if (active.current) setBusy(false); }
    })();
    return () => { active.current = false; clearTimeout(timer); void connection.close(); };
  }, []);

  /** 管理操作ごとに冪等キーと現在のversionを送る。 */
  async function onAction(action: HostAction) {
    if (!bridge.current || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const room = current.current.snapshot?.room;
      const name = { create: 'host_create_room', refresh: room ? 'host_get_room' : 'host_open', prepare: 'host_prepare_topics', start: 'host_start', advance: 'host_advance', finish: 'host_finish' }[action];
      const args: Record<string, unknown> = action === 'create' ? { operationId: crypto.randomUUID() } : action === 'refresh' ? room ? { roomId: room.roomId } : {} : action === 'prepare' ? { roomId: room?.roomId, source: 'preset', operationId: crypto.randomUUID() } : { roomId: room?.roomId, expectedVersion: room?.version, operationId: crypto.randomUUID() };
      apply(await bridge.current.call(name, args));
    } catch (cause) { setError(cause instanceof Error ? cause.message : '操作に失敗しました。'); }
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
        if (active.current) setChallenge(result.data);
      } else {
        const status = await bridge.current.checkAI();
        if (active.current) setAIStatus(status);
      }
    } catch (cause) { if (active.current) setAIError(cause instanceof Error ? cause.message : 'AI APIに接続できませんでした。'); }
    finally { aiInFlight.current = false; if (active.current) setAIBusy(false); }
  }

  return <><HostDashboard state={state} busy={busy} error={error} onAction={onAction} /><AiPreview status={aiStatus} challenge={challenge} busy={aiBusy || busy} error={aiError} onCheck={() => void aiAction(false)} onGenerate={() => void aiAction(true)} /></>;
}

createRoot(document.getElementById('root')!).render(<HostController />);
