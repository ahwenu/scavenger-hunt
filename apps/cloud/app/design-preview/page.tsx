'use client';

import { useState } from 'react';
import { ParticipantGame, art, views, type View } from '@/app/participant/ParticipantGame';

export default function DesignPreviewPage() {
  const [view, setView] = useState<View>('home');
  return <div className="design-comparison">
    <header className="comparison-header">
      <h1>画面画像と実装の照合</h1>
      <p>左は原寸の切り出し画像、右は操作できる TypeScript 画面です。画像の文字や値は見本です。</p>
      <nav className="preview-switch" aria-label="照合する画面">{views.map(item =>
        <button key={item.key} type="button" aria-pressed={view === item.key} onClick={() => setView(item.key)}>{item.label}</button>
      )}</nav>
    </header>
    <div className="comparison-grid">
      <section className="comparison-reference" aria-label="元画像">
        <h2>元画像 <small>原寸 313px 高</small></h2>
        <img src={`/design/sports-day/screens/${art[view]}`} alt={`${views.find(item => item.key === view)?.label}の元画像`} />
      </section>
      <section className="comparison-implementation" aria-label="実装画面">
        <h2>実装画面 <small>操作・アニメーション確認用</small></h2>
        <ParticipantGame preview previewView={view} onPreviewViewChange={setView} />
      </section>
    </div>
  </div>;
}
