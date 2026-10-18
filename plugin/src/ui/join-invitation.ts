/** 同じ参加URLから表示・配布用のQRを外部通信なしで作る。 */
import QRCode from 'qrcode';

export interface InvitationFile { name: string; mimeType: 'image/svg+xml' | 'image/png'; text?: string; blob?: string }
export interface JoinQrCode { path: string; size: number }

/** 参加者用の既知ルートだけを受け取り、認証情報や任意クエリを配布しない。 */
export function validateJoinUrl(value: string): URL {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !/^\/rooms\/[a-zA-Z0-9-]{1,200}\/join$/.test(url.pathname)) throw new Error('参加URLの形式を確認してください。');
  return url;
}

/** QRの黒モジュールを横方向にまとめ、4セルの白い余白を含むパスへ変換する。 */
export function createJoinQr(url: string): JoinQrCode {
  validateJoinUrl(url);
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

/** XML内の参加URLを文字列として扱い、属性や要素を混入させない。 */
function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
}

/** SVGは拡大・印刷、PNGはメッセージ添付に使える白背景のQRとして生成する。 */
export function createInvitationFile(url: string, format: 'svg' | 'png'): InvitationFile {
  const target = validateJoinUrl(url);
  const code = createJoinQr(url);
  const roomId = target.pathname.split('/')[2]!;
  const name = `karimono-join-${roomId}.${format}`;
  if (format === 'svg') return {
    name, mimeType: 'image/svg+xml',
    text: `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 ${code.size} ${code.size}" shape-rendering="crispEdges"><title>カリモノ 参加QR</title><desc>${escapeXml(url)}</desc><rect width="${code.size}" height="${code.size}" fill="#fff"/><path d="${code.path}" fill="#000"/></svg>`,
  };
  const canvas = document.createElement('canvas');
  const cell = Math.max(8, Math.ceil(1024 / code.size));
  canvas.width = canvas.height = code.size * cell;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('PNGを作成できません。SVG形式を選んでください。');
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000'; context.scale(cell, cell); context.fill(new Path2D(code.path));
  return { name, mimeType: 'image/png', blob: canvas.toDataURL('image/png').split(',')[1]! };
}
