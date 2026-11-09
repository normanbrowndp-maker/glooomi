import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Mail, ShieldCheck } from 'lucide-react';
import { api, ApiError, setAccessToken, setCsrfToken } from './api';
import { AuthFrame } from './auth-frame';
import { clearVerification, readVerification, saveVerification, type VerificationState } from './verification-state';

const pause = (seconds: unknown) => typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? Date.now() + Math.min(seconds, 86400) * 1000 : 0;
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

export function EmailVerification() {
  const [state, setState] = useState(readVerification);
  const [now, setNow] = useState(Date.now);
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''));
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  const pending = useRef(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const cooldown = Math.max(0, Math.ceil((state.retryAt - now) / 1000));
  const expired = state.requested && state.expiresAt > 0 && now >= state.expiresAt;

  useEffect(() => { saveVerification(state); }, [state]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer); }, []);
  useEffect(() => { heading.current?.focus(); }, [state.step]);
  function update(next: Partial<VerificationState>) { setState(current => ({ ...current, ...next })); }
  function showFailure(err: unknown) {
    setError(err instanceof ApiError && err.code === 'INVALID_VERIFICATION_CODE'
      ? 'Код неверен или истёк. Введите последний код подтверждения почты. Код восстановления пароля не подходит.'
      : err instanceof Error ? err.message : 'Не удалось выполнить запрос. Попробуйте ещё раз.');
    if (err instanceof ApiError && err.retryAfterSeconds) update({ retryAt: pause(err.retryAfterSeconds) });
    setNow(Date.now());
  }
  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (pending.current || cooldown || !state.email.trim()) return;
    pending.current = true; setBusy('send'); setError(''); setNotice(''); setDigits(Array(6).fill(''));
    try {
      const { data } = await api.post('/auth/resend-code', { email: state.email.trim().toLowerCase() });
      const expiry = Date.parse(data.expiresAt);
      update({ email: state.email.trim().toLowerCase(), step: 'code', requested: true, retryAt: pause(data.retryAfterSeconds), expiresAt: Number.isFinite(expiry) ? expiry : 0 });
      setNow(Date.now()); setNotice(data.message || 'Запрос принят. Проверьте почту и папку «Спам». Доставка письма может занять некоторое время.');
    } catch (err) { showFailure(err); } finally { pending.current = false; setBusy(null); }
  }
  async function confirm(e: FormEvent) {
    e.preventDefault(); if (pending.current || digits.some(digit => !digit)) return;
    pending.current = true; setBusy('verify'); setError('');
    try {
      const { data } = await api.post('/auth/verify-email', { email: state.email, code: digits.join('') });
      clearVerification(); setAccessToken(data.accessToken); setCsrfToken(data.csrfToken);
      await qc.invalidateQueries({ queryKey: ['me'] }); navigate('/', { replace: true });
    } catch (err) { showFailure(err); inputs.current[0]?.focus(); } finally { pending.current = false; setBusy(null); }
  }
  function enter(value: string, index: number) {
    const text = value.replace(/\D/g, '').slice(0, 6);
    const start = text.length === 6 ? 0 : index;
    setDigits(current => { const next = [...current]; if (!text) next[index] = ''; else [...text].forEach((digit, offset) => { if (start + offset < 6) next[start + offset] = digit; }); return next; });
    if (text) inputs.current[Math.min(5, start + text.length)]?.focus();
    setError('');
  }
  return <AuthFrame>
    <div className="verification-progress" aria-label={`Шаг ${state.step === 'request' ? 1 : 2} из 2`}><span className="complete">1 <span>Запрос кода</span></span><i/><span className={state.step === 'code' ? 'complete' : ''}>2 <span>Подтверждение</span></span></div>
    <div className="verification-icon" aria-hidden="true">{state.step === 'request' ? <Mail/> : <ShieldCheck/>}</div>
    <h2 className="verification-title" ref={heading} tabIndex={-1}>{state.step === 'request' ? 'Подтвердите электронную почту' : 'Введите код из письма'}</h2>
    {state.step === 'request' ? <form className="stack verification-request" onSubmit={send}>
      <p className="verification-description">Отправим шестизначный код для подтверждения почты. Письмо будет запрошено после нажатия кнопки.</p>
      <label>Электронная почта<input required type="email" autoComplete="email" maxLength={254} value={state.email} disabled={!!busy} onChange={e => { const email = e.target.value; setError(''); setNotice(''); update({ email, requested: false, retryAt: 0, expiresAt: 0 }); }} placeholder="you@example.com"/></label>
      {notice && <p className="auth-notice" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" disabled={!!busy || cooldown > 0}>{busy === 'send' ? 'Отправляем запрос…' : cooldown > 0 ? `Отправить код через ${clock(cooldown)}` : 'Отправить код'}</button>
      {state.requested && <button type="button" className="text-button" disabled={!!busy} onClick={() => { update({ step: 'code' }); setError(''); }}>Вернуться к вводу кода</button>}
    </form> : <form className="stack verification-code" onSubmit={confirm}>
      <p className="verification-description">Проверьте письмо для <strong className="verification-email">{state.email}</strong></p>
      {notice && <p className="auth-notice" role="status">{notice}</p>}
      {!notice && <p className="muted">Если адрес ожидает подтверждения, проверьте почту и «Спам». Повторная загрузка страницы не отправляет письмо заново.</p>}
      <fieldset className="otp-group" disabled={!!busy} aria-describedby="verification-help verification-error"><legend>Шестизначный код подтверждения</legend><div className="otp-cells">{digits.map((digit, index) => <input key={index} ref={element => { inputs.current[index] = element; }} aria-label={`Цифра ${index + 1}`} aria-invalid={!!error} type="text" inputMode="numeric" autoComplete={index === 0 ? 'one-time-code' : 'off'} maxLength={6} value={digit} onFocus={e => e.target.select()} onChange={e => enter(e.target.value, index)} onPaste={e => { e.preventDefault(); enter(e.clipboardData.getData('text'), index); }} onKeyDown={e => {
        if (e.key === 'Backspace') { e.preventDefault(); const target = digit ? index : Math.max(0, index - 1); setDigits(current => current.map((d, i) => i === target ? '' : d)); inputs.current[target]?.focus(); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); inputs.current[Math.max(0, Math.min(5, index + (e.key === 'ArrowLeft' ? -1 : 1)))]?.focus(); }
      }}/>)}</div></fieldset>
      <p className="muted" id="verification-help">Нужен код подтверждения почты из последнего письма GLOOMI. Код восстановления пароля используется на отдельном экране.</p>
      {expired && <p className="error" role="status">Срок действия запрошенного кода истёк. Запросите новый код ниже.</p>}
      <div id="verification-error">{error && <p className="error" role="alert">{error}</p>}</div>
      <button className="primary" disabled={!!busy || digits.some(digit => !digit)}>{busy === 'verify' ? 'Проверяем код…' : 'Подтвердить почту'}</button>
      <button className="text-button resend-code" type="button" disabled={!!busy || cooldown > 0} onClick={() => void send()}>{busy === 'send' ? 'Отправляем запрос…' : cooldown > 0 ? `Отправить повторно через ${clock(cooldown)}` : 'Отправить код повторно'}</button>
      <button className="text-button verification-back" type="button" disabled={!!busy} onClick={() => { update({ step: 'request' }); setDigits(Array(6).fill('')); setError(''); setNotice(''); }}><ArrowLeft size={15}/>Вернуться к запросу кода</button>
    </form>}
    <Link className="back-to-login" to="/login"><ArrowLeft size={15}/>Вернуться ко входу</Link>
  </AuthFrame>;
}
