/** Ahwenu担当のAI APIを、ゲーム状態を変えずに確認する表示。 */
import type { AIChallenge, AIStatus } from "../shared/ai-contracts.js";
import robotJudging from "./assets/robot-judging.png";
import "./AiPreview.css";

/** 通信と秘密設定は呼び出し元に委譲する。 */
export interface AiPreviewProps {
  status: AIStatus | null;
  challenge: AIChallenge | null;
  busy: boolean;
  error: string | null;
  onCheck(): void;
  onGenerate(): void;
}

/** 外部リンクは認証情報を含まないHTTPS URLに限る。 */
function safeLink(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** 参考写真を直接読み込まず、出典とライセンスだけを表示する。 */
function ReferenceCredits({ reference }: { reference: AIChallenge["reference"] }) {
  if (!reference) return null;
  const sourceUrl = safeLink(reference.sourcePageUrl);
  const licenseUrl = safeLink(reference.licenseUrl);

  return (
    <aside className="ai-preview-reference" aria-label="参考写真の出典">
      <p className="ai-preview-reference-label">参考写真はAPI側で保持</p>
      <dl>
        <div>
          <dt>作者</dt>
          <dd>{reference.author}</dd>
        </div>
        <div>
          <dt>ライセンス</dt>
          <dd>
            {licenseUrl ? (
              <a href={licenseUrl} target="_blank" rel="noopener noreferrer">
                {reference.licenseName} ↗
              </a>
            ) : (
              reference.licenseName
            )}
          </dd>
        </div>
      </dl>
      {sourceUrl && (
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
          写真の出典を開く ↗
        </a>
      )}
    </aside>
  );
}

/** APIの接続状態と実際に返されたお題を表示する。 */
export function AiPreview({
  status,
  challenge,
  busy,
  error,
  onCheck,
  onGenerate,
}: AiPreviewProps) {
  const canGenerate = Boolean(status?.configured && status.available);

  return (
    <section
      className="ai-preview"
      aria-labelledby="ai-preview-heading"
      aria-busy={busy}
    >
      <div className="ai-preview-heading">
        <div className="ai-preview-title"><img src={robotJudging} width="64" height="64" alt="" /><div>
          <p className="ai-preview-kicker">AI / お題を試してみる</p>
          <h2 id="ai-preview-heading">お題プレビュー</h2>
        </div></div>
        <span className={`ai-preview-status ${canGenerate ? "ai-preview-ready" : ""}`}>
          {canGenerate ? "API利用可能" : status ? "要接続確認" : "接続未確認"}
        </span>
      </div>

      <p className="ai-preview-description">
        {status?.configured
          ? "AI APIへ実接続・ゲームの部屋にはまだ反映しません。"
          : "APIの設定と接続を確認すると、お題生成を試せます。"}
      </p>
      <p className="ai-preview-notice" role="status">
        {status?.notice || "「API接続を確認」で利用可能な状態か確認してください。"}
      </p>

      <div className="ai-preview-actions">
        <button type="button" disabled={busy} onClick={onCheck}>
          API接続を確認
        </button>
        <button
          type="button"
          className="ai-preview-generate"
          disabled={busy || !canGenerate}
          onClick={onGenerate}
        >
          AIでお題を生成
        </button>
        {busy && <span role="status">API処理中…</span>}
      </div>

      {error && (
        <p className="ai-preview-error" role="alert">
          {error}
        </p>
      )}

      {challenge && (
        <article className="ai-preview-result" aria-label="生成したお題">
          <p className="ai-preview-kicker">GENERATED CHALLENGE</p>
          <h3>{challenge.title}</h3>
          <p>{challenge.description}</p>
          <p className="ai-preview-kicker">お題ID: {challenge.challengeId}</p>
          <div className="ai-preview-result-meta">
            <strong>判定条件</strong>
            <span>制限時間 {challenge.durationSeconds}秒</span>
          </div>
          <ul>
            {challenge.criteria.map((criterion, index) => (
              <li key={`${index}-${criterion}`}>{criterion}</li>
            ))}
          </ul>
          <ReferenceCredits reference={challenge.reference} />
        </article>
      )}
    </section>
  );
}
