/** 小さな拡張パネルでも案内を読み切れる、ページ式の補助画面。 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** 本文の実寸に収まる文字範囲を測定し、改行や画面回転でも全文を読めるようにする。 */
export function TextPager({ text, label = '説明' }: { text: string; label?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  // dialogが開く前は寸法が0なので、実測前の長文で一瞬はみ出させない。
  const [pages, setPages] = useState(() => [{ start: 0, text: '' }]);
  useEffect(() => setOffset(0), [text]);
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    /** 実際の折り返しと改行を、レイアウト外の測定面で確認する。 */
    function measure() {
      if (!element || element.clientWidth < 1 || element.clientHeight < 1) return;
      const characters = Array.from(text);
      const width = element.clientWidth;
      const available = Math.max(24, element.clientHeight - 46);
      const wrapper = document.createElement('div');
      wrapper.setAttribute('aria-hidden', 'true');
      Object.assign(wrapper.style, { position: 'fixed', left: '0', top: '0', width: `${width}px`, height: '0', overflow: 'hidden', visibility: 'hidden', pointerEvents: 'none', contain: 'strict' });
      const probe = document.createElement('p');
      probe.className = 'paged-copy';
      wrapper.append(probe);
      document.body.append(wrapper);
      const result: Array<{ start: number; text: string }> = [];
      try {
        let start = 0;
        while (start < characters.length) {
          let low = 1;
          let high = Math.min(characters.length - start, 4096);
          let fits = 1;
          while (low <= high) {
            const middle = Math.floor((low + high) / 2);
            probe.textContent = characters.slice(start, start + middle).join('');
            if (probe.getBoundingClientRect().height <= available) { fits = middle; low = middle + 1; }
            else high = middle - 1;
          }
          result.push({ start, text: characters.slice(start, start + fits).join('') });
          start += fits;
        }
        if (!result.length) result.push({ start: 0, text: '' });
        setPages(previous => previous.length === result.length && previous.every((value, index) => value.start === result[index]?.start && value.text === result[index]?.text) ? previous : result);
      } finally { wrapper.remove(); }
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text]);
  const current = pages.reduce((selected, page, index) => page.start <= offset ? index : selected, 0);
  return <div ref={container} className="text-pager">
    <p className="paged-copy" aria-label={label}>{pages[current]?.text ?? ''}</p>
    {pages.length > 1 && <nav className="pagination" aria-label={`${label}のページ`}>
      <button type="button" disabled={current === 0} onClick={() => setOffset(pages[current - 1]!.start)}>← 前</button>
      <span aria-live="polite">{current + 1} / {pages.length}</span>
      <button type="button" disabled={current >= pages.length - 1} onClick={() => setOffset(pages[current + 1]!.start)}>次 →</button>
    </nav>}
  </div>;
}

/** フォーカスを閉じ込め、閉じた後は呼び出し元へ返す。 */
export function CompactDialog({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="compact-dialog" aria-label={title} onCancel={onClose}>
    <header className="dialog-heading"><h2>{title}</h2><button className="dialog-close" type="button" onClick={onClose} aria-label={`${title}を閉じる`}>閉じる ×</button></header>
    <div className="dialog-content">{children}</div>
  </dialog>;
}
