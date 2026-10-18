/** 事前招待の参加URLと配布画像を、ユーザーの明示操作だけで取り出す。 */
import { useRef, useState } from 'react';
import { createInvitationFile, validateJoinUrl, type InvitationFile } from './join-invitation.js';
import { TextPager } from './CompactDialog.js';

/** ホストの保存ブリッジとクリップボードを使い、制限時も手動コピーを案内する。 */
export function InvitationShare({ url, automaticStart, onDownload }: { url: string; automaticStart: boolean; onDownload?: (file: InvitationFile) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState<'url' | 'image' | 'guide'>('url');
  let safeUrl: string;
  try { validateJoinUrl(url); safeUrl = url; }
  catch { return <p role="alert">参加URLの形式を確認できないため、配布できません。</p>; }

  /** コピー禁止の環境では選択状態を残し、OSのコピー操作へ引き継ぐ。 */
  async function copyUrl() {
    input.current?.focus(); input.current?.select();
    try { await navigator.clipboard.writeText(safeUrl); setMessage('参加URLをコピーしました。メッセージや案内に貼り付けて配布できます。'); }
    catch { setMessage('参加URLを選択しました。コピー操作（⌘C / Ctrl+C）で取り出してください。'); }
  }

  /** 保存はiframeのダウンロード制限を回避せず、ホストへ明示的に依頼する。 */
  async function save(format: 'svg' | 'png') {
    if (!onDownload) { setMessage('この環境では画像を保存できません。参加URLをコピーして配布してください。'); return; }
    setBusy(true); setMessage('');
    try { await onDownload(createInvitationFile(safeUrl, format)); setMessage(`${format.toUpperCase()}の保存を依頼しました。保存したQRを配布できます。`); }
    catch (error) { setMessage(error instanceof Error ? error.message : '画像を保存できませんでした。参加URLをコピーして配布してください。'); }
    finally { setBusy(false); }
  }

  return <div className="invitation-share">
    <nav className="detail-tabs" aria-label="招待の配布方法">{([['url', 'URLで配布'], ['image', 'QR画像'], ['guide', '使い方']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={tab === value} disabled={busy} onClick={() => { setTab(value); setMessage(''); }}>{label}</button>)}</nav>
    {tab === 'url' ? <>
      <label htmlFor="invitation-url">配布する参加URL</label>
      <input ref={input} id="invitation-url" className="invitation-url-input" readOnly value={safeUrl} onFocus={event => event.currentTarget.select()} />
      <div className="invitation-actions"><button type="button" className="button button-secondary" onClick={() => void copyUrl()}>参加URLをコピー</button></div>
      <p className="helper">コピーしたURLをメッセージや開催案内に貼り付けて配布できます。</p>
    </> : tab === 'image' ? <>
      <p className="invitation-instruction">参加QRを画像にして配布できます。</p>
      <div className="invitation-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={() => void save('png')}>QRをPNG保存</button><button type="button" className="button button-quiet" disabled={busy} onClick={() => void save('svg')}>QRをSVG保存</button></div>
      <p className="helper">PNGはメッセージへの添付、SVGは拡大・印刷に使えます。保存先の確認が出たら選んでください。</p>
    </> : <TextPager label="事前招待の使い方" text={`${automaticStart ? 'この既存部屋は自動開始が有効です。事前配布には新しい部屋を作成してください。' : 'このQRは開催前から配布できます。参加者は同じ部屋で待機し、ホストが「ゲーム開始」を押すと始まります。'}\n\n新しい部屋を作ると別のQRになります。当日も配布したQRと同じ部屋を使ってください。\n\n画像を保存できない環境では「URLで配布」を選びます。コピーが制限される場合はURL欄を選択し、通常のコピー操作で取り出してください。`} />}
    {tab !== 'guide' && <p className="invitation-status" role="status">{busy ? 'QRを準備しています…' : message || (automaticStart ? 'この部屋は自動開始が有効です。詳しくは「使い方」を確認してください。' : '参加者は同じ部屋で待機します。当日もこの部屋を使ってください。')}</p>}
  </div>;
}
