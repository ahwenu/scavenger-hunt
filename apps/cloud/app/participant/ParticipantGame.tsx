'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { ArrowLeft, BookOpen, Camera, ChevronRight, Clock3, Flag, Home, Lightbulb, LockKeyhole, RotateCcw, Sparkles, Trophy } from 'lucide-react';
import { getHint, getState, joinRoom, safeReferenceUrl, submitPhoto, toSubmissionJpeg, type GameState } from './api';

type View = 'home' | 'challenge' | 'judging' | 'success' | 'failure' | 'stages' | 'ranking' | 'rules';
const views: { key: View; label: string }[] = [
  { key: 'home', label: '① スタート' }, { key: 'challenge', label: '② お題' },
  { key: 'judging', label: '③ 判定中' }, { key: 'success', label: '④ 成功' },
  { key: 'failure', label: '⑤ 失敗' }, { key: 'stages', label: '⑥ ステージ' },
  { key: 'ranking', label: '⑦ ランキング' }, { key: 'rules', label: '⑧ 遊び方' },
];
const fixture: GameState = {
  room: { id: 'preview', name: '秋の大運動会' }, mode: 'ai', serverTime: Date.now(),
  lobby: { status: 'started' },
  players: [{ id: 'me', name: 'まえ', joinedAt: Date.now() - 50000 }],
  ranks: [
    { id: 'a', name: 'さおり', joinedAt: 1, wins: 3 },
    { id: 'b', name: 'ねこ', joinedAt: 2, wins: 2 },
    { id: 'c', name: 'ハナキン', joinedAt: 3, wins: 2 },
    { id: 'd', name: 'ChatGPT', joinedAt: 4, wins: 1 },
    { id: 'e', name: 'あおい', joinedAt: 5, wins: 1 },
    { id: 'me', name: 'まえ', joinedAt: 6, wins: 1 },
  ],
  round: { id: 'sample', number: 1, mode: 'ai', status: 'active', challenge: { title: '赤くて丸いものを探せ！', description: '会場で見つけて写真を撮ろう。' }, startedAt: Date.now(), endsAt: Date.now() + 30000 },
  mine: [], stats: { players: 6, answered: 3, accepted: 3, pending: 0 },
};

function formatTime(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function GameButton({ children, onClick, tone = 'pink', disabled = false, className = '' }: {
  children: React.ReactNode; onClick: () => void; tone?: 'pink' | 'blue' | 'yellow' | 'white'; disabled?: boolean; className?: string;
}) {
  return <button type="button" className={`game-button game-button--${tone} ${className}`} onClick={onClick} disabled={disabled}>{children}</button>;
}

export function ParticipantGame({ preview = false }: { preview?: boolean }) {
  const [roomId, setRoomId] = useState('');
  const [token, setToken] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [state, setState] = useState<GameState | null>(preview ? fixture : null);
  const [view, setView] = useState<View>('home');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState('');
  const [requestId, setRequestId] = useState('');
  const [hint, setHint] = useState('');
  const [hintError, setHintError] = useState('');
  const [hintVisible, setHintVisible] = useState(false);
  const [hintBusy, setHintBusy] = useState(false);
  const [now, setNow] = useState(0);
  const [serverOffset, setServerOffset] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastSubmission = useRef('');
  const lastRound = useRef('');
  const latestState = useRef<GameState | null>(state);

  useEffect(() => {
    if (preview) return;
    const match = location.pathname.match(/^\/rooms\/([a-zA-Z0-9-]+)\/join\/?$/);
    queueMicrotask(() => {
      if (!match) { setError('参加リンクを確認してください。'); return; }
      const id = match[1];
      setRoomId(id);
      setToken(localStorage.getItem(`karimono:${id}:token`) ?? '');
      setPlayerId(localStorage.getItem(`karimono:${id}:id`) ?? '');
    });
  }, [preview]);

  const refresh = useCallback(async () => {
    if (preview || !roomId) return;
    try {
      const next = await getState(roomId, token);
      const nextRound = next.round?.id ?? '';
      if (nextRound && lastRound.current && lastRound.current !== nextRound) {
        setView('challenge'); setPhoto(null); setRequestId(''); setPhotoUrl('');
        setHint(''); setHintError(''); setHintVisible(false);
      }
      if (nextRound) lastRound.current = nextRound;
      const ownLatest = next.mine.filter(item => item.roundId === nextRound).at(-1);
      const marker = ownLatest ? `${ownLatest.id}:${ownLatest.status}` : '';
      if (ownLatest && marker !== lastSubmission.current) {
        lastSubmission.current = marker;
        if (['uploading', 'queued', 'processing', 'retrying', 'pending'].includes(ownLatest.status)) setView('judging');
        else if (ownLatest.status === 'accepted') setView('success');
        else if (ownLatest.status === 'rejected') setView('failure');
        else if (['error', 'failed'].includes(ownLatest.status)) { setError(ownLatest.verdict?.reason || '判定できませんでした。'); setView('failure'); }
      }
      latestState.current = next;
      setServerOffset(next.serverTime - Date.now());
      setState(next);
      setConnectionError(false);
    } catch (cause) {
      setConnectionError(true);
      if (!latestState.current) setError(cause instanceof Error ? cause.message : '部屋を読み込めません。');
    }
  }, [preview, roomId, token]);

  useEffect(() => {
    if (preview || !roomId) return;
    queueMicrotask(() => { void refresh(); });
    const poll = setInterval(() => { if (!document.hidden) void refresh(); }, 1800);
    const wake = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', wake);
    return () => { clearInterval(poll); document.removeEventListener('visibilitychange', wake); };
  }, [preview, roomId, refresh]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  const round = state?.round ?? null;
  const mine = state?.mine.filter(item => item.roundId === round?.id) ?? [];
  const latest = mine.at(-1);
  const joined = preview || Boolean(state?.players.some(player => player.id === playerId));
  const joinedAt = state?.players.find(player => player.id === playerId)?.joinedAt ?? 0;
  const myRank = state?.ranks.findIndex(player => player.id === (preview ? 'me' : playerId)) ?? -1;
  const secondsLeft = round?.status === 'active' ? Math.max(0, Math.ceil((round.endsAt - now - serverOffset) / 1000)) : 0;
  const currentStatus = latest?.status ?? '';
  const pending = ['uploading', 'queued', 'processing', 'retrying', 'pending'].includes(currentStatus);
  const accepted = currentStatus === 'accepted';
  const canCapture = joined && Boolean(round && (preview || joinedAt <= round.startedAt) && round.status === 'active' && secondsLeft > 0 && !pending && !accepted && !busy);
  const reference = !preview && roomId ? safeReferenceUrl(roomId, round) : '';

  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);

  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!roomId || !name.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const joinedPlayer = await joinRoom(roomId, name.trim());
      localStorage.setItem(`karimono:${roomId}:token`, joinedPlayer.token);
      localStorage.setItem(`karimono:${roomId}:id`, joinedPlayer.id);
      setToken(joinedPlayer.token); setPlayerId(joinedPlayer.id);
      setView('home');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '参加できませんでした。'); }
    finally { setBusy(false); }
  }

  async function handlePhoto(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = '';
    if (!selected || !canCapture) return;
    setBusy(true); setError('');
    try {
      const jpeg = await toSubmissionJpeg(selected);
      if (photoUrl) URL.revokeObjectURL(photoUrl);
      const nextUrl = URL.createObjectURL(jpeg);
      setPhoto(jpeg); setPhotoUrl(nextUrl); setRequestId(crypto.randomUUID());
      setView('challenge');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '写真を準備できませんでした。'); }
    finally { setBusy(false); }
  }

  async function handleSubmit() {
    if (!roomId || !token || !round || !photo || !requestId || busy || !canCapture) return;
    setBusy(true); setError(''); setView('judging');
    try {
      await submitPhoto(roomId, token, round.id, photo, requestId);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '写真を送れませんでした。');
      setView('challenge');
    } finally { setBusy(false); }
  }

  function retake() {
    if (!canCapture) return;
    setPhoto(null); setRequestId('');
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(''); setError(''); setView('challenge');
    fileInput.current?.click();
  }

  async function handleHint() {
    if (!round || hintBusy || !joined) return;
    if (preview) { setHint('赤い果物を探してみよう！'); setHintVisible(true); return; }
    if (hint) { setHintVisible(true); return; }
    setHintBusy(true); setHintError('');
    try {
      const result = await getHint(roomId, token, round.id);
      if (result.available && result.text) { setHint(result.text); setHintVisible(true); }
      else setHintError('このお題のヒントはまだありません。');
    } catch { setHintError('ヒントはまだ利用できません。'); }
    finally { setHintBusy(false); }
  }

  const screen = preview ? view : !joined && view !== 'rules' ? 'home' : view;
  const rankText = myRank >= 0 ? `${myRank + 1}位` : '—位';
  return <div className="karimono-page">
    {preview && <div className="preview-switch" aria-label="画面見本を選択">{views.map(item => <button key={item.key} type="button" aria-pressed={view === item.key} onClick={() => { setView(item.key); setError(''); }}>{item.label}</button>)}</div>}
    <main className={`game-shell game-shell--${screen}`}>
      <div className="sky-glow" aria-hidden="true" />
      <div className="game-topline">
        <button type="button" className="small-mark" onClick={() => setView('home')} aria-label="ホーム">カリモノ</button>
        <span className="room-label">{state?.room.name || '読み込み中…'}</span>
        <span className="mode-label">{state?.mode === 'ai' ? 'AI' : 'DEMO'}</span>
      </div>
      {connectionError && <p className="connection-message" role="status">再接続中です。画面の情報は前回取得時のものです。</p>}
      {screen !== 'home' && <nav className="game-nav" aria-label="ゲーム内の移動">
        <button type="button" onClick={() => setView('home')} aria-label="ホーム"><Home size={21} /></button>
        <button type="button" onClick={() => setView('ranking')} aria-label="ランキング"><Trophy size={21} /></button>
        <button type="button" onClick={() => setView('rules')} aria-label="遊び方"><BookOpen size={21} /></button>
      </nav>}

      {screen === 'home' && <section className="screen home-screen" aria-label="スタート画面">
        <div className="wood-sign"><span>カリモノ</span><small>借り物王に俺はなる！</small></div>
        <p className="home-subtitle">AI借り物競争</p>
        <div className="home-characters"><img src="/design/cat-cheer.png" alt="旗を振る猫耳のキャラクター" /><img src="/design/robot-cheer.png" alt="応援するロボット" /></div>
        {!joined && !preview ? <form className="join-form" onSubmit={handleJoin}>
          <label htmlFor="participant-name">ニックネーム</label>
          <input id="participant-name" value={name} maxLength={24} autoComplete="nickname" onChange={event => setName(event.target.value)} placeholder="お名前を入力" required />
          <button type="submit" className="game-button game-button--pink" disabled={busy || !roomId}>▶ 参加する</button>
        </form> : <div className="home-actions"><GameButton onClick={() => setView('challenge')} disabled={!round && !preview}>▶ ゲームスタート！</GameButton>{!round && <p className="waiting-copy">参加しました。お題の公開を待っています。</p>}</div>}
        <button type="button" className="text-link" onClick={() => setView('rules')}>遊び方を見る <ChevronRight size={16}/></button>
      </section>}

      {screen === 'challenge' && <section className="screen challenge-screen" aria-label="お題画面">
        <div className="round-meta"><span>第 {round?.number ?? 1} 競技！</span><strong>現在 {rankText}</strong></div>
        <div className="challenge-ticket"><span className="ticket-ribbon">お題</span><h1>{round?.challenge.title || 'お題を待っています'}</h1>{round?.challenge.description && <p>{round.challenge.description}</p>}</div>
        <div className="timer-pill"><Clock3 size={22}/><strong>{formatTime(preview ? 30 : secondsLeft)}</strong></div>
        <div className="camera-frame">
          {photoUrl ? <img src={photoUrl} alt="送信前の写真" className="captured-photo" /> : reference ? <img src={reference} alt="お題の参考写真" className="captured-photo" /> : <div className="camera-placeholder"><Camera size={58}/><span>見つけたものを撮ろう！</span></div>}
          <span className="camera-corner camera-corner--tl"/><span className="camera-corner camera-corner--tr"/><span className="camera-corner camera-corner--bl"/><span className="camera-corner camera-corner--br"/>
        </div>
        <div className="camera-actions">
          {photo ? <><GameButton tone="white" onClick={retake} disabled={!canCapture}><RotateCcw size={19}/> 撮り直す</GameButton><GameButton onClick={() => void handleSubmit()} disabled={!canCapture}>写真を送る <ChevronRight size={19}/></GameButton></> : <GameButton onClick={() => fileInput.current?.click()} disabled={!canCapture && !preview} className="camera-main-button"><Camera size={28}/> 撮影する</GameButton>}
        </div>
        <input ref={fileInput} type="file" accept="image/*" capture="environment" className="visually-hidden" onChange={event => void handlePhoto(event)} aria-label="撮影または写真を選択" />
        <button type="button" className="hint-link" onClick={() => void handleHint()} disabled={!joined || !round || hintBusy}><Lightbulb size={18}/> {hintBusy ? '読み込み中…' : 'ヒントを見る'}</button>
        {hintVisible && <div className="hint-card" role="note"><button type="button" onClick={() => setHintVisible(false)} aria-label="ヒントを閉じる">×</button><strong>ヒント</strong><p>{hint}</p></div>}
        {hintError && <p className="state-note" role="status">{hintError}</p>}
        {!round && <p className="state-note">ホストがお題を公開すると、ここに表示されます。</p>}
        {!preview && joined && round && joinedAt > round.startedAt && <p className="state-note">この競技の開始後に参加しました。次のお題から撮影できます。</p>}
      </section>}

      {screen === 'judging' && <section className="screen judging-screen" aria-label="AI判定中" role="status">
        <div className="judging-bubble">AIが判定中…</div>
        <img src="/design/robot-cheer.png" alt="判定を案内するロボット" className="judging-robot"/>
        <div className="progress-track"><span/></div><p>写真を確認しています</p>
        <small>結果は自動で届きます。画面を閉じても、戻ると続きが表示されます。</small>
      </section>}

      {screen === 'success' && <section className="screen result-screen success-screen" aria-label="クリア画面">
        <div className="clear-burst" aria-hidden="true">✦ ★ ✦</div><h1>CLEAR!!</h1>
        <img src="/design/cat-cheer.png" alt="成功を喜ぶ猫耳のキャラクター" className="result-character"/>
        <div className="result-reward">{preview ? '+500 pt' : typeof latest?.awardedPoints === 'number' ? `+${latest.awardedPoints} pt` : 'クリア！'}</div>
        <div className="result-stats"><span>現在の順位 <strong>{rankText}</strong></span><span>クリア数 <strong>{preview ? '3 / 10' : `${state?.ranks.find(player => player.id === playerId)?.wins ?? 0}${state?.game?.totalRounds ? ` / ${state.game.totalRounds}` : ''}`}</strong></span></div>
        <GameButton onClick={() => setView('stages')}>次のお題へ <ChevronRight size={19}/></GameButton>
      </section>}

      {screen === 'failure' && <section className="screen result-screen failure-screen" aria-label="判定結果画面">
        <div className="failure-bubble">ざんねん…</div>
        <div className="failure-characters"><img src="/design/cat-cheer.png" alt="猫耳のキャラクター"/><img src="/design/robot-cheer.png" alt="ロボット"/></div>
        <p className="failure-reason">{preview ? 'ちょっと違うみたい…もう一度探してみよう！' : latest?.verdict?.reason || error || 'もう一度探してみよう！'}</p>
        <GameButton tone="yellow" onClick={() => setView('challenge')}><Lightbulb size={18}/> お題を見る</GameButton>
        <GameButton tone="white" onClick={retake} disabled={!canCapture && !preview}><Camera size={18}/> もう一度撮る</GameButton>
      </section>}

      {screen === 'stages' && <section className="screen stages-screen" aria-label="ステージ選択">
        <div className="banner-heading">ステージをえらぶ</div>
        <div className="stage-grid">{Array.from({ length: preview ? 10 : (state?.game?.totalRounds ?? Math.max(10, round?.number ?? 1)) }, (_, index) => {
          const number = index + 1; const status = preview ? (number <= 6 ? number === 1 ? 'active' : 'completed' : 'locked') : state?.stages?.find(stage => stage.number === number)?.status ?? (number === round?.number ? 'active' : 'locked');
          const active = status === 'active'; const unlocked = status !== 'locked';
          return <button key={number} type="button" disabled={!active} className={active ? 'active' : ''} onClick={() => setView('challenge')} aria-label={`ステージ${number}・${status === 'completed' ? 'クリア済み' : active ? '進行中' : '未開放'}`}>
            {unlocked ? <><Flag size={27} fill={number === 1 ? '#f34974' : '#329fe6'}/><span>{number}</span></> : <><LockKeyhole size={23}/><span>{number}</span></>}
          </button>;
        })}</div>
        <p className="stage-message">{preview ? 'すべてのステージをクリアしよう！' : '次のお題はホストの開始を待ってください。'}</p>
        <GameButton tone="blue" onClick={() => setView('challenge')}><ArrowLeft size={19}/> お題へ戻る</GameButton>
      </section>}

      {screen === 'ranking' && <section className="screen ranking-screen" aria-label="ランキング">
        <div className="banner-heading">ランキング</div>
        <div className="ranking-tabs"><span className="selected">全体</span><span>クリア数で表示</span></div>
        <ol className="ranking-list">{(state?.ranks ?? []).map((player, index) => <li key={player.id} className={player.id === (preview ? 'me' : playerId) ? 'my-rank' : ''}>
          <span className="rank-number">{index <= 2 ? '♛' : index + 1}</span><span className="rank-avatar">{player.name.slice(0, 1)}</span><span className="rank-name">{player.name}{player.id === (preview ? 'me' : playerId) && <small>（あなた）</small>}</span><strong>{preview ? `${[12400,11800,10200,9600,8750,6230][index] ?? 0} pt` : typeof player.score === 'number' ? `${player.score.toLocaleString()} pt` : `${player.wins ?? 0} クリア`}</strong>
        </li>)}</ol>
        <GameButton tone="blue" onClick={() => setView(round ? 'challenge' : 'home')}><ArrowLeft size={19}/> 戻る</GameButton>
      </section>}

      {screen === 'rules' && <section className="screen rules-screen" aria-label="遊び方">
        <div className="banner-heading">遊び方</div>
        <div className="rule-grid"><div><b>1</b><span>お題を確認</span><Flag size={30}/></div><div><b>2</b><span>見つけて撮る</span><Camera size={30}/></div><div><b>3</b><span>AIが判定</span><img src="/design/robot-cheer.png" alt=""/></div><div><b>4</b><span>結果を確認</span><Sparkles size={31}/></div></div>
        <p className="rules-message">制限時間内にお題のものを見つけて、撮影しよう！</p>
        <GameButton tone="blue" onClick={() => setView(round ? 'challenge' : 'home')}><ArrowLeft size={19}/> 戻る</GameButton>
      </section>}
      {error && screen !== 'failure' && <p className="screen-error" role="alert">{error}</p>}
      <footer className="game-footer"><span>ONE LEASE</span><span>借り物王に俺はなる！</span></footer>
    </main>
  </div>;
}
