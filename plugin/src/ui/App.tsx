/** カリモノのホスト用表示。通信とゲーム操作は呼び出し元へ委譲する。 */
import type { HostAction, HostState } from "../shared/contracts.js";
import { useState } from "react";
import { JoinQr } from "./JoinQr.js";
import { SoundToggle } from "./SoundControls.js";
import girlFlag from "./assets/girl-flag.png";
import robotFlag from "./assets/robot-flag.png";
import girlCheer from "./assets/girl-cheer.png";
import trophy from "./assets/trophy.png";
import crown from "./assets/crown.png";
import flagBlue from "./assets/flag-blue.png";
import "./styles.css";

export type { HostAction } from "../shared/contracts.js";

export interface HostDashboardProps {
  state: HostState;
  busy: boolean;
  error: string | null;
  onAction: (action: HostAction) => void;
  onSetHint?: (roundId: string, text: string | null) => Promise<void>;
}

/** 入力途中の文を定期同期で消さず、保存が確認できた内容と区別して表示する。 */
function CommonHint({ roundId, saved, enabled, busy, onSave }: { roundId: string; saved?: string | null; enabled: boolean; busy: boolean; onSave?: (roundId: string, text: string | null) => Promise<void> }) {
  const [draft, setDraft] = useState(saved ?? '');
  const disabled = !enabled || busy || !onSave;
  return <div className="common-hint">
    <label htmlFor="common-hint-text">共通ヒント</label>
    <p id="common-hint-help" className="helper">受付中の競技に保存すると、参加者全員が同じヒントを確認できます。AIは呼び出しません。</p>
    <textarea id="common-hint-text" aria-describedby="common-hint-help" maxLength={500} rows={3} value={draft} disabled={disabled} onChange={event => setDraft(event.target.value)} placeholder="例：机の上やかばんの中を探してみよう" />
    <div className="hint-actions">
      <span className="helper">{draft.length} / 500文字</span>
      <button className="button button-secondary" disabled={disabled || !draft.trim()} onClick={() => void onSave?.(roundId, draft.trim())}>{busy ? '処理中…' : 'ヒントを保存'}</button>
      <button className="button button-quiet" disabled={disabled} onClick={() => void onSave?.(roundId, null)}>ヒントを削除</button>
    </div>
    <p className="helper" aria-live="polite">{saved === undefined ? 'この画面では保存済みヒントをまだ取得していません。' : saved === null ? 'この競技のヒントは削除済みです。' : `保存を確認したヒント：${saved}`}</p>
    {!enabled && <p className="helper">共通ヒントの変更は写真受付中だけ利用できます。</p>}
  </div>;
}

const roomLabels = {
  lobby: "参加受付中",
  playing: "ゲーム進行中",
  finished: "ゲーム終了",
};
const roundLabels = {
  pending: "準備中",
  active: "写真受付中",
  closing: "判定を確定中",
  result: "結果発表",
};
const topicLabels = {
  empty: "未準備",
  generating: "生成中",
  ready: "準備完了",
  failed: "準備失敗",
};

/** 通信時刻を端末の表示地域に合わせ、未取得・無効値を区別する。 */
function communicationTime(value: string | null): string {
  if (!value) return "未取得";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "未取得"
    : date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
}

/** 提出の処理中と写真の合否を分けて表示する。 */
function submissionLabel(
  submission: NonNullable<
    HostState["snapshot"]
  >["teams"][number]["latestSubmission"],
): string {
  if (!submission) return "提出なし";
  if (submission.status === "failed") return "判定処理に失敗";
  if (submission.status === "queued") return "判定待ち";
  if (submission.status === "judging") return "判定中";
  if (submission.outcome === "pass") return "条件クリア";
  if (submission.outcome === "fail") return "条件に合わない";
  if (submission.outcome === "uncertain") return "写真が不鮮明";
  return "判定結果を確認中";
}

/** 安全な状態DTOだけを使ってロビー・進行・結果を表示する。 */
export function HostDashboard({
  state,
  busy,
  error,
  onAction,
  onSetHint,
}: HostDashboardProps) {
  const snapshot = state.snapshot;
  const room = snapshot?.room;
  const round = room?.currentRound;
  const isDemo = state.mode === "demo";
  const isSites = state.mode === "sites";
  const sites = snapshot?.sites;
  const canStart = isSites ? sites?.canStart === true :
    room?.status === "lobby" &&
    snapshot?.topicsStatus === "ready" &&
    snapshot.teams.length > 0;
  const canAdvance = isSites ? sites?.canAdvance === true :
    room?.status === "playing" &&
    round?.status === "result" &&
    room.roundCount !== null && round.number < room.roundCount;
  const isFinalResult =
    room?.status === "playing" &&
    round?.status === "result" &&
    room.roundCount !== null && round.number >= room.roundCount;
  const canFinish = isSites ? sites?.canEndRound === true : room?.status === "playing";
  const readyTeams =
    snapshot?.teams.filter((team) => team.latestSubmission?.outcome === "pass")
      .length ?? 0;

  return (
    <main className="host-app" aria-busy={busy}>
      <header className="masthead">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <img src={crown} alt="" width="36" height="30" />
          </span>
          <div>
            <p className="eyebrow">ONE LEASE / 運営本部</p>
            <h1>
              カリモノ
            </h1>
          </div>
        </div>
        <SoundToggle />
        <span className={`mode-badge ${isDemo ? "mode-demo" : ""}`}>
          {isDemo ? "GAME DEMO / 見本" : isSites ? room ? "SITES / 実接続" : "SITES / 接続モード" : "ゲームAPI 未接続"}
        </span>
      </header>

      <section className="intro" aria-label="カリモノ運動会">
        <div className="intro-copy">
          <span className="hero-ribbon">みんなで探して、撮って、競おう！</span>
          <p className="slogan">借り物王に<br />俺はなる<span>！</span></p>
          <p className="intro-note">ここは、カリモノの運営本部。<br />みんなの挑戦を、ここから進めよう。</p>
        </div>
        <div className="hero-characters" aria-hidden="true">
          <span className="hero-speech">よーい、カリモノ！</span>
          <img className="hero-girl" src={girlFlag} alt="" width="240" height="240" />
          <img className="hero-robot" src={robotFlag} alt="" width="170" height="170" />
          <span className="field-line field-line-one" />
          <span className="field-line field-line-two" />
        </div>
      </section>

      <div className="notice" role="status">
        <span className="notice-dot" aria-hidden="true" />
        <p>
          {state.notice ||
            (isDemo
              ? "画面確認用のデモです。参加者・得点はサンプルで、実際の部屋は作成しません。"
              : "Sites APIの接続設定が必要です。部屋の作成はまだ利用できません。")}
        </p>
      </div>
      {error && (
        <div className="error-notice" role="alert">
          <strong>操作できませんでした</strong>
          <p>{error}</p>
          <p>
            表示中の情報が古い可能性があります。「最新状態を取得」で確認してください。
          </p>
        </div>
      )}

      {!room || !snapshot ? (
        <section className="empty-room surface">
          <span className="section-kicker">HOST / ゲームの準備</span>
          <h2>運動会、はじめよう！</h2>
          <p>
            部屋を作成すると、{isSites ? "参加者" : "参加チーム"}とランキングを
            <br />
            この画面で確認できます。
          </p>
          <button
            className="button button-primary"
            disabled={busy || (!isDemo && !isSites)}
            onClick={() => onAction("create")}
          >
            {busy ? "処理中…" : isDemo ? "デモの部屋を作る" : "部屋を作る"}
            <span aria-hidden="true">↗</span>
          </button>
          {isSites && <button className="button button-quiet" disabled={busy} onClick={() => onAction("refresh")}>接続状態を再取得</button>}
          <ol className="welcome-steps" aria-label="開催の流れ">
            <li><b>1</b><span>部屋をつくる</span></li>
            <li><b>2</b><span>みんなで集合</span></li>
            <li><b>3</b><span>ゲーム開始！</span></li>
          </ol>
          <p className="helper">
            {isDemo
              ? "実際の参加・撮影・AI判定には接続しません。"
              : "接続情報はMCPサーバー側で設定します。"}
          </p>
        </section>
      ) : (
        <>
          <section className="room-bar surface" aria-labelledby="room-heading">
            <div>
              <span className="section-kicker">{isSites ? "ROOM" : "ROOM CODE"}</span>
              <h2 id="room-heading" className="room-code">
                {isSites ? room.roomName : room.roomCode}
              </h2>
            </div>
            <div className="room-summary">
              <span className="status-pill">
                <i aria-hidden="true" />
                {roomLabels[room.status]}
              </span>
              <span className="room-detail">
                {snapshot.teams.length} {isSites ? "人" : "チーム"} / {room.roundCount === null ? "問題数の上限なし" : `全${room.roundCount}問`}
              </span>
            </div>
            <button
              className="button button-quiet refresh-button"
              disabled={busy}
              onClick={() => onAction("refresh")}
            >
              {busy ? "取得中…" : "最新状態を取得"}
            </button>
          </section>
          <div className={`game-stage ${isSites ? "with-invite" : ""}`}>
          {isSites && (
            <section className="join-panel surface" aria-labelledby="join-heading">
              <span className="section-kicker">01 / みんなを招待</span>
              <h2 id="join-heading">QRを読み取って、集合！</h2>
              {room.joinUrl ? <div className="join-content"><JoinQr url={room.joinUrl} /><div className="join-details"><span className="invite-label">スマホのブラウザで参加できます</span><p>QRコードを読み取るか、下の参加URLを開いてください。</p><span className="join-link-label">参加URL</span><a className="join-url" href={room.joinUrl} target="_blank" rel="noreferrer">{room.joinUrl}</a></div></div> : <p>実AIの接続準備が完了するまで参加URLを表示しません。Sitesの設定後に新しい部屋を作成してください。</p>}
              <p className="helper">部屋ID: {room.roomId} / ホスト認証はMCPサーバー内に保持します。再起動後の部屋復帰は未対応です。</p>
              {sites?.automaticLobbyStart && <p className="helper">参加者が登録されるとSites側で初回のお題準備・開始が自動進行します。</p>}
            </section>
          )}

          <div className="dashboard-grid">
            <section
              className="topic-panel surface"
              aria-labelledby="topic-heading"
            >
              <div className="section-heading">
                <span className="section-kicker">02 / ゲームの進行</span>
                <span className="small-tag">
                  {round
                    ? room.roundCount === null ? `第 ${round.number} 問` : `${round.number} / ${room.roundCount}`
                    : room.roundCount === null ? "準備中" : `全 ${room.roundCount} 問`}
                </span>
              </div>
              <p className="topic-state">
                {room.status === "finished"
                  ? "ゲームが終了しました"
                  : round
                    ? roundLabels[round.status]
                    : "全員がそろったらスタート"}
              </p>
              <h2 id="topic-heading">
                {room.status === "finished"
                  ? "おつかれさまでした！"
                  : (round?.title ?? "次の借り物王は、誰だ。")}
              </h2>
              <p className="topic-instruction">
                {room.status === "finished"
                  ? "最終ランキングを確認して、みんなの挑戦をたたえよう。"
                  : (round?.instruction ??
                    (isSites ? "参加者とお題の準備を確認してください。Sites側で初回の開始が自動進行します。" : "参加チームとお題の準備を確認して、ゲームを開始してください。"))}
              </p>
              {isSites && sites?.stages && <ol className="stage-progress" aria-label="全競技の進行状況">
                {sites.stages.map(stage => <li key={stage.number} className={`stage-${stage.status}`} aria-current={stage.status === 'active' ? 'step' : undefined}>
                  <b>第{stage.number}競技</b><span>{{ completed: '完了', active: '進行中', locked: '未解放' }[stage.status]}</span>
                </li>)}
              </ol>}
              <div className="topic-metrics">
                <div>
                  <span>お題の準備</span>
                  <strong>{topicLabels[snapshot.topicsStatus]}</strong>
                </div>
                <div>
                  <span>{isSites && round ? "判定待ち" : round ? "条件クリア" : isSites ? "参加者" : "参加チーム"}</span>
                  <strong>
                    {isSites && round ? `${sites?.pendingJudgments ?? 0} 件` : round
                      ? `${readyTeams} / ${snapshot.teams.length}`
                      : `${snapshot.teams.length} ${isSites ? "人" : "チーム"}`}
                  </strong>
                </div>
                {round && (
                  <div>
                    <span>写真の受付締切</span>
                    <strong>{communicationTime(round.deadlineAt)}</strong>
                  </div>
                )}
              </div>
              <div className="host-actions">
                {(room.status === "lobby" || isSites && sites?.canPrepare) &&
                  snapshot.topicsStatus !== "ready" && (
                    <button
                      className="button button-secondary"
                      disabled={
                        busy ||
                        (!isDemo && !(isSites && sites?.canPrepare)) ||
                        snapshot.topicsStatus === "generating"
                      }
                      onClick={() => onAction("prepare")}
                    >
                      {isSites ? "AIのお題を準備" : "お題を準備（デモ）"}
                    </button>
                  )}
                <button
                  className="button button-primary"
                  disabled={busy || !canStart}
                  onClick={() => onAction("start")}
                >
                  ゲーム開始 <span aria-hidden="true">→</span>
                </button>
                <button
                  className="button button-secondary"
                  disabled={busy || !canAdvance}
                  onClick={() => onAction("advance")}
                >
                  次のお題へ
                </button>
                <button
                  className="button button-danger"
                  disabled={busy || !canFinish}
                  onClick={() => onAction("finish")}
                >
                  {isSites ? "ラウンドの受付を終了" : "ゲーム終了"}
                </button>
              </div>
              {isSites && <CommonHint key={round?.roundId ?? 'waiting'} roundId={round?.roundId ?? ''} saved={round?.hint} enabled={sites?.canSetHint === true && room.status !== 'finished'} busy={busy} onSave={onSetHint} />}
              <p className="helper">
                {isSites ? room.status === "finished" ? "全競技が終了しました。最終ランキングを確認してください。" : !sites?.aiAvailable ? "Sites側のAI設定が必要です。デモへは切り替えません。" : sites?.gameMode !== 'ai' ? "実AIモードへの変更が必要です。" : canAdvance ? "次のお題を生成して開始します。有料のAI呼び出しを伴う場合があります。" : "受付終了は現在ラウンドだけに適用します。部屋全体の終了APIは未実装です。" : canStart
                  ? "全員の準備ができたら開始してください。"
                  : room.status === "lobby"
                    ? "参加チームとお題の準備が必要です。"
                    : room.status === "finished"
                      ? "このゲームは終了しています。"
                      : isFinalResult
                        ? "最終問題の結果を確認したら「ゲーム終了」で確定してください。"
                        : canAdvance
                          ? "結果を確認してから次へ進めてください。"
                          : "写真の受付・判定が終わると次へ進めます。"}
              </p>
            </section>

            <section
              className="ranking-panel surface"
              aria-labelledby="ranking-heading"
            >
              <div className="section-heading">
                <span className="section-kicker">03 / ただいまの順位</span>
                <span className="small-tag">
                  {room.status === "finished" ? "FINAL" : "LIVE VIEW"}
                </span>
              </div>
              <h2 id="ranking-heading"><img className="heading-icon" src={trophy} alt="" width="32" height="31" />
                {room.status === "finished" ? "最終ランキング" : "ランキング"}
              </h2>
              <p className="section-description">
                {isDemo
                  ? "サンプルの得点を表示しています。"
                  : isSites ? room.scoreUnit === "points" ? "獲得ポイントの多い順です。同点はサーバーが確定した順位を表示します。" : "勝数が多い順、同数なら累計回答時間が短い順です。さらに同じ場合は参加順・ID順です。" : "サーバーで確定した得点を表示します。"}
              </p>
              {room.leaderboard.length === 0 ? (
                <div className="ranking-empty"><img src={girlCheer} alt="" width="112" height="112" /><p className="inline-empty">{isSites ? "みんなの参加を待っています！" : "参加チームがそろうと表示されます。"}</p></div>
              ) : (
                <ol className="ranking-list">
                  {room.leaderboard.map((team) => (
                    <li
                      key={team.teamId}
                      className={team.rank === 1 ? "rank-first" : ""}
                    >
                      <span className="rank-number">
                        <span className="sr-only">順位 </span>
                        {team.rank}
                      </span>
                      <span className="rank-team">{team.name}</span>
                      <span className="rank-score">
                        {team.score}
                        <small>{room.scoreUnit === 'wins' ? "勝" : "pt"}</small>
                        {room.scoreUnit === 'wins' && <span className="rank-time">累計 {((team.totalMs ?? 0) / 1000).toFixed(1)}秒</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          <section
            className="teams-panel surface"
            aria-labelledby="teams-heading"
          >
            <div className="section-heading">
              <div>
                <span className="section-kicker">04 / 選手のみなさん</span>
                <h2 id="teams-heading"><img className="heading-icon" src={flagBlue} alt="" width="25" height="26" />
                  {isSites ? "参加者" : "参加チーム"}
                  <span className="count-label">{snapshot.teams.length}</span>
                </h2>
              </div>
              <span className="table-caption">{isSites ? "Sitesの登録参加者" : "代表端末ごとに1チーム"}</span>
            </div>
            {snapshot.teams.length === 0 ? (
              <p className="inline-empty">{isSites ? "参加者はまだいません。" : "参加チームはまだありません。"}</p>
            ) : (
              <ul className="teams-list">
                {snapshot.teams.map((team, index) => (
                  <li key={team.teamId}>
                    <span className="team-avatar" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="team-name">
                      <strong>{team.name}</strong>
                      <span>{isSites ? "参加登録済み" : `最終通信 ${communicationTime(team.lastSeenAt)}`}</span>
                    </div>
                    <span
                      className={`submission-state ${team.latestSubmission?.outcome === "pass" ? "submission-pass" : ""}`}
                    >
                      {isSites ? "個別提出状況は未取得" : submissionLabel(team.latestSubmission)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="helper">
              {isSites ? "Sitesの集計APIには個別の最終通信・最新提出結果が含まれません。接続中や提出なしとは判定していません。" : "最終通信は取得した記録です。接続中であることを保証する表示ではありません。"}
            </p>
          </section>
          </div>
          {isDemo && (
            <p className="demo-footnote">
              この部屋コードはデモ用です。スマホから参加することはできません。
            </p>
          )}
        </>
      )}
      <footer className="footer">
        <span>カリモノ / ONE LEASE</span>
        <span>運営本部 / HOST</span>
      </footer>
    </main>
  );
}

export default HostDashboard;
