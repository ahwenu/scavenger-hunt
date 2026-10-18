import { PASS_POINTS, TOTAL_ROUNDS, type GameProgress, type GameRank } from './game-contract';

type Player = { id: string; name: string; joinedAt: number };
type Round = { id: string; number: number; status: string; startedAt: number; endsAt: number };
type Submission = { id: string; seq: number; playerId: string; roundId: string; receivedAt: number; status: string };
export const isPending = (status: string) => ['uploading', 'queued', 'processing'].includes(status);

/** 永続した初合格だけを正本に集計する。クライアントの点数は一切使わない。 */
export function gameProjection(players: Player[], rounds: Round[], submissions: Submission[], now: number) {
  const visibleRounds = rounds.filter(r => r.number <= TOTAL_ROUNDS);
  const current = visibleRounds.at(-1);
  const roundById = new Map(visibleRounds.map(r => [r.id, r]));
  const playerById = new Map(players.map(p => [p.id, p]));
  const awardedIds = new Set<string>(), passedPairs = new Set<string>();
  const totals = new Map<string, { wins: number; totalMs: number }>();
  const accepted = submissions.filter(s => s.status === 'accepted')
    .slice().sort((a, b) => a.receivedAt - b.receivedAt || a.seq - b.seq);
  for (const sub of accepted) {
    const round = roundById.get(sub.roundId), pair = `${sub.playerId}:${sub.roundId}`;
    const player = playerById.get(sub.playerId);
    if (!round || !player || player.joinedAt > round.startedAt || passedPairs.has(pair)
      || sub.receivedAt < round.startedAt || sub.receivedAt >= round.endsAt) continue;
    passedPairs.add(pair); awardedIds.add(sub.id);
    const total = totals.get(sub.playerId) || { wins: 0, totalMs: 0 };
    total.wins++; total.totalMs += sub.receivedAt - round.startedAt;
    totals.set(sub.playerId, total);
  }
  const ranks: GameRank[] = players.map(p => {
    const total = totals.get(p.id) || { wins: 0, totalMs: 0 };
    return { ...p, ...total, score: total.wins * PASS_POINTS, rank: 0 };
  }).sort((a, b) => b.score - a.score || a.totalMs - b.totalMs || a.joinedAt - b.joinedAt
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  ranks.forEach((entry, index) => { entry.rank = index + 1; });
  const active = current?.status === 'active' && now < current.endsAt;
  // 最終競技の締切後も、期限前に受け付けた提出が確定するまで順位を確定しない。
  const finished = !!current && current.number >= TOTAL_ROUNDS && !active
    && !submissions.some(s => isPending(s.status));
  const progress: GameProgress = {
    game: { status: finished ? 'finished' : current ? 'playing' : 'lobby', totalRounds: TOTAL_ROUNDS },
    stages: Array.from({ length: TOTAL_ROUNDS }, (_, index) => {
      const number = index + 1, round = visibleRounds.find(r => r.number === number);
      return { number, status: round ? (round.id === current?.id && active ? 'active' : 'completed') : 'locked' };
    }),
  };
  return { ...progress, ranks, awardedIds };
}
