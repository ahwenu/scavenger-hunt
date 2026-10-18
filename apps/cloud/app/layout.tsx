import type { Metadata } from 'next';
export const metadata:Metadata={title:'AI借り物競争',description:'QRで集まり、探して撮って、みんなで競争。'};
/** 日本語のゲーム画面を包む。 */
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="ja"><body>{children}</body></html>;}
