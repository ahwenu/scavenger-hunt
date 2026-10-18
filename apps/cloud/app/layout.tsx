import type { Metadata } from 'next';
import './participant/participant.css';
export const metadata:Metadata={title:'カリモノ — 借り物王に俺はなる！',description:'QRで集まり、探して撮って、みんなで競争。'};
/** 日本語のゲーム画面を包む。 */
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="ja"><body>{children}</body></html>;}
