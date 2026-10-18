'use client';

import { useLayoutEffect, useRef } from 'react';
import { Users, Trophy } from 'lucide-react';
import type { GameState, Player } from './api';

export function positionOf(players: Player[], id: string): number | null {
  const index = players.findIndex(player => player.id === id);
  return index < 0 ? null : players[index].rank ?? index + 1;
}

export function LiveCount({ count, connected }: { count: number; connected: boolean }) {
  return <span className={`live-count${connected ? '' : ' live-count--offline'}`} title={connected ? '参加人数を自動更新中' : '再接続中・前回の参加人数'}>
    <i aria-hidden="true" /><Users size={12} aria-hidden="true" /><span key={count}>{count}<small>人</small></span>
  </span>;
}

export function LiveStandings({ state, playerId, preview, connected }: { state: GameState | null; playerId: string; preview: boolean; connected: boolean }) {
  const listRef = useRef<HTMLOListElement>(null);
  const previousPositions = useRef(new Map<string, number>());
  const players = state?.ranks ?? [];
  const rank = positionOf(players, playerId);
  const count = state?.stats.players ?? state?.players.length ?? 0;
  const own = players.find(player => player.id === playerId);
  const fingerprint = players.map(player => `${player.id}:${player.rank ?? ''}:${player.score ?? player.wins ?? 0}`).join('|');

  useLayoutEffect(() => {
    const nextPositions = new Map<string, number>();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const row of listRef.current?.querySelectorAll<HTMLElement>('[data-player]') ?? []) {
      const id = row.dataset.player!;
      const top = row.offsetTop;
      const previous = previousPositions.current.get(id);
      if (!reducedMotion && previous !== undefined && previous !== top) {
        row.animate([{ transform: `translateY(${previous - top}px)`, backgroundColor: '#fff0ab' }, { transform: 'translateY(0)', backgroundColor: '' }], { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
      nextPositions.set(id, top);
    }
    previousPositions.current = nextPositions;
  }, [fingerprint]);

  return <>
    <div className="ranking-live-summary">
      <span><Users size={15} aria-hidden="true" />参加 {count}人{typeof state?.stats.activePlayers === 'number' && <small>（接続中 {state.stats.activePlayers}人）</small>}</span>
      <span className={connected ? 'live-indicator' : 'live-indicator offline'}><i aria-hidden="true" />{connected ? '自動更新中' : '再接続中'}</span>
    </div>
    <div className="my-rank-summary" role="status" aria-live="polite" aria-atomic="true">
      <Trophy size={21} aria-hidden="true" /><span>あなたの順位<strong>{rank ? `${rank}位` : '—'}</strong></span>
      <small>{typeof own?.score === 'number' ? `${own.score.toLocaleString()} pt` : `${own?.wins ?? 0} クリア`}</small>
    </div>
    <ol className="ranking-list" ref={listRef} aria-label="参加者の順位">
      {players.map((player, index) => {
        const position = player.rank ?? index + 1;
        const isMe = player.id === playerId;
        return <li key={player.id} data-player={player.id} className={isMe ? 'my-rank' : ''}>
          <span className={`rank-number rank-number--${Math.min(position, 4)}`}>{position <= 3 ? <><span aria-hidden="true">♛</span><small>{position}</small></> : position}</span>
          <span className="rank-avatar" aria-hidden="true">{player.name.slice(0, 1)}</span>
          <span className="rank-name">{player.name}{isMe && <small>（あなた）</small>}</span>
          <strong>{preview ? `${[12400,11800,10200,9600,8750,6230][index] ?? 0} pt` : typeof player.score === 'number' ? `${player.score.toLocaleString()} pt` : `${player.wins ?? 0} クリア`}</strong>
        </li>;
      })}
    </ol>
    {!players.length && <p className="state-note">参加者が集まると、ここに順位が表示されます。</p>}
    <p className="ranking-footnote">{state?.stats.pending ? `${state.stats.pending}人の写真を判定中` : '結果が届くと順位が更新されます'}</p>
  </>;
}
