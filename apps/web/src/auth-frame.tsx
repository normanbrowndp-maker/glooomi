import type { ReactNode } from 'react';
import { Heart } from 'lucide-react';
import { Brand } from './brand';

export function AuthFrame({ children }: { children: ReactNode }) {
  return <main className="auth-wrap">
    <section className="auth-intro"><span className="eyebrow">МЕСТО ДЛЯ ВАШИХ МОМЕНТОВ</span><h1>Ближе к людям.<br/>Ближе к себе<span>.</span></h1><p>Делитесь тем, что чувствуете. Находите тех, кто понимает.</p><div className="auth-art" aria-hidden="true"><div className="art-orbit"/><div className="art-card art-card-back"><Heart size={42}/><span>быть собой</span></div><div className="art-card art-card-front"><Brand/><span>маленькие моменты.<br/>большие чувства.</span><div className="art-dots"><i/><i/><i/></div></div><span className="art-spark">✦</span></div><small>ВАШ МИР. ВАШ РИТМ. GLOOMI.</small></section>
    <section className="auth-card"><div className="brand" aria-label="GLOOMI"><Brand/></div><p className="muted">Твоя лента. Твой ритм.</p>{children}</section>
  </main>;
}
