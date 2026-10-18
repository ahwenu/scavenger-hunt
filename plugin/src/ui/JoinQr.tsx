/** 参加URLのQRを拡張内で生成し、外部通信なしでインラインSVGへ描画する。 */
import { useMemo } from 'react';
import { createJoinQr } from './join-invitation.js';

/** 部屋URLが変わるとQRを再生成し、失敗時も併設の参加リンクで参加できるようにする。 */
export function JoinQr({ url }: { url: string }) {
  const code = useMemo(() => {
    try { return createJoinQr(url); }
    catch { return null; }
  }, [url]);

  if (!code) {
    return <p className="join-qr-error" role="status">QRコードを表示できませんでした。参加URLをスマホで開いてください。</p>;
  }

  return (
    <figure className="join-qr">
      <svg
        data-testid="join-qr-code"
        role="img"
        aria-label="スマホで参加するためのQRコード"
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${code.size} ${code.size}`}
        width="256"
        height="256"
        shapeRendering="crispEdges"
      >
        <title>参加URLのQRコード</title>
        <desc>{url}</desc>
        <rect width={code.size} height={code.size} fill="#fff" />
        <path d={code.path} fill="#000" />
      </svg>
      <figcaption>スマホのカメラで読み取って参加</figcaption>
    </figure>
  );
}
