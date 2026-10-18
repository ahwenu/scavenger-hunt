/** Ahwenu担当のAI APIを、ゲーム状態を変えずに確認する表示。 */
import { useEffect, useState } from 'react';
import type { AIChallenge, AIStatus } from '../shared/ai-contracts.js';
import { TextPager } from './CompactDialog.js';
import './AiPreview.css';

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
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

/** 接続操作と長い生成結果をページで分け、全内容を小さい画面でも読めるようにする。 */
export function AiPreview({ status, challenge, busy, error, onCheck, onGenerate }: AiPreviewProps) {
  const [view, setView] = useState<'connection' | 'result' | 'reference'>('connection');
  const canGenerate = Boolean(status?.configured && status.available);
  useEffect(() => { if (challenge) setView('result'); }, [challenge?.challengeId]);
  const sourceUrl = safeLink(challenge?.reference?.sourcePageUrl);
  const licenseUrl = safeLink(challenge?.reference?.licenseUrl);
  return <section className="ai-preview" aria-label="独立AIのお題プレビュー" aria-busy={busy}>
    <nav className="detail-tabs" aria-label="独立AIの表示"><button aria-pressed={view === 'connection'} onClick={() => setView('connection')}>接続・操作</button><button disabled={!challenge} aria-pressed={view === 'result'} onClick={() => setView('result')}>生成結果</button>{challenge?.reference && <button aria-pressed={view === 'reference'} onClick={() => setView('reference')}>写真の出典</button>}</nav>
    {view === 'connection' ? <>
      <span className={`ai-preview-status ${canGenerate ? 'ai-preview-ready' : ''}`}>{canGenerate ? 'API利用可能' : status ? '要接続確認' : '接続未確認'}</span>
      <TextPager label="独立AIの接続状態" text={[error && `APIエラー：${error}`, status?.notice || '「API接続を確認」で利用可能な状態か確認してください。', status?.configured ? 'AI APIへ実接続します。生成したお題はゲームの部屋には反映しません。' : 'APIの設定と接続を確認すると、お題生成を試せます。'].filter(Boolean).join('\n\n')} />
      <div className="ai-preview-actions"><button disabled={busy} onClick={onCheck}>API接続を確認</button><button className="ai-preview-generate" disabled={busy || !canGenerate} onClick={onGenerate}>{busy ? 'API処理中…' : 'AIでお題を生成'}</button></div>
    </> : view === 'result' && challenge ? <TextPager label="生成したお題" text={`${challenge.title}\n\n${challenge.description}\n\n制限時間：${challenge.durationSeconds}秒\n\n判定条件\n${challenge.criteria.map((criterion, index) => `${index + 1}. ${criterion}`).join('\n')}\n\nお題ID：${challenge.challengeId}`} /> : challenge?.reference ? <>
      <TextPager label="参考写真の出典" text={`参考写真はAPI側で保持しています。\n\n作者：${challenge.reference.author}\nライセンス：${challenge.reference.licenseName}`} />
      <div className="ai-reference-links">{sourceUrl && <a href={sourceUrl} target="_blank" rel="noopener noreferrer">写真の出典を開く ↗</a>}{licenseUrl && <a href={licenseUrl} target="_blank" rel="noopener noreferrer">ライセンスを開く ↗</a>}</div>
    </> : null}
  </section>;
}
