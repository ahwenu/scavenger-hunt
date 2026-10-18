'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { ArrowLeft, BookOpen, Camera, ChevronRight, Clock3, Flag, Home, ImagePlus, Lightbulb, LockKeyhole, RotateCcw, Sparkles, Trophy, Volume2, VolumeX } from 'lucide-react';
import { ApiError, getHint, getState, joinRoom, safeReferenceUrl, submitPhoto, toSubmissionJpeg, type GameState } from './api';
import { LiveCount, LiveStandings, positionOf } from './LiveStandings';
import { createParticipantAudio } from './audio/media-audio';
import { createParticipantSoundObserver } from './audio/participant-sound-observer';
import type { ParticipantSoundName } from './audio/sound-clips';
import { resolveParticipantPath } from './entry-link';

export type View = 'home' | 'challenge' | 'judging' | 'success' | 'failure' | 'stages' | 'ranking' | 'rules';
export const views: { key: View; label: string }[] = [
  { key: 'home', label: '① スタート' }, { key: 'challenge', label: '② お題' },
  { key: 'judging', label: '③ 判定中' }, { key: 'success', label: '④ 成功' },
  { key: 'failure', label: '⑤ 失敗' }, { key: 'stages', label: '⑥ ステージ' },
  { key: 'ranking', label: '⑦ ランキング' }, { key: 'rules', label: '⑧ 遊び方' },
];
export const art: Record<View, string> = {
  home: '01-start.png', challenge: '02-question.png', judging: '03-judging.png',
  success: '04-success.png', failure: '05-failure.png', stages: '06-stage-select.png',
  ranking: '07-ranking.png', rules: '08-howto.png',
};
const sprite = (name: string) => `/design/sports-day/sprites/${name}.png`;
const character = (name: string) => `/design/sports-day/enhanced/${name === 'robot-guide' ? 'robot-judging' : name}.png`;
const pendingStatuses = new Set(['uploading', 'queued', 'processing', 'retrying', 'pending']);
const terminalStatuses = new Set(['accepted', 'rejected', 'error', 'failed']);
const voice: Partial<Record<View, string>> = {
  home: '/audio/welcome-ja.mp3', challenge: '/audio/challenge-ja.mp3',
  judging: '/audio/judging-ja.mp3', success: '/audio/success-ja.mp3', failure: '/audio/retry-ja.mp3',
};
const eventVoice: Partial<Record<ParticipantSoundName, { path: string; delay: number }>> = {
  join: { path: '/audio/joined-ja.mp3', delay: 950 },
  start: { path: '/audio/challenge-ja.mp3', delay: 1000 },
  submit: { path: '/audio/judging-ja.mp3', delay: 450 },
  success: { path: '/audio/success-ja.mp3', delay: 1300 },
  retry: { path: '/audio/retry-ja.mp3', delay: 400 },
  result: { path: '/audio/ranking-ja.mp3', delay: 2700 },
  timeup: { path: '/audio/timeup-ja.mp3', delay: 800 },
  victory: { path: '/audio/finished-ja.mp3', delay: 3200 },
};
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

export function ParticipantGame({ preview = false, landing = false, previewView, onPreviewViewChange }: { preview?: boolean; landing?: boolean; previewView?: View; onPreviewViewChange?: (view: View) => void }) {
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryLink, setEntryLink] = useState('');
  const [roomId, setRoomId] = useState('');
  const [token, setToken] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [state, setState] = useState<GameState | null>(preview ? fixture : null);
  const [view, setView] = useState<View>('home');
  useEffect(() => { if (preview && previewView) setView(previewView); }, [preview, previewView]);
  useEffect(() => { if (preview) onPreviewViewChange?.(view); }, [preview, view, onPreviewViewChange]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState('');
  const [requestId, setRequestId] = useState('');
  const [uploadUncertain, setUploadUncertain] = useState(false);
  const [hint, setHint] = useState('');
  const [hintError, setHintError] = useState('');
  const [hintVisible, setHintVisible] = useState(false);
  const [hintBusy, setHintBusy] = useState(false);
  const [now, setNow] = useState(0);
  const [serverOffset, setServerOffset] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const audioRef = useRef<ReturnType<typeof createParticipantAudio> | null>(null);
  const soundObserver = useRef<ReturnType<typeof createParticipantSoundObserver> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastSubmission = useRef('');
  const lastRound = useRef('');
  const latestState = useRef<GameState | null>(state);
  const photoRound = useRef('');
  const operationEpoch = useRef(0);
  const mediaEpoch = useRef(0);
  const cameraRequestPending = useRef(false);
  const pendingAttempt = useRef<{ roundId: string; requestId: string; baseline: Set<string>; receiptId?: string } | null>(null);
  const refreshFlight = useRef<{ session: string; promise: Promise<GameState | null>; controller: AbortController } | null>(null);
  const sessionKey = `${roomId}:${token}`;
  const sessionRef = useRef(sessionKey);
  sessionRef.current = sessionKey;
  const screenRef = useRef<View>('home');
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soundPlayerId = useRef(playerId);
  soundPlayerId.current = playerId;

  function playGameSound(name: ParticipantSoundName) {
    const audio = audioRef.current;
    if (!audio) return;
    const line = eventVoice[name];
    void audio.playEffect(name).then(played => {
      // 優先度や遅延で採用されなかった音に付随する台詞も再生しない。
      if (played && line) audio.speak(line.path, line.delay);
    });
  }

  useEffect(() => {
    const audio = createParticipantAudio();
    audioRef.current = audio;
    const observer = createParticipantSoundObserver(playGameSound);
    soundObserver.current = observer;
    const sync = () => setSoundEnabled(audio.getState().enabled);
    sync();
    const unsubscribe = audio.subscribe(sync);
    const resetSounds = () => { observer.reset(); audio.pause(); };
    const visibility = () => { observer.reset(); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', resetSounds);
    return () => {
      unsubscribe(); audio.dispose(); observer.reset();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', resetSounds);
      audioRef.current = null; soundObserver.current = null;
    };
  }, []);

  useEffect(() => { soundObserver.current?.reset(); }, [sessionKey]);

  useEffect(() => {
    if (!preview && !document.hidden) soundObserver.current?.observe(state, playerId);
  }, [state, playerId, preview]);

  useEffect(() => {
    if (!preview && !document.hidden) soundObserver.current?.tick(state, playerId, now + serverOffset);
  }, [state, playerId, now, serverOffset, preview]);

  const stopCamera = useCallback(() => {
    mediaEpoch.current += 1;
    cameraRequestPending.current = false;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setCameraOpen(false); setCameraStarting(false);
  }, []);

  const clearPhoto = useCallback(() => {
    photoRound.current = '';
    setPhoto(null); setPhotoUrl(''); setRequestId('');
  }, []);

  useEffect(() => {
    if (preview || landing) return;
    const match = location.pathname.match(/^\/rooms\/([a-zA-Z0-9-]+)\/join\/?$/);
    queueMicrotask(() => {
      if (!match) { setError('参加リンクを確認してください。'); return; }
      const id = match[1];
      setRoomId(id);
      setToken(localStorage.getItem(`karimono:${id}:token`) ?? '');
      setPlayerId(localStorage.getItem(`karimono:${id}:id`) ?? '');
    });
  }, [preview, landing]);

  const refresh = useCallback((): Promise<GameState | null> => {
    if (preview || !roomId || sessionRef.current !== `${roomId}:${token}`) return Promise.resolve(null);
    const session = `${roomId}:${token}`;
    if (refreshFlight.current?.session === session) return refreshFlight.current.promise;
    const controller = new AbortController();
    const promise = (async () => { try {
      const next = await getState(roomId, token, controller.signal);
      if (controller.signal.aborted || sessionRef.current !== session) return null;
      const previousRevision = latestState.current?.revision;
      if (typeof next.revision === 'number' && typeof previousRevision === 'number' && next.revision < previousRevision) return null;
      const nextRound = next.round?.id ?? '';
      if (lastRound.current && lastRound.current !== nextRound) {
        operationEpoch.current += 1;
        pendingAttempt.current = null; setUploadUncertain(false); setBusy(false);
        stopCamera(); clearPhoto(); setError('');
        setView(nextRound ? 'challenge' : 'home');
        setHint(''); setHintError(''); setHintVisible(false);
      }
      lastRound.current = nextRound;
      const ownLatest = next.mine.filter(item => item.roundId === nextRound).at(-1);
      const marker = ownLatest ? `${ownLatest.id}:${ownLatest.status}` : '';
      const attempt = pendingAttempt.current;
      if (attempt && ownLatest && attempt.roundId === nextRound &&
          (attempt.receiptId === ownLatest.id || !attempt.baseline.has(ownLatest.id))) {
        setUploadUncertain(false);
        if (terminalStatuses.has(ownLatest.status)) pendingAttempt.current = null;
      }
      if (ownLatest && marker !== lastSubmission.current) {
        lastSubmission.current = marker;
        if (pendingStatuses.has(ownLatest.status)) setView('judging');
        else if (ownLatest.status === 'accepted') setView('success');
        else if (ownLatest.status === 'rejected') setView('failure');
        else if (['error', 'failed'].includes(ownLatest.status)) { setError(ownLatest.verdict?.reason || '判定できませんでした。'); setView('failure'); }
        if (terminalStatuses.has(ownLatest.status)) clearPhoto();
      }
      if (next.game?.status === 'finished' && latestState.current?.game?.status !== 'finished') setView('ranking');
      latestState.current = next;
      setServerOffset(next.serverTime - Date.now());
      setState(next);
      setConnectionError(false);
      return next;
    } catch (cause) {
      if (controller.signal.aborted || sessionRef.current !== session) return null;
      setConnectionError(true);
      if (!latestState.current) setError(cause instanceof Error ? cause.message : '部屋を読み込めません。');
      return null;
    } finally {
      if (refreshFlight.current?.controller === controller) refreshFlight.current = null;
    } })();
    refreshFlight.current = { session, promise, controller };
    return promise;
  }, [preview, roomId, token, clearPhoto, stopCamera]);

  useEffect(() => {
    if (preview || !roomId) return;
    queueMicrotask(() => { void refresh(); });
    const poll = setInterval(() => { if (!document.hidden) void refresh(); }, 2000);
    const wake = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', wake);
    return () => {
      clearInterval(poll); document.removeEventListener('visibilitychange', wake);
      refreshFlight.current?.controller.abort(); refreshFlight.current = null;
    };
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
  const myRank = positionOf(state?.ranks ?? [], preview ? 'me' : playerId);
  const secondsLeft = preview ? 30 : round?.status === 'active' ? Math.max(0, Math.ceil((round.endsAt - now - serverOffset) / 1000)) : 0;
  const currentStatus = latest?.status ?? '';
  const pending = pendingStatuses.has(currentStatus);
  const accepted = currentStatus === 'accepted';
  const canParticipate = joined && state?.game?.status !== 'finished' && Boolean(round && (preview || joinedAt <= round.startedAt) && round.status === 'active' && secondsLeft > 0 && !pending && !accepted);
  const canCapture = canParticipate && !busy && !uploadUncertain;
  const canSubmit = canParticipate && !busy && Boolean(photo && photoRound.current === round?.id);
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
      playGameSound('join');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '参加できませんでした。'); }
    finally { setBusy(false); }
  }

  function handleEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const path = resolveParticipantPath(entryLink, location.origin);
    if (!path) { setError('このサイトの参加リンク、または部屋IDを入力してください。'); return; }
    location.assign(path);
  }

  async function handlePhoto(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = '';
    if (!selected) return;
    await preparePhoto(selected);
  }

  async function preparePhoto(selected: File, capturedRound = round?.id) {
    if (!canCapture || !capturedRound || latestState.current?.round?.id !== capturedRound) return;
    const operation = ++operationEpoch.current;
    void audioRef.current?.playEffect('shutter');
    setBusy(true); setError('');
    try {
      const jpeg = await toSubmissionJpeg(selected);
      if (operation !== operationEpoch.current || latestState.current?.round?.id !== capturedRound || screenRef.current !== 'challenge') return;
      const nextUrl = URL.createObjectURL(jpeg);
      photoRound.current = capturedRound;
      setPhoto(jpeg); setPhotoUrl(nextUrl); setRequestId(crypto.randomUUID());
      pendingAttempt.current = null; setUploadUncertain(false);
      stopCamera();
      setView('challenge');
    } catch (cause) { if (operation === operationEpoch.current) setError(cause instanceof Error ? cause.message : '写真を準備できませんでした。'); }
    finally { if (operation === operationEpoch.current) setBusy(false); }
  }

  async function handleSubmit() {
    if (preview && canSubmit) {
      setView('judging');
      if (previewTimer.current) clearTimeout(previewTimer.current);
      previewTimer.current = setTimeout(() => { setView('success'); clearPhoto(); }, 1600);
      return;
    }
    if (!roomId || !token || !round || !photo || !requestId || !canSubmit) return;
    const operation = ++operationEpoch.current;
    const submittedRound = round.id;
    const submittedSession = sessionKey;
    const baseline = pendingAttempt.current?.requestId === requestId ? pendingAttempt.current.baseline : new Set(mine.map(item => item.id));
    if (pendingAttempt.current?.requestId !== requestId) {
      pendingAttempt.current = { roundId: submittedRound, requestId, baseline };
    }
    setBusy(true); setError(''); setView('judging');
    try {
      const receipt = await submitPhoto(roomId, token, submittedRound, photo, requestId);
      if (operation !== operationEpoch.current || sessionRef.current !== submittedSession || latestState.current?.round?.id !== submittedRound) return;
      soundObserver.current?.receipt(submittedRound, receipt);
      setUploadUncertain(false);
      if (pendingAttempt.current) pendingAttempt.current.receiptId = receipt.id;
      if (terminalStatuses.has(receipt.status)) {
        clearPhoto(); pendingAttempt.current = null;
        setView(receipt.status === 'accepted' ? 'success' : 'failure');
      }
      await refresh();
    } catch (cause) {
      if (operation !== operationEpoch.current || sessionRef.current !== submittedSession) return;
      const known = latestState.current?.mine.filter(item => item.roundId === submittedRound && !baseline.has(item.id)).at(-1);
      if (known) {
        setUploadUncertain(false);
        setView(known.status === 'accepted' ? 'success' : terminalStatuses.has(known.status) ? 'failure' : 'judging');
        if (terminalStatuses.has(known.status)) clearPhoto();
        return;
      }
      const uncertain = !(cause instanceof ApiError) || cause.status >= 500 || cause.status === 408;
      setUploadUncertain(uncertain);
      setError(cause instanceof Error ? cause.message : '写真を送れませんでした。');
      setView('challenge');
      // 応答を失った場合も、同じ写真とrequestIdを保持して状態取得で受付を確認する。
      await refresh();
    } finally { if (operation === operationEpoch.current) setBusy(false); }
  }

  function retake() {
    if (!canCapture) return;
    operationEpoch.current += 1;
    clearPhoto(); setError(''); setView('challenge');
    fileInput.current?.click();
  }

  async function handleHint() {
    if (!round || hintBusy || !joined) return;
    if (preview) { setHint('赤い果物を探してみよう！'); setHintVisible(true); audioRef.current?.speak('/audio/hint-ja.mp3', 180); return; }
    if (hint) { setHintVisible(true); audioRef.current?.speak('/audio/hint-ja.mp3', 180); return; }
    const requestedRound = round.id;
    setHintBusy(true); setHintError('');
    try {
      const result = await getHint(roomId, token, round.id);
      if (latestState.current?.round?.id !== requestedRound) return;
      if (result.available && result.text) { setHint(result.text); setHintVisible(true); audioRef.current?.speak('/audio/hint-ja.mp3', 180); }
      else setHintError('このお題のヒントはまだありません。');
    } catch { if (latestState.current?.round?.id === requestedRound) setHintError('ヒントはまだ利用できません。'); }
    finally { setHintBusy(false); }
  }

  const screen = preview ? view : !joined && view !== 'rules' ? 'home' : view;
  screenRef.current = screen;
  const rankText = myRank ? `${myRank}位` : '—位';
  useEffect(() => {
    if (screen === 'challenge' && canParticipate) return;
    stopCamera();
  }, [screen, canParticipate, stopCamera]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) stopCamera(); };
    const leave = () => stopCamera();
    document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', leave);
    return () => {
      document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', leave);
      mediaEpoch.current += 1; operationEpoch.current += 1;
      streamRef.current?.getTracks().forEach(track => track.stop());
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, [stopCamera]);
  function toggleSound() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.setEnabled(!audio.getState().enabled);
    soundObserver.current?.reset();
    if (!preview) soundObserver.current?.observe(latestState.current, soundPlayerId.current);
    if (audio.getState().enabled) audio.activate(entryVoice());
  }

  function entryVoice() {
    // 再読込・再ON・初回操作から、既に確定している合否を読み直さない。
    if (!preview && (screen === 'success' || screen === 'failure')) return voice.home;
    return voice[screen];
  }

  function handleSoundGesture(event: React.MouseEvent<HTMLElement>) {
    const target = event.target instanceof Element ? event.target.closest('button,summary') : null;
    if (target?.matches(':disabled,.sound-toggle')) return;
    const audio = audioRef.current;
    if (!audio?.getState().enabled) return;
    if (!audio.getState().activated) {
      soundObserver.current?.reset();
      if (!preview) soundObserver.current?.observe(latestState.current, soundPlayerId.current);
    }
    audio.activate(entryVoice());
    if (target && !target.matches('[data-shutter="true"]')) void audio.playEffect('tap');
  }

  function openRanking() {
    setView('ranking');
    if (!preview) audioRef.current?.speak('/audio/ranking-ja.mp3', 200);
  }

  function startPlaying() {
    if (state?.game?.status === 'finished') { openRanking(); return; }
    setView('challenge');
    if (!preview) audioRef.current?.speak('/audio/challenge-ja.mp3', 200);
  }
  async function openCamera() {
    if (!canCapture || cameraRequestPending.current || streamRef.current) return;
    if (preview || !navigator.mediaDevices?.getUserMedia) { fileInput.current?.click(); return; }
    const requestedRound = round?.id;
    const epoch = ++mediaEpoch.current;
    cameraRequestPending.current = true; setCameraStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });
      if (epoch !== mediaEpoch.current || screenRef.current !== 'challenge' || document.hidden || latestState.current?.round?.id !== requestedRound) {
        stream.getTracks().forEach(track => track.stop()); return;
      }
      streamRef.current = stream;
      setCameraOpen(true);
    } catch {
      if (epoch === mediaEpoch.current && screenRef.current === 'challenge' && !document.hidden) {
        setError('カメラを開けませんでした。左の写真アイコンからも選べます。');
        fileInput.current?.click();
      }
    } finally {
      if (epoch === mediaEpoch.current) { cameraRequestPending.current = false; setCameraStarting(false); }
    }
  }
  async function captureCamera() {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight || !canCapture) return;
    const capturedRound = round?.id;
    const epoch = mediaEpoch.current;
    const canvas = document.createElement('canvas');
    const viewRatio = video.clientWidth && video.clientHeight ? video.clientWidth / video.clientHeight : video.videoWidth / video.videoHeight;
    const sourceRatio = video.videoWidth / video.videoHeight;
    const cropWidth = sourceRatio > viewRatio ? video.videoHeight * viewRatio : video.videoWidth;
    const cropHeight = sourceRatio > viewRatio ? video.videoHeight : video.videoWidth / viewRatio;
    canvas.width = Math.round(cropWidth); canvas.height = Math.round(cropHeight);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, (video.videoWidth - cropWidth) / 2, (video.videoHeight - cropHeight) / 2, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    if (epoch !== mediaEpoch.current || latestState.current?.round?.id !== capturedRound) return;
    if (!blob) { setError('撮影した写真を保存できませんでした。'); return; }
    await preparePhoto(new File([blob], 'camera.jpg', { type: 'image/jpeg' }), capturedRound);
  }
  useEffect(() => {
    // 見本だけ画面遷移を音へ変換する。実ゲームの合否はAPIイベントで1度だけ再生する。
    if (!preview) return;
    if (screen === 'challenge') playGameSound('start');
    else if (screen === 'judging') playGameSound('submit');
    else if (screen === 'success') playGameSound('success');
    else if (screen === 'failure') playGameSound('retry');
    else if (screen === 'ranking') playGameSound('result');
    else if (voice[screen]) audioRef.current?.speak(voice[screen]);
    else audioRef.current?.stopVoice();
  }, [screen, preview]);
  return <div className="karimono-page">
    {preview && !previewView && <div className="preview-switch" aria-label="画面見本を選択">{views.map(item => <button key={item.key} type="button" aria-pressed={view === item.key} onClick={() => { setView(item.key); setError(''); }}>{item.label}</button>)}</div>}
    <main className={`game-shell game-shell--${screen} game-shell--live`} onClickCapture={handleSoundGesture}>
      <div className="sky-glow" aria-hidden="true" />
      <div className="game-topline">
        <button type="button" className="small-mark" onClick={() => setView('home')} aria-label="ホーム">カリモノ</button>
        <span className="room-label">{state?.room.name || (landing ? 'みんなで借り物競争' : '読み込み中…')}</span>
        {state && <LiveCount count={state.stats.players} connected={!connectionError} />}
        {(state || !landing) && <span className="mode-label">{state?.mode === 'ai' ? 'AI' : 'DEMO'}</span>}
      </div>
      {connectionError && <p className="connection-message" role="status">再接続中です。画面の情報は前回取得時のものです。</p>}
      {screen !== 'home' && <nav className="game-nav" aria-label="ゲーム内の移動">
        <button type="button" onClick={() => setView('home')} aria-label="ホーム"><Home size={21} /></button>
        <button type="button" onClick={openRanking} aria-label="ランキング"><Trophy size={21} /></button>
        <button type="button" onClick={() => setView('rules')} aria-label="遊び方"><BookOpen size={21} /></button>
      </nav>}
      <button type="button" className="sound-toggle" onClick={toggleSound} aria-label={soundEnabled ? '音声をオフにする' : '音声をオンにする'} aria-pressed={soundEnabled}>{soundEnabled ? <Volume2 size={19}/> : <VolumeX size={19}/>}</button>

      {screen === 'home' && <section className="screen home-screen" aria-label="スタート画面">
        <div className="wood-sign"><span>カリモノ</span><small>借り物王に俺はなる！</small></div>
        <p className="home-subtitle">AI借り物競争</p>
        <div className="home-characters"><img src={sprite('girl-flag')} alt="旗を振る猫耳のキャラクター" /><img src={character('robot-flag')} alt="応援するロボット" /></div>
        {landing ? entryOpen ? <form className="join-form" onSubmit={handleEntry}>
          <label htmlFor="participant-entry">参加リンク・部屋ID</label>
          <input id="participant-entry" value={entryLink} onChange={event => setEntryLink(event.target.value)} placeholder="ホストから届いたリンクを貼り付け" maxLength={2048} autoComplete="off" autoCapitalize="none" spellCheck={false} required />
          <button type="submit" className="game-button game-button--pink">参加画面へ <ChevronRight size={19}/></button>
          <button type="button" className="text-link" onClick={() => { setEntryOpen(false); setError(''); }}>戻る</button>
        </form> : <div className="home-actions"><GameButton onClick={() => setEntryOpen(true)}>▶ ゲームスタート！</GameButton><p className="waiting-copy">会場のQR・参加リンクからも参加できます</p></div> : !joined && !preview ? <form className="join-form" onSubmit={handleJoin}>
          <label htmlFor="participant-name">ニックネーム</label>
          <input id="participant-name" value={name} maxLength={24} autoComplete="nickname" onChange={event => setName(event.target.value)} placeholder="お名前を入力" required />
          <button type="submit" className="game-button game-button--pink" disabled={busy || !roomId}>▶ 参加する</button>
        </form> : <div className="home-actions"><GameButton onClick={startPlaying} disabled={!round && !preview && state?.game?.status !== 'finished'}>{state?.game?.status === 'finished' ? '結果を見る' : '▶ ゲームスタート！'}</GameButton>{!round && state?.game?.status !== 'finished' && <p className="waiting-copy">{state?.lobby.autoStart === false && state.lobby.deadline == null ? '参加しました。ホストが開始するまでお待ちください。' : '参加しました。お題の公開を待っています。'}</p>}</div>}
        <button type="button" className="text-link" onClick={() => setView('rules')}>遊び方を見る <ChevronRight size={16}/></button>
      </section>}

      {screen === 'challenge' && <section className="screen challenge-screen" aria-label="お題画面">
        <div className="round-meta"><span>第 {round?.number ?? 1} 競技！</span><strong>現在 {rankText}</strong></div>
        <div className="challenge-ticket">
          <span className="ticket-ribbon">お題</span>
          <h1>{round?.challenge.title || 'お題を待っています'}</h1>
          {round?.challenge.description && <p>{round.challenge.description}</p>}
          {round && <div className="challenge-criteria">
            {Boolean(round.challenge.criteria?.length) && <>
              <strong>写真の判定基準</strong>
              <ul>{round.challenge.criteria?.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul>
            </>}
            <p className="challenge-photo-rule">条件に合う実物を撮影してください。画面や印刷された写真は使えません。</p>
          </div>}
        </div>
        <div className="timer-pill"><Clock3 size={22}/><strong>{formatTime(preview ? 30 : secondsLeft)}</strong></div>
        <div className="camera-frame">
          {cameraOpen ? <video ref={element => { videoRef.current = element; if (element) element.srcObject = streamRef.current; }} autoPlay playsInline muted aria-label="カメラの映像" className="captured-photo" /> : photoUrl ? <img src={photoUrl} alt="送信前の写真" className="captured-photo" /> : reference ? <img src={reference} alt="お題の参考写真" className="captured-photo" /> : <div className="camera-placeholder"><Camera size={58}/><span>見つけたものを撮ろう！</span></div>}
          <span className="camera-corner camera-corner--tl"/><span className="camera-corner camera-corner--tr"/><span className="camera-corner camera-corner--bl"/><span className="camera-corner camera-corner--br"/>
        </div>
        <div className={`camera-actions${photo ? ' camera-actions--review' : ''}`}>
          {photo ? <><GameButton tone="white" onClick={retake} disabled={!canCapture}><RotateCcw size={19}/> 撮り直す</GameButton><GameButton onClick={() => void handleSubmit()} disabled={!canSubmit}>{uploadUncertain ? '同じ写真で再確認' : '写真を送る'} <ChevronRight size={19}/></GameButton></> : <><button type="button" className="gallery-button" onClick={() => fileInput.current?.click()} disabled={!canCapture || cameraStarting} aria-label="写真を選ぶ"><ImagePlus size={23} strokeWidth={1.8}/></button><button type="button" className="game-button game-button--pink camera-main-button" data-shutter={cameraOpen} onClick={() => void (cameraOpen ? captureCamera() : openCamera())} disabled={!canCapture || cameraStarting} aria-label={cameraStarting ? 'カメラを準備中' : cameraOpen ? '撮影' : 'カメラを開く'}><Camera size={32} strokeWidth={1.8} aria-hidden="true" /></button><span aria-hidden="true" className="camera-action-spacer" /></>}
        </div>
        {!photo && <p className="camera-caption">{cameraStarting ? 'カメラを準備しています…' : cameraOpen ? '枠の中に収めて、シャッターをタップ' : 'カメラを開いて、見つけたものを撮ろう'}</p>}
        <button type="button" className="hint-link" onClick={() => void handleHint()} disabled={!joined || !round || hintBusy}><Lightbulb size={18}/> {hintBusy ? '読み込み中…' : 'ヒントを見る'}</button>
        {hintVisible && <div className="hint-card" role="note"><button type="button" onClick={() => setHintVisible(false)} aria-label="ヒントを閉じる">×</button><strong>ヒント</strong><p>{hint}</p></div>}
        {hintError && <p className="state-note" role="status">{hintError}</p>}
        {uploadUncertain && <p className="state-note" role="status">写真の受付を確認しています。自動で再送はしません。同じ写真で再確認できます。</p>}
        {!preview && round && (round.status === 'closed' || secondsLeft === 0) && <p className="state-note" role="status">受付時間が終了しました。次のお題を待ってください。</p>}
        {!round && <p className="state-note">ホストがお題を公開すると、ここに表示されます。</p>}
        {!preview && joined && round && joinedAt > round.startedAt && <p className="state-note">この競技の開始後に参加しました。次のお題から撮影できます。</p>}
      </section>}

      {screen === 'judging' && <section className="screen judging-screen" aria-label="AI判定中" role="status">
        <div className="judging-bubble">AIが判定中…</div>
        <img src={character('robot-judging')} alt="判定を案内するロボット" className="judging-robot"/>
        <div className="progress-track"><span/></div><p>写真を確認しています</p>
        <small>結果は自動で届きます。画面を閉じても、戻ると続きが表示されます。</small>
      </section>}

      {screen === 'success' && <section className="screen result-screen success-screen" aria-label="クリア画面">
        <div className="clear-burst" aria-hidden="true">✦ ★ ✦</div><h1>CLEAR!!</h1>
        <img src={character('girl-clear')} alt="成功を喜ぶ猫耳のキャラクター" className="result-character"/>
        <div className="result-reward">{preview ? '+500 pt' : typeof latest?.awardedPoints === 'number' ? `+${latest.awardedPoints} pt` : 'クリア！'}</div>
        <div className="result-stats"><span>現在の順位 <strong>{rankText}</strong></span><span>クリア数 <strong>{preview ? '3 / 10' : `${state?.ranks.find(player => player.id === playerId)?.wins ?? 0}${state?.game?.totalRounds ? ` / ${state.game.totalRounds}` : ''}`}</strong></span></div>
        <GameButton onClick={() => setView('stages')}>次のお題へ <ChevronRight size={19}/></GameButton>
      </section>}

      {screen === 'failure' && <section className="screen result-screen failure-screen" aria-label="判定結果画面">
        <div className="failure-bubble">{!preview && ['error', 'failed'].includes(currentStatus) ? '判定を確認できません' : 'ざんねん…'}</div>
        <div className="failure-characters"><img src={character('girl-sad')} alt="猫耳のキャラクター"/><img src={character('robot-failure')} alt="ロボット"/></div>
        <p className="failure-reason">{preview ? 'ちょっと違うみたい…もう一度探してみよう！' : latest?.verdict?.reason || error || 'もう一度探してみよう！'}</p>
        <GameButton tone="yellow" onClick={() => setView('challenge')}><Lightbulb size={18}/> お題を見る</GameButton>
        <GameButton tone="white" onClick={retake} disabled={!canCapture && !preview}><Camera size={18}/> もう一度撮る</GameButton>
      </section>}

      {screen === 'stages' && <section className="screen stages-screen" aria-label="ステージ選択">
        <div className="banner-heading">ステージをえらぶ</div>
        <div className="stage-grid">{Array.from({ length: preview ? 10 : (state?.game?.totalRounds ?? round?.number ?? 0) }, (_, index) => {
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
        <LiveStandings state={state} playerId={preview ? 'me' : playerId} preview={preview} connected={!connectionError} />
        <GameButton tone="blue" onClick={() => setView(round ? 'challenge' : 'home')}><ArrowLeft size={19}/> 戻る</GameButton>
      </section>}

      {screen === 'rules' && <section className="screen rules-screen" aria-label="遊び方">
        <div className="banner-heading">遊び方</div>
        <div className="rule-grid"><div><b>1</b><span>お題を確認</span><Flag size={30}/></div><div><b>2</b><span>見つけて撮る</span><Camera size={30}/></div><div><b>3</b><span>AIが判定</span><img src={character('robot-guide')} alt=""/></div><div><b>4</b><span>結果を確認</span><Sparkles size={31}/></div></div>
        <div className="rules-invitation"><p>制限時間内にお題のものを見つけて、撮影しよう！</p><img src={character('robot-guide')} alt="" /></div>
        <GameButton tone="blue" onClick={() => setView(round ? 'challenge' : 'home')}><ArrowLeft size={19}/> 戻る</GameButton>
        <details className="participant-sound-credits"><summary>音について・クレジット</summary><p>音量は端末のメディア音量で調整できます。右下の音ボタンでオン・オフを切り替えられます。</p><p>効果音：<a href="https://otologic.jp/" target="_blank" rel="noreferrer">OtoLogic</a>（<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>）。短縮・フェード・音量調整を行っています。</p></details>
      </section>}
      <input ref={fileInput} type="file" accept="image/*" className="visually-hidden" onChange={event => void handlePhoto(event)} aria-label="撮影または写真を選択" />
      {error && screen !== 'failure' && <p className="screen-error" role="alert">{error}</p>}
      <footer className="game-footer"><span>ONE LEASE</span><span>借り物王に俺はなる！</span></footer>
    </main>
  </div>;
}
