/** カリモノのホスト用表示。通信とゲーム操作は呼び出し元へ委譲する。 */
import type { HostAction, HostState } from '../shared/contracts.js';
import { useEffect, useState } from 'react';
import { JoinQr } from './JoinQr.js';
import { SoundToggle } from './SoundControls.js';
import { CompactDialog, TextPager } from './CompactDialog.js';
import { RankingBoard } from './RankingBoard.js';
import girlFlag from './assets/girl-flag.png';
import robotFlag from './assets/robot-flag.png';
import crown from './assets/crown.png';
import flagBlue from './assets/flag-blue.png';
import './styles.css';

export type { HostAction } from '../shared/contracts.js';
export interface HostDashboardProps {
  state: HostState;
  busy: boolean;
  error: string | null;
  onAction: (action: HostAction) => void;
  onSetHint?: (roundId: string, text: string | null) => Promise<void>;
  onOpenAI?: () => void;
  onOpenCredits?: () => void;
}

type MainTab = 'game' | 'invite' | 'ranking' | 'teams';
type DetailPanel = 'notice' | 'topic' | 'hint' | 'stages' | 'team' | null;
const roomLabels = { lobby: '参加受付中', playing: 'ゲーム進行中', finished: 'ゲーム終了' };
const roundLabels = { pending: '準備中', active: '写真受付中', closing: '判定を確定中', result: '結果発表' };
const topicLabels = { empty: '未準備', generating: '生成中', ready: '準備完了', failed: '準備失敗' };

/** 通信時刻を端末の表示地域に合わせ、未取得・無効値を区別する。 */
function communicationTime(value: string | null): string {
  if (!value) return '未取得';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '未取得' : date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** 提出の処理中と写真の合否を分けて表示する。 */
function submissionLabel(submission: NonNullable<HostState['snapshot']>['teams'][number]['latestSubmission']): string {
  if (!submission) return '提出なし';
  if (submission.status === 'failed') return '判定処理に失敗';
  if (submission.status === 'queued') return '判定待ち';
  if (submission.status === 'judging') return '判定中';
  return submission.outcome ? { pass: '条件クリア', fail: '条件に合わない', uncertain: '写真が不鮮明' }[submission.outcome] : '判定結果を確認中';
}

/** 入力途中の文を同期で消さず、保存済みの長文は別ページで確認する。 */
function CommonHint({ roundId, saved, enabled, busy, error, onSave }: { roundId: string; saved?: string | null; enabled: boolean; busy: boolean; error: string | null; onSave?: (roundId: string, text: string | null) => Promise<void> }) {
  const [draft, setDraft] = useState(saved ?? '');
  const [view, setView] = useState<'edit' | 'saved' | 'error'>('edit');
  useEffect(() => { if (error) setView('error'); }, [error]);
  const disabled = !enabled || busy || !onSave;
  return <div className="common-hint">
    <nav className="detail-tabs" aria-label="ヒント表示"><button aria-pressed={view === 'edit'} onClick={() => setView('edit')}>編集する</button><button aria-pressed={view === 'saved'} onClick={() => setView('saved')}>保存を確認</button>{error && <button aria-pressed={view === 'error'} onClick={() => setView('error')}>操作エラー</button>}</nav>
    {view === 'edit' ? <>
      <label htmlFor="common-hint-text">全員に共通のヒント</label>
      <p className="helper">写真受付中に保存できます。AIは呼び出しません。</p>
      <textarea id="common-hint-text" maxLength={500} rows={4} value={draft} disabled={disabled} onChange={event => setDraft(event.target.value)} placeholder="例：机やかばんの中を探してみよう" />
      <span className="helper">{draft.length} / 500文字{!enabled && ' · 現在は編集できません'}</span>
      <div className="hint-actions"><button className="button button-secondary" disabled={disabled || !draft.trim()} onClick={() => void onSave?.(roundId, draft.trim())}>{busy ? '処理中…' : '保存'}</button><button className="button button-quiet" disabled={disabled} onClick={() => void onSave?.(roundId, null)}>削除</button></div>
    </> : view === 'error' ? <TextPager label="ヒント操作のエラー" text={error ?? 'エラーはありません。'} /> : <TextPager label="保存済みヒント" text={saved === undefined ? '保存済みヒントをまだ取得していません。' : saved === null ? 'この競技のヒントは削除済みです。' : `保存を確認したヒント：${saved}`} />}
  </div>;
}

/** 安全な状態DTOだけを使い、狭い画面では操作面を切り替えて表示する。 */
export function HostDashboard({ state, busy, error, onAction, onSetHint, onOpenAI, onOpenCredits }: HostDashboardProps) {
  const [tab, setTab] = useState<MainTab>('game');
  const [panel, setPanel] = useState<DetailPanel>(null);
  const [teamPage, setTeamPage] = useState(0);
  const [selectedTeam, setSelectedTeam] = useState('');
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1080px) and (min-height: 620px)').matches);
  const [rows, setRows] = useState(() => typeof window !== 'undefined' && window.innerHeight < 650 ? 3 : 5);
  useEffect(() => {
    /** 画面の幅と高さから同時表示する情報量を選ぶ。 */
    function resize() { setWide(window.matchMedia('(min-width: 1080px) and (min-height: 620px)').matches); setRows(window.innerHeight < 650 ? 3 : 5); }
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const snapshot = state.snapshot;
  const room = snapshot?.room;
  const round = room?.currentRound;
  const isDemo = state.mode === 'demo';
  const isSites = state.mode === 'sites';
  const sites = snapshot?.sites;
  const canStart = isSites ? sites?.canStart === true : room?.status === 'lobby' && snapshot?.topicsStatus === 'ready' && snapshot.teams.length > 0;
  const canAdvance = isSites ? sites?.canAdvance === true : room?.status === 'playing' && round?.status === 'result' && room.roundCount !== null && round.number < room.roundCount;
  const canFinish = isSites ? sites?.canEndRound === true : room?.status === 'playing';
  const canPrepare = (room?.status === 'lobby' || isSites && sites?.canPrepare) && snapshot?.topicsStatus !== 'ready';
  const readyTeams = snapshot?.teams.filter(team => team.latestSubmission?.outcome === 'pass').length ?? 0;
  const notice = state.notice || (isDemo ? '画面確認用デモです。参加者・得点はサンプルです。' : 'Sites APIの接続設定が必要です。');
  const teamPages = Math.max(1, Math.ceil((snapshot?.teams.length ?? 0) / rows));
  const currentTeamPage = Math.min(teamPage, teamPages - 1);
  const team = snapshot?.teams.find(item => item.teamId === selectedTeam);
  const showOverview = wide && tab !== 'teams';
  const waitingForPlayers = isSites && room?.status === 'lobby' && snapshot?.teams.length === 0;
  const gameHelp = isSites ? room?.status === 'finished' ? '全競技が終了しました。最終ランキングを確認してください。' : !sites?.aiAvailable ? 'Sites側のAI設定が必要です。デモへは切り替えません。' : sites?.gameMode !== 'ai' ? '実AIモードへの変更が必要です。' : waitingForPlayers ? '招待タブのQRから1人以上参加すると、AIのお題を準備できます。' : canAdvance ? '次のお題を生成して開始します。有料のAI呼び出しを伴う場合があります。' : '受付終了は現在ラウンドだけに適用します。部屋全体の終了APIは未実装です。' : canStart ? '全員の準備ができたら開始してください。' : room?.status === 'lobby' ? '参加チームとお題の準備が必要です。' : '写真の受付・判定が終わったら、次のお題へ進めます。';

  return <main className={`host-app compact-host ${room ? 'has-room' : 'no-room'}`} aria-busy={busy}>
    <header className="masthead">
      <div className="brand"><span className="brand-mark" aria-hidden="true"><img src={crown} alt="" width="30" height="25" /></span><div><p className="eyebrow">ONE LEASE / 運営本部</p><h1>カリモノ</h1></div></div>
      <div className="header-tools"><SoundToggle /><button className="utility-button" onClick={onOpenAI}>AI確認</button><button className="utility-button credit-button" onClick={onOpenCredits}>出典</button></div>
    </header>
    <div className={`connection-strip ${error ? 'connection-error' : ''}`}>
      <span className={`mode-badge ${isDemo ? 'mode-demo' : ''}`}>{isDemo ? 'DEMO / 見本' : isSites ? 'SITES' : '未接続'}</span>
      <p role={error ? 'alert' : 'status'}>{error ? `操作エラー：${error}` : notice}</p>
      <button onClick={() => setPanel('notice')}>詳細</button>
    </div>
    {!room || !snapshot ? <section className="empty-room surface">
      <div className="welcome-art" aria-hidden="true"><img src={girlFlag} alt="" /><img src={robotFlag} alt="" /></div>
      <span className="section-kicker">借り物王に俺はなる！</span><h2>運動会、はじめよう！</h2>
      <p>みんなの挑戦を、ここから進めよう。</p>
      <button className="button button-primary" disabled={busy || (!isDemo && !isSites)} onClick={() => onAction('create')}>{busy ? '処理中…' : isDemo ? 'デモの部屋を作る' : '部屋を作る'} ↗</button>
      {(isSites || error) && <button className="button button-quiet" disabled={busy} onClick={() => onAction('refresh')}>{error ? '接続を再試行' : '接続状態を再取得'}</button>}
      <ol className="welcome-steps" aria-label="開催の流れ"><li><b>1</b>部屋をつくる</li><li><b>2</b>集合</li><li><b>3</b>開始！</li></ol>
    </section> : <>
      <section className="room-bar surface" aria-label="現在の部屋">
        <div className="room-identity"><h2 className="room-code" title={isSites ? room.roomName : room.roomCode}>{isSites ? room.roomName : room.roomCode}</h2><span className="room-detail">{snapshot.teams.length}{isSites ? '人' : 'チーム'} · {roomLabels[room.status]}</span></div>
        <button className="button button-quiet create-room-button" aria-label={isDemo ? '新しいデモの部屋を作る' : '新しい部屋を作る'} disabled={busy} onClick={() => onAction('create')}>＋ 新しい部屋</button>
        <button className="button button-quiet refresh-button" disabled={busy} onClick={() => onAction('refresh')}>{busy ? '取得中…' : '↻ 更新'}</button>
      </section>
      <nav className="main-tabs" aria-label="ホスト画面の切り替え">
        {([['game', '進行'], ...(isSites ? [['invite', '招待']] : []), ['ranking', '順位'], ['teams', `参加者 ${snapshot.teams.length}`]] as [MainTab, string][]).map(([value, label]) => <button key={value} type="button" aria-pressed={tab === value} onClick={() => setTab(value)}>{label}</button>)}
      </nav>
      <div className={`game-stage ${showOverview ? 'overview' : 'single-panel'} ${isSites ? 'with-invite' : ''}`}>
        {isSites && <section className="join-panel surface" aria-labelledby="join-heading" hidden={!showOverview && tab !== 'invite'}>
          <div className="section-heading"><span className="section-kicker">みんなを招待</span><span className="small-tag">JOIN</span></div><h2 id="join-heading">QRで、集合！</h2>
          {room.joinUrl ? <><div className="join-content"><JoinQr url={room.joinUrl} /></div><a className="join-url" href={room.joinUrl} target="_blank" rel="noreferrer">参加ページを開く ↗</a><button className="text-button" onClick={() => setPanel('notice')}>参加URL・部屋の詳細</button></> : <TextPager text="実AIの接続準備が完了するまで参加URLを表示しません。Sitesの設定後に新しい部屋を作成してください。" />}
        </section>}
        <section className="topic-panel surface" aria-labelledby="topic-heading" hidden={!showOverview && tab !== 'game'}>
          <div className="section-heading"><span className="section-kicker">{room.status === 'finished' ? 'ゲーム終了' : round ? roundLabels[round.status] : 'ゲームの進行'}</span><button className="small-tag" onClick={() => setPanel('stages')}>{round ? `第${round.number}問` : '準備中'}{room.roundCount !== null && ` / ${room.roundCount}`} ›</button></div>
          <button className="topic-summary" onClick={() => setPanel('topic')} aria-label="お題と進行案内の全文を開く"><h2 id="topic-heading">{room.status === 'finished' ? 'おつかれさまでした！' : round?.title ?? '次の借り物王は、誰だ。'}</h2><span>{waitingForPlayers ? '招待タブのQRから1人以上参加すると、AIのお題を準備できます。' : 'お題・案内の全文を見る ›'}</span></button>
          <div className="topic-metrics"><div><span>お題</span><strong>{topicLabels[snapshot.topicsStatus]}</strong></div><div><span>{isSites && round ? '判定待ち' : round ? '条件クリア' : '参加者'}</span><strong>{isSites && round ? `${sites?.pendingJudgments ?? 0}件` : round ? `${readyTeams} / ${snapshot.teams.length}` : `${snapshot.teams.length}${isSites ? '人' : 'チーム'}`}</strong></div>{round && <div><span>受付締切</span><strong>{communicationTime(round.deadlineAt)}</strong></div>}</div>
          <div className="host-actions">
            {canPrepare && <button className="button button-secondary" disabled={busy || (!isDemo && !(isSites && sites?.canPrepare)) || snapshot.topicsStatus === 'generating'} onClick={() => onAction('prepare')}>{isSites ? 'AIのお題を準備' : 'お題を準備（デモ）'}</button>}
            {room.status === 'lobby' && <button className="button button-primary" disabled={busy || !canStart} onClick={() => onAction('start')}>ゲーム開始 →</button>}
            {room.status === 'playing' && <button className="button button-primary" disabled={busy || !canAdvance} onClick={() => onAction('advance')}>{isSites && canAdvance ? 'AIで次のお題へ →' : '次のお題へ →'}</button>}
            {room.status === 'playing' && <button className="button button-danger" disabled={busy || !canFinish} onClick={() => onAction('finish')}>{isSites ? 'ラウンドの受付を終了' : 'ゲーム終了'}</button>}
            {isSites && room.status !== 'finished' && <button className="button button-quiet" onClick={() => setPanel('hint')}>共通ヒント {round?.hint ? 'あり' : '編集'} ›</button>}
          </div>
        </section>
        <div className="ranking-slot" hidden={!showOverview && tab !== 'ranking'}><RankingBoard room={room} mode={state.mode} connected={!error && state.mode !== 'unconfigured'} active={showOverview || tab === 'ranking'} /></div>
        <section className="teams-panel surface" aria-labelledby="teams-heading" hidden={tab !== 'teams'}>
          <div className="section-heading"><h2 id="teams-heading"><img className="heading-icon" src={flagBlue} alt="" width="25" height="26" />{isSites ? '参加者' : '参加チーム'} <span className="count-label">{snapshot.teams.length}</span></h2><span className="small-tag">名簿</span></div>
          {snapshot.teams.length ? <ul className="teams-list">{snapshot.teams.slice(currentTeamPage * rows, (currentTeamPage + 1) * rows).map((item, index) => <li key={item.teamId}><span className="team-avatar" aria-hidden="true">{String(currentTeamPage * rows + index + 1).padStart(2, '0')}</span><button className="team-name" onClick={() => { setSelectedTeam(item.teamId); setPanel('team'); }}><strong>{item.name}</strong><span>{isSites ? '参加登録済み · 詳細 ›' : `${submissionLabel(item.latestSubmission)} · 詳細 ›`}</span></button></li>)}</ul> : <p className="inline-empty">参加者はまだいません。</p>}
          <nav className="pagination" aria-label="参加者のページ"><button disabled={!currentTeamPage} onClick={() => setTeamPage(currentTeamPage - 1)}>← 前</button><span aria-live="polite">{currentTeamPage + 1} / {teamPages}</span><button disabled={currentTeamPage >= teamPages - 1} onClick={() => setTeamPage(currentTeamPage + 1)}>次 →</button></nav>
          <p className="helper">名前を選ぶと全文と取得できた状況を確認できます。</p>
        </section>
      </div>
    </>}
    <footer className="footer"><span>借り物王に俺はなる！</span><button className="text-button" onClick={onOpenCredits}>効果音の出典</button></footer>
    {panel === 'notice' && <CompactDialog title={error ? '通信・操作の詳細' : '接続・部屋の詳細'} onClose={() => setPanel(null)}><TextPager text={[error && `操作できませんでした：${error}\n表示情報が古い可能性があります。「更新」で最新状態を確認してください。`, notice, room && `部屋名：${room.roomName ?? room.roomCode}\n部屋ID：${room.roomId}`, room?.joinUrl && `参加URL：${room.joinUrl}`, isDemo && '部屋コード・参加者・得点はデモ用です。スマホから参加できません。', sites?.automaticLobbyStart && '参加者が登録されると、Sites側で初回のお題準備・開始が自動進行します。'].filter(Boolean).join('\n\n')} />{room?.joinUrl && <a className="button button-quiet" href={room.joinUrl} target="_blank" rel="noreferrer">参加ページを開く ↗</a>}<button className="button button-secondary" disabled={busy} onClick={() => onAction('refresh')}>最新状態を取得</button></CompactDialog>}
    {panel === 'topic' && <CompactDialog title="お題・進行案内" onClose={() => setPanel(null)}><TextPager text={[round?.title ?? '次の借り物王は、誰だ。', round?.instruction ?? '参加者とお題の準備を確認してください。', gameHelp].join('\n\n')} /></CompactDialog>}
    {panel === 'stages' && <CompactDialog title="全競技の進行" onClose={() => setPanel(null)}>{sites?.stages ? <ol className="stage-progress">{sites.stages.map(stage => <li key={stage.number} className={`stage-${stage.status}`} aria-current={stage.status === 'active' ? 'step' : undefined}><b>第{stage.number}競技</b><span>{{ completed: '完了', active: '進行中', locked: '未解放' }[stage.status]}</span></li>)}</ol> : <TextPager text={room?.roundCount === null ? '問題数の上限はありません。' : `全${room?.roundCount ?? 0}問です。現在は${round ? `第${round.number}問` : '準備中'}です。`} />}</CompactDialog>}
    {panel === 'hint' && <CompactDialog title="共通ヒント" onClose={() => setPanel(null)}><CommonHint key={round?.roundId ?? 'waiting'} roundId={round?.roundId ?? ''} saved={round?.hint} enabled={sites?.canSetHint === true && room?.status !== 'finished'} busy={busy} error={error} onSave={onSetHint} /></CompactDialog>}
    {panel === 'team' && team && <CompactDialog title="参加者の詳細" onClose={() => setPanel(null)}><TextPager text={`${team.name}\n\n${isSites ? '参加登録済み。Sitesの集計APIには個別の最終通信・最新提出結果が含まれません。接続中や提出なしとは判定していません。' : `最終通信 ${communicationTime(team.lastSeenAt)}\n${submissionLabel(team.latestSubmission)}\n最終通信は取得した記録であり、接続中を保証しません。`}`} /></CompactDialog>}
  </main>;
}
export default HostDashboard;
