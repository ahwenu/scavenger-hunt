/** サーバーの確定順位を比較し、短命な表示用の速報へ集約する。採点や順位の計算は行わない。 */
import type { HostState, RoomSnapshot } from '../shared/contracts.js';

export interface RankingChange {
  teamId: string;
  name: string;
  rank: number;
  score: number;
  scoreDelta: number;
  rankDelta: number;
  joined: boolean;
}

export interface RankingCelebration {
  id: string;
  kind: 'join' | 'score' | 'rise' | 'leader' | 'final' | 'update';
  title: string;
  detail: string;
  announcement: string;
  changes: RankingChange[];
  highlightedIds: string[];
  joinedCount: number;
  removedCount: number;
}

interface ObservationOptions {
  mode: HostState['mode'];
  active?: boolean;
  connected?: boolean;
  now?: number;
}

interface Baseline {
  room: RoomSnapshot;
  mode: HostState['mode'];
  at: number;
}

/** 初回・復帰・非表示・接続切断・逆行したversionを基準値として吸収する。 */
export function createRankingObserver() {
  let previous: Baseline | null = null;
  return {
    /** 次の取得を初回として扱い、保持中の過去差分を破棄する。 */
    reset() { previous = null; },
    /** 同期1回分の変化を1件の速報へまとめる。長い通信断の後は過去の変化を再生しない。 */
    observe(room: RoomSnapshot, options: ObservationOptions): RankingCelebration | null {
      if (options.active === false || options.connected === false || options.mode === 'unconfigured') {
        previous = null;
        return null;
      }
      const at = options.now ?? Date.now();
      const before = previous;
      const sameRoom = before?.room.roomId === room.roomId && before.mode === options.mode && before.room.scoreUnit === room.scoreUnit;
      if (before && sameRoom && room.version <= before.room.version) {
        // 遅れて届いた応答でも基準versionを戻さず、後続の重複演出を防ぐ。
        previous = { ...before, at };
        return null;
      }
      // DTOが呼び出し元で書き換えられても、前回の確定値を維持する。
      previous = { room: { ...room, teams: room.teams.map(team => ({ ...team })), leaderboard: room.leaderboard.map(team => ({ ...team })) }, mode: options.mode, at };
      if (!before || !sameRoom ||
          at - before.at > 10_000 || at < before.at) return null;

      const oldRows = new Map(before.room.leaderboard.map(team => [team.teamId, team]));
      const oldTeams = new Set(before.room.teams.map(team => team.teamId));
      const joinedTeams = room.teams.filter(team => !oldTeams.has(team.teamId));
      const joinedIds = new Set(joinedTeams.map(team => team.teamId));
      const countUnit = options.mode === 'sites' ? '人' : 'チーム';
      const nextIds = new Set(room.teams.map(team => team.teamId));
      const removedTeams = before.room.teams.filter(team => !nextIds.has(team.teamId));
      const nextRowIds = new Set(room.leaderboard.map(team => team.teamId));
      const removedRows = before.room.leaderboard.filter(team => !nextRowIds.has(team.teamId));
      const removed = [...new Map([...removedTeams, ...removedRows].map(team => [team.teamId, team])).values()];
      const unit = room.scoreUnit === 'wins' ? '勝' : 'pt';
      const changes = room.leaderboard.flatMap(team => {
        const old = oldRows.get(team.teamId);
        const joined = joinedIds.has(team.teamId);
        if (old && old.score === team.score && old.rank === team.rank && old.name === team.name && old.totalMs === team.totalMs && !joined) return [];
        return [{ teamId: team.teamId, name: team.name, rank: team.rank, score: team.score,
          scoreDelta: old ? team.score - old.score : 0,
          rankDelta: old ? old.rank - team.rank : 0, joined }];
      });
      const leader = room.leaderboard.find(team => team.rank === 1);
      const oldLeader = before.room.leaderboard.find(team => team.rank === 1);
      const final = room.status === 'finished' && before.room.status !== 'finished';
      const takeover = !!leader && !!oldLeader && leader.teamId !== oldLeader.teamId;
      const scoring = changes.filter(team => team.scoreDelta > 0);
      const rising = changes.filter(team => team.rankDelta > 0);
      if (!changes.length && !joinedTeams.length && !removed.length && !final) return null;

      // 1回の大量更新でも、上位・加点・上昇を優先した最大12行だけを強調する。
      const prioritized = [...changes].sort((a, b) =>
        Number(b.teamId === leader?.teamId) - Number(a.teamId === leader?.teamId) ||
        b.scoreDelta - a.scoreDelta || b.rankDelta - a.rankDelta || a.rank - b.rank);
      const hero = prioritized[0];
      let kind: RankingCelebration['kind'] = 'update';
      let title = 'ランキング更新！';
      let detail = hero ? `${hero.name} · ${hero.rank}位 ${hero.score}${unit}` : '最新の順位を表示しています';
      if (joinedTeams.length && !scoring.length && !rising.length) {
        kind = 'join'; title = `${joinedTeams.length}${countUnit}がエントリー！`;
        detail = joinedTeams.length === 1 ? `${joinedTeams[0].name}、ようこそ！` : `${joinedTeams[0].name} ほか${joinedTeams.length - 1}${countUnit}、ようこそ！`;
      }
      if (rising.length) {
        const team = [...rising].sort((a, b) => b.rankDelta - a.rankDelta || a.rank - b.rank)[0];
        kind = 'rise'; title = `${team.rankDelta}ランク UP！`;
        detail = `${team.name} が ${team.rank}位へ！${rising.length > 1 ? ` ほか${rising.length - 1}${countUnit}も上昇` : ''}`;
      }
      if (scoring.length) {
        const team = [...scoring].sort((a, b) => b.scoreDelta - a.scoreDelta || a.rank - b.rank)[0];
        kind = 'score'; title = `+${team.scoreDelta}${unit} GET！`;
        detail = `${team.name} · 合計${team.score}${unit}${scoring.length > 1 ? ` / ほか${scoring.length - 1}${countUnit}も獲得！` : ''}`;
      }
      if (takeover && leader) {
        kind = 'leader'; title = '首位交代！';
        detail = `${leader.name} がトップへ！ ${leader.score}${unit}`;
      }
      // 修正・減点・退場は祝福せず、確定表示の更新として知らせる。
      const corrected = changes.filter(team => team.scoreDelta < 0 || (oldRows.get(team.teamId)?.name ?? team.name) !== team.name ||
        (room.scoreUnit === 'wins' && team.scoreDelta === 0 && oldRows.has(team.teamId) && oldRows.get(team.teamId)?.totalMs !== room.leaderboard.find(row => row.teamId === team.teamId)?.totalMs));
      if (corrected.length || removed.length) {
        kind = 'update'; title = '順位情報を更新';
        const correctedRow = room.leaderboard.find(team => team.teamId === corrected[0]?.teamId);
        detail = removed.length ? `${removed[0].name}${removed.length > 1 ? ` ほか${removed.length - 1}${countUnit}` : ''}が一覧から外れました` : `${corrected[0].name} · ${corrected[0].rank}位 ${corrected[0].score}${unit}${room.scoreUnit === 'wins' ? ` · ${((correctedRow?.totalMs ?? 0) / 1000).toFixed(1)}秒` : ''}`;
      }
      if (final) {
        kind = 'final'; title = '最終ランキング確定！';
        detail = leader ? `優勝 ${leader.name} · ${leader.score}${unit}！` : 'すべての競技が終了しました';
      }
      return { id: `${room.roomId}:${room.version}`, kind, title, detail,
        announcement: `${title} ${detail}${joinedTeams.length && kind !== 'join' ? ` 新たに${joinedTeams.length}${countUnit}が参加。` : ''}`,
        changes, highlightedIds: prioritized.slice(0, 12).map(team => team.teamId), joinedCount: joinedTeams.length, removedCount: removed.length };
    },
  };
}

/** 使用可能な高さから、スクロールせず読める行数を決める。 */
export function rankingPageSize(height: number): number {
  return Math.max(1, Math.min(8, Math.floor(height / 47)));
}

/** 確定順位の配列をページへ分け、人数や高さが変わってもページ範囲を保つ。 */
export function rankingPage<T>(rows: T[], requestedPage: number, pageSize: number) {
  const size = Math.max(1, Math.floor(pageSize));
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.max(0, Math.min(pages - 1, Math.floor(requestedPage)));
  const start = page * size;
  return { page, pages, start, rows: rows.slice(start, start + size) };
}
