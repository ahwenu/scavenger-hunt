/** 参加URLのQRを拡張内で生成し、外部通信なしでインラインSVGへ描画する。 */
import { useMemo } from 'react';
import QRCode from 'qrcode';

/** QRの黒モジュールを横方向にまとめ、白い余白を含むSVGパスへ変換する。 */
function createJoinQr(url: string): { path: string; size: number } {
  const target = new URL(url);
  if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password) {
    throw new Error('invalid_join_url');
  }
  const quietZone = 4;
  const { modules } = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const segments: string[] = [];
  for (let row = 0; row < modules.size; row++) {
    let column = 0;
    while (column < modules.size) {
      if (!modules.get(row, column)) { column++; continue; }
      const start = column;
      while (column < modules.size && modules.get(row, column)) column++;
      segments.push(`M${start + quietZone} ${row + quietZone}h${column - start}v1h-${column - start}z`);
    }
  }
  return { path: segments.join(''), size: modules.size + quietZone * 2 };
}

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
