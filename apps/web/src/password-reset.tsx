import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { api } from './api';
import { Brand } from './brand';

export function PasswordReset() {
  const [step, setStep] = useState<'request' | 'confirm' | 'done'>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try {
      if (step === 'request') { await api.post('/auth/password-reset/request', { email }); setStep('confirm'); }
      else { await api.post('/auth/password-reset/confirm', { email, code, password }); setStep('done'); }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <main className="reset-wrap"><section className="auth-card">
    <Link className="brand" to="/" aria-label="GLOOMI"><Brand/></Link>
    <p className="muted">Вернём вас к вашим людям.</p>
    <h2>{step === 'done' ? 'Пароль обновлён' : 'Восстановление пароля'}</h2>
    {step === 'done' ? <div className="stack"><CheckCircle2 size={36}/><p>Войдите в аккаунт с новым паролем.</p><Link className="primary" to="/login">Войти</Link></div> : <form className="stack" onSubmit={submit}>
      <label>Электронная почта<input type="email" required autoComplete="email" value={email} readOnly={step === 'confirm'} onChange={e => setEmail(e.target.value)} placeholder="you@example.com"/></label>
      {step === 'confirm' && <><p className="muted">Если аккаунт с такой почтой существует, мы отправили код. Проверьте входящие и папку «Спам».</p><label>Код из письма<input required pattern="[0-9]{6}" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value)} placeholder="000000"/></label><label>Новый пароль<input required type="password" minLength={10} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Не менее 10 символов"/></label></>}
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" disabled={busy}>{busy ? 'Подождите…' : step === 'request' ? 'Получить код' : 'Обновить пароль'}</button>
      {step === 'confirm' && <button className="text-button" type="button" disabled={busy} onClick={() => { setStep('request'); setError(''); }}>Изменить почту или отправить код повторно</button>}
    </form>}
    <Link className="back-to-login" to="/login"><ArrowLeft size={15}/>Вернуться ко входу</Link>
  </section></main>;
}
