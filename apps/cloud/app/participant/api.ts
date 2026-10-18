export type Player = { id: string; name: string; joinedAt: number; wins?: number; totalMs?: number; score?: number; rank?: number };
export type Challenge = { title: string; description?: string; criteria?: string[]; reference?: { url?: string } };
export type Round = { id: string; number: number; status: 'active' | 'closed'; mode: 'demo' | 'ai'; challenge: Challenge; startedAt: number; endsAt: number };
export type Submission = { id: string; roundId: string; status: string; awardedPoints?: number; verdict?: { pass?: boolean; reason?: string; provider?: string } | null; receivedAt?: number };
export type GameState = {
  room: { id: string; name: string };
  game?: { status: 'lobby' | 'playing' | 'finished'; totalRounds: number };
  stages?: { number: number; status: 'completed' | 'active' | 'locked' }[];
  mode: 'demo' | 'ai';
  serverTime: number;
  lobby: { status: string; deadline?: number | null };
  players: Player[];
  ranks: Player[];
  round: Round | null;
  mine: Submission[];
  stats: { players: number; answered: number; accepted: number; pending: number };
};

async function responseJson<T>(response: Response): Promise<T> {
  let value: unknown;
  try { value = await response.json(); } catch { throw new Error('サーバーの応答を読み取れません。'); }
  if (!response.ok) {
    const message = value && typeof value === 'object' && 'error' in value ? String(value.error) : '通信に失敗しました。';
    throw new Error(message);
  }
  return value as T;
}

export async function getState(roomId: string, token: string, signal?: AbortSignal): Promise<GameState> {
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/state`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store', signal,
  });
  return responseJson<GameState>(response);
}

export async function joinRoom(roomId: string, name: string): Promise<{ id: string; token: string }> {
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/join`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  });
  return responseJson(response);
}

export async function submitPhoto(roomId: string, token: string, roundId: string, file: File, requestId: string): Promise<Submission> {
  const form = new FormData();
  form.set('photo', file, 'photo.jpg');
  form.set('roundId', roundId);
  form.set('requestId', requestId);
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/submit`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
  });
  return responseJson(response);
}

export async function getHint(roomId: string, token: string, roundId: string): Promise<{ roundId: string; text: string | null; available: boolean }> {
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/hint?roundId=${encodeURIComponent(roundId)}`, {
    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
  });
  return responseJson(response);
}

export async function toSubmissionJpeg(file: File): Promise<File> {
  if (file.size > 20 * 1024 * 1024) throw new Error('写真が大きすぎます。別の写真を選んでください。');
  let bitmap: ImageBitmap | null = null;
  let image: HTMLImageElement | null = null;
  let sourceUrl = '';
  try {
    try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {
      sourceUrl = URL.createObjectURL(file);
      image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const next = new Image();
        next.onload = () => resolve(next);
        next.onerror = () => reject(new Error('写真を読み込めません。JPEG・PNG・WebPを選んでください。'));
        next.src = sourceUrl;
      });
    }
    const source = bitmap ?? image;
    const width = bitmap?.width ?? image?.naturalWidth ?? 0;
    const height = bitmap?.height ?? image?.naturalHeight ?? 0;
    if (!source || !width || !height) throw new Error('写真のサイズを読み取れません。');
    const canvas = document.createElement('canvas');
    let scale = Math.min(1, 960 / Math.max(width, height));
    for (const quality of [0.82, 0.7, 0.55, 0.4]) {
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('このブラウザでは写真を変換できません。');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= 1048576) return new File([blob], 'photo.jpg', { type: 'image/jpeg' });
      scale *= 0.8;
    }
    throw new Error('写真を1MB以下にできませんでした。別の写真を選んでください。');
  } finally {
    bitmap?.close();
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  }
}

export function safeReferenceUrl(roomId: string, round: Round | null): string {
  if (!round?.challenge.reference?.url) return '';
  try {
    const url = new URL(round.challenge.reference.url, location.origin);
    const expected = `/api/rooms/${encodeURIComponent(roomId)}/reference/${encodeURIComponent(round.id)}`;
    return url.origin === location.origin && url.pathname === expected && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
