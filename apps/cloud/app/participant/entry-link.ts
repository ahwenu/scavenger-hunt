const roomIdPattern = /^[a-zA-Z0-9-]{1,64}$/;
const joinPathPattern = /^\/rooms\/([a-zA-Z0-9-]{1,64})\/join\/?$/;

/** 共有リンクや部屋IDを、秘密情報を転送しない同一サイトの参加パスへ整える。 */
export function resolveParticipantPath(value: string, origin: string): string | null {
  const input = value.trim();
  if (!input || input.length > 4096 || /[\u0000-\u0020\u007f\\]/.test(input)) return null;
  try {
    const base = new URL(origin);
    if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password) return null;
    if (roomIdPattern.test(input)) return `/rooms/${input}/join`;

    // //host と、URLパーサーが補正する曖昧なscheme表記は受け付けない。
    const absolute = /^https?:\/\//i.test(input);
    if (!absolute && !/^\/?rooms\//.test(input)) return null;
    const url = new URL(input, `${base.origin}/`);
    if (url.origin !== base.origin || url.username || url.password) return null;
    const match = url.pathname.match(joinPathPattern);
    if (!match) return null;

    // 部屋ID以外のエスケープや相対セグメントをパーサーが補正していても拒否する。
    const sourcePath = absolute ? input.replace(/^https?:\/\/[^/?#]*/i, '').split(/[?#]/, 1)[0] : `/${input.replace(/^\//, '')}`.split(/[?#]/, 1)[0];
    if (!joinPathPattern.test(sourcePath)) return null;
    return `/rooms/${match[1]}/join`;
  } catch { return null; }
}
