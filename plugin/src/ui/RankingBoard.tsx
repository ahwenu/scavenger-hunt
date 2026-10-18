/** 確定順位のページ表示と、最新の変化だけを短時間演出するホスト用ランキング。 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { HostState, RoomSnapshot } from '../shared/contracts.js';
import trophy from './assets/trophy.png';
import girlCheer from './assets/girl-cheer.png';
import { createRankingObserver, rankingPage, rankingPageSize, type RankingCelebration } from './ranking-events.js';
import './ranking-effects.css';

export interface RankingBoardProps {
  room: RoomSnapshot;
  mode: HostState['mode'];
  /** 通信エラーからの復帰を初回同期として扱う。 */
  connected?: boolean;
  /** 非表示タブの速報は画面上のトーストへ表示する。 */
  active?: boolean;
}

/** 利用者の動きの低減設定を監視し、行移動のアニメーションにも反映する。 */
function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    /** OS設定を変更した場合も、次の演出から即座に反映する。 */
    const change = () => setReduced(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return reduced;
}

/** 現在の枠内で全順位をページ表示し、速報を常時1件だけ維持する。 */
export function RankingBoard({ room, mode, connected = true, active = true }: RankingBoardProps) {
  const observer = useRef(createRankingObserver());
  const body = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const previousPositions = useRef(new Map<string, number>());
  const previousLayout = useRef<{ roomId: string; mode: HostState['mode']; version: number; active: boolean; at: number } | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(4);
  const [visible, setVisible] = useState(() => !document.hidden);
  const [celebration, setCelebration] = useState<RankingCelebration | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const celebrationTab = useRef(active);
  const reduced = useReducedMotion();
  const observing = connected && visible;
  const effect = celebration && celebrationTab.current === active ? celebration : null;
  const currentPage = rankingPage(room.leaderboard, page, pageSize);
  const unit = room.scoreUnit === 'wins' ? '勝' : 'pt';
  const countUnit = mode === 'sites' ? '人' : 'チーム';
  const changeById = new Map(effect?.changes.map(team => [team.teamId, team]));

  useEffect(() => {
    /** 非表示になった時点で演出を消し、復帰時の過去再生を防ぐ。 */
    const changeVisibility = () => {
      observer.current.reset();
      previousPositions.current.clear();
      previousLayout.current = null;
      setCelebration(null);
      setAnnouncement('');
      setVisible(!document.hidden);
    };
    document.addEventListener('visibilitychange', changeVisibility);
    return () => document.removeEventListener('visibilitychange', changeVisibility);
  }, []);

  useLayoutEffect(() => {
    if (!body.current) return;
    /** 枠の高さだけを測り、人数に応じて画面全体が伸びることを防ぐ。 */
    const resize = () => {
      const height = body.current?.clientHeight ?? 0;
      if (height > 0) setPageSize(rankingPageSize(height));
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(body.current);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => { setPage(0); setCelebration(null); setAnnouncement(''); }, [room.roomId, mode, room.scoreUnit]);
  // タブを切り替えても監視は続け、表示先の切替で古い演出だけを破棄する。
  useEffect(() => { setCelebration(null); }, [active]);

  useEffect(() => {
    const update = observer.current.observe(room, { mode, active: observing, connected });
    if (!observing) {
      setCelebration(null); setAnnouncement('');
      return;
    }
    if (update) { celebrationTab.current = active; setCelebration(update); setAnnouncement(update.announcement); }
  }, [room, mode, observing, connected, active]);

  useEffect(() => {
    if (!celebration) return;
    // 新しい速報は前の1件を置き換える。待ち行列を作らず最新順位を優先する。
    const timeout = window.setTimeout(() => setCelebration(null), 5_200);
    return () => window.clearTimeout(timeout);
  }, [celebration]);

  useLayoutEffect(() => {
    const at = Date.now();
    const before = previousLayout.current;
    const shouldMove = !reduced && active && observing && before?.active && before.roomId === room.roomId && before.mode === mode &&
      room.version > before.version && at - before.at <= 10_000;
    const positions = new Map<string, number>();
    list.current?.querySelectorAll<HTMLElement>('[data-team-id]').forEach(element => {
      const id = element.dataset.teamId!;
      const top = element.getBoundingClientRect().top;
      const previousTop = previousPositions.current.get(id);
      const distance = previousTop === undefined ? 0 : previousTop - top;
      if (shouldMove && Math.abs(distance) > 1 && element.animate) {
        element.animate([{ transform: `translateY(${distance}px)` }, { transform: 'translateY(0)' }], {
          duration: 580, easing: 'cubic-bezier(.2,.8,.2,1)',
        });
      }
      positions.set(id, top);
    });
    previousPositions.current = positions;
    previousLayout.current = { roomId: room.roomId, mode, version: room.version, active: observing && active, at };
  }, [room, mode, observing, active, reduced, page, pageSize]);

  const start = currentPage.start + 1;
  const end = currentPage.start + currentPage.rows.length;
  return (
    <><section className={`ranking-panel ranking-board surface ${effect ? `ranking-board--${effect.kind}` : ''}`} aria-labelledby="ranking-heading">
      <div className="ranking-board__header">
        <div><span className="section-kicker">03 / ただいまの順位</span>
          <h2 id="ranking-heading"><img className="heading-icon" src={trophy} alt="" width="28" height="27" />{room.status === 'finished' ? '最終ランキング' : 'ランキング'}</h2>
        </div>
        <span className="small-tag">{mode === 'demo' ? 'DEMO' : room.status === 'finished' ? 'FINAL' : 'LIVE'}</span>
      </div>
      <div className={`ranking-board__news ${effect ? 'ranking-board__news--active' : ''}`} key={`news:${effect?.id ?? 'standby'}`} aria-hidden="true">
        <span className="ranking-board__news-icon">{effect?.kind === 'final' ? '★' : effect?.kind === 'leader' ? '♛' : effect ? '✦' : '⚑'}</span>
        <span><strong>{effect?.title ?? (room.status === 'finished' ? 'すべての競技が終了！' : '借り物王を目指そう！')}</strong>
          <small>{effect?.detail ?? (mode === 'demo' ? 'サンプルの得点を表示しています' : 'サーバーで確定した得点・順位を表示')}</small></span>
      </div>
      <div className="ranking-board__body" ref={body}>
        {room.leaderboard.length === 0 ? <div className="ranking-board__empty"><img src={girlCheer} alt="" width="88" height="88" /><p>みんなの参加を待っています！</p></div> : (
          <ol ref={list} className="ranking-board__list" start={start} style={{ '--ranking-rows': pageSize } as CSSProperties} aria-label={`ランキング ${start}〜${end}位`}>
            {currentPage.rows.map(team => {
              const change = changeById.get(team.teamId);
              const highlighted = effect?.highlightedIds.includes(team.teamId);
              return <li key={team.teamId} data-team-id={team.teamId} className={`${team.rank === 1 ? 'ranking-board__first' : ''} ${highlighted ? 'ranking-board__changed' : ''} ${highlighted && change && (change.scoreDelta < 0 || change.rankDelta < 0 && change.scoreDelta <= 0) ? 'ranking-board__lowered' : ''}`}>
                <span className="ranking-board__number"><span className="sr-only">順位 </span>{team.rank === 1 && <span className="ranking-board__crown" aria-hidden="true">♛</span>}{team.rank}</span>
                <span className="ranking-board__name" title={team.name}>{team.name}
                  {highlighted && <small className="ranking-board__movement">{change?.joined ? 'NEW!' : change && change.rankDelta > 0 ? `↑ ${change.rankDelta} UP` : change && change.rankDelta < 0 ? `↓ ${-change.rankDelta}` : '更新！'}</small>}
                </span>
                <span className="ranking-board__score"><strong key={highlighted ? effect?.id : 'idle'} className={highlighted && change && change.scoreDelta > 0 ? 'ranking-board__score-pop' : ''}>{team.score}<small>{unit}</small></strong>
                  {highlighted && change && change.scoreDelta > 0 ? <small className="ranking-board__gain">+{change.scoreDelta}{unit}</small> : room.scoreUnit === 'wins' ? <small className="ranking-board__time">{((team.totalMs ?? 0) / 1000).toFixed(1)}秒</small> : null}
                </span>
              </li>;
            })}
          </ol>
        )}
      </div>
      <nav className="ranking-board__pager" aria-label="ランキングのページ">
        <span>{room.leaderboard.length ? `${start}–${end} / ${room.leaderboard.length}${countUnit}` : 'エントリー受付中'}</span>
        <div><button type="button" aria-label="前の順位ページ" disabled={currentPage.page === 0} onClick={() => setPage(currentPage.page - 1)}>‹</button>
          <span aria-label={`${currentPage.pages}ページ中${currentPage.page + 1}ページ`}>{currentPage.page + 1} / {currentPage.pages}</span>
          <button type="button" aria-label="次の順位ページ" disabled={currentPage.page >= currentPage.pages - 1} onClick={() => setPage(currentPage.page + 1)}>›</button></div>
      </nav>
      {effect && active && effect.kind !== 'update' && <div key={`effects:${effect.id}`} className="ranking-board__effects" aria-hidden="true">
        <div className="ranking-board__spotlight" />
        {Array.from({ length: effect.kind === 'leader' || effect.kind === 'final' ? 28 : 14 }, (_, index) => <i className="ranking-board__confetti" key={index} style={{ '--piece': index, '--drift': `${(index % 7 - 3) * 22}px`, left: `${(index * 37) % 100}%`, animationDelay: `${index % 6 * 75}ms` } as CSSProperties} />)}
      </div>}
    </section>{createPortal(<><p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
      {effect && !active && <div key={`toast:${effect.id}`} className={`ranking-toast ranking-toast--${effect.kind}`} aria-hidden="true" data-ranking-event={effect.kind}>
        <span className="ranking-toast__icon">{effect.kind === 'final' ? '★' : effect.kind === 'leader' ? '♛' : '✦'}</span>
        <span><strong>{effect.title}</strong><small>{effect.detail}</small></span>
      </div>}</>, document.body)}</>
  );
}
