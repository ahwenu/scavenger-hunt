/** カリモノのホスト用表示。通信とゲーム操作は呼び出し元へ委譲する。 */
import type { HostAction, HostState } from "../shared/contracts.js";
import "./styles.css";

export type { HostAction } from "../shared/contracts.js";

export interface HostDashboardProps {
  state: HostState;
  busy: boolean;
  error: string | null;
  onAction: (action: HostAction) => void;
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
}: HostDashboardProps) {
  const snapshot = state.snapshot;
  const room = snapshot?.room;
  const round = room?.currentRound;
  const isDemo = state.mode === "demo";
  const canStart =
    room?.status === "lobby" &&
    snapshot?.topicsStatus === "ready" &&
    snapshot.teams.length > 0;
  const canAdvance =
    room?.status === "playing" &&
    round?.status === "result" &&
    round.number < room.roundCount;
  const isFinalResult =
    room?.status === "playing" &&
    round?.status === "result" &&
    round.number >= room.roundCount;
  const canFinish = room?.status === "playing";
  const readyTeams =
    snapshot?.teams.filter((team) => team.latestSubmission?.outcome === "pass")
      .length ?? 0;

  return (
    <main className="host-app" aria-busy={busy}>
      <header className="masthead">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            K
          </span>
          <div>
            <p className="eyebrow">ONE LEASE / HOST CONSOLE</p>
            <h1>
              カリモノ<span className="brand-period">.</span>
            </h1>
          </div>
        </div>
        <span className={`mode-badge ${isDemo ? "mode-demo" : ""}`}>
          {isDemo ? "GAME DEMO / 見本" : "ゲームAPI 未接続"}
        </span>
      </header>

      <section className="intro">
        <div>
          <p className="slogan">借り物王に俺はなる！</p>
          <p className="intro-note">
            探す。撮る。競い合う。
            <br className="narrow-only" />
            みんなの挑戦を、ここから進めよう。
          </p>
        </div>
        <span className="host-label">
          HOST
          <br />
          CONTROL
        </span>
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
          <span className="section-kicker">01 / CREATE A ROOM</span>
          <h2>さあ、ゲームの準備を。</h2>
          <p>
            部屋を作成すると、参加チームとランキングを
            <br />
            この画面で確認できます。
          </p>
          <button
            className="button button-primary"
            disabled={busy || !isDemo}
            onClick={() => onAction("create")}
          >
            {busy ? "処理中…" : isDemo ? "デモの部屋を作る" : "部屋を作る"}
            <span aria-hidden="true">↗</span>
          </button>
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
              <span className="section-kicker">ROOM CODE</span>
              <h2 id="room-heading" className="room-code">
                {room.roomCode}
              </h2>
            </div>
            <div className="room-summary">
              <span className="status-pill">
                <i aria-hidden="true" />
                {roomLabels[room.status]}
              </span>
              <span className="room-detail">
                {snapshot.teams.length} チーム / 全{room.roundCount}問
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

          <div className="dashboard-grid">
            <section
              className="topic-panel surface"
              aria-labelledby="topic-heading"
            >
              <div className="section-heading">
                <span className="section-kicker">01 / GAME PROGRESS</span>
                <span className="small-tag">
                  {round
                    ? `${round.number} / ${room.roundCount}`
                    : `全 ${room.roundCount} 問`}
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
                    "参加チームとお題の準備を確認して、ゲームを開始してください。")}
              </p>
              <div className="topic-metrics">
                <div>
                  <span>お題の準備</span>
                  <strong>{topicLabels[snapshot.topicsStatus]}</strong>
                </div>
                <div>
                  <span>{round ? "条件クリア" : "参加チーム"}</span>
                  <strong>
                    {round
                      ? `${readyTeams} / ${snapshot.teams.length}`
                      : `${snapshot.teams.length} チーム`}
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
                {room.status === "lobby" &&
                  snapshot.topicsStatus !== "ready" && (
                    <button
                      className="button button-secondary"
                      disabled={
                        busy ||
                        !isDemo ||
                        snapshot.topicsStatus === "generating"
                      }
                      onClick={() => onAction("prepare")}
                    >
                      お題を準備（デモ）
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
                  ゲーム終了
                </button>
              </div>
              <p className="helper">
                {canStart
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
                <span className="section-kicker">02 / LEADERBOARD</span>
                <span className="small-tag">
                  {room.status === "finished" ? "FINAL" : "LIVE VIEW"}
                </span>
              </div>
              <h2 id="ranking-heading">
                {room.status === "finished" ? "最終ランキング" : "ランキング"}
              </h2>
              <p className="section-description">
                {isDemo
                  ? "サンプルの得点を表示しています。"
                  : "サーバーで確定した得点を表示します。"}
              </p>
              {room.leaderboard.length === 0 ? (
                <p className="inline-empty">
                  参加チームがそろうと表示されます。
                </p>
              ) : (
                <ol className="ranking-list">
                  {room.leaderboard.map((team) => (
                    <li
                      key={team.teamId}
                      className={team.rank === 1 ? "rank-first" : ""}
                    >
                      <span className="rank-number">
                        <span className="sr-only">順位 </span>
                        {String(team.rank).padStart(2, "0")}
                      </span>
                      <span className="rank-team">{team.name}</span>
                      <span className="rank-score">
                        {team.score}
                        <small>pt</small>
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
                <span className="section-kicker">03 / PARTICIPANTS</span>
                <h2 id="teams-heading">
                  参加チーム
                  <span className="count-label">{snapshot.teams.length}</span>
                </h2>
              </div>
              <span className="table-caption">代表端末ごとに1チーム</span>
            </div>
            {snapshot.teams.length === 0 ? (
              <p className="inline-empty">参加チームはまだありません。</p>
            ) : (
              <ul className="teams-list">
                {snapshot.teams.map((team, index) => (
                  <li key={team.teamId}>
                    <span className="team-avatar" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="team-name">
                      <strong>{team.name}</strong>
                      <span>最終通信 {communicationTime(team.lastSeenAt)}</span>
                    </div>
                    <span
                      className={`submission-state ${team.latestSubmission?.outcome === "pass" ? "submission-pass" : ""}`}
                    >
                      {submissionLabel(team.latestSubmission)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="helper">
              最終通信は取得した記録です。接続中であることを保証する表示ではありません。
            </p>
          </section>
          {isDemo && (
            <p className="demo-footnote">
              この部屋コードはデモ用です。スマホから参加することはできません。
            </p>
          )}
        </>
      )}
      <footer className="footer">
        <span>カリモノ / ONE LEASE</span>
        <span>HOST CONSOLE · SCAFFOLD</span>
      </footer>
    </main>
  );
}

export default HostDashboard;
