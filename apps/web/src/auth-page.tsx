import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, setAccessToken, setCsrfToken } from './api';
import { AuthFrame } from './auth-frame';
import { EmailVerification } from './email-verification';
import { beginEmailVerification } from './verification-state';

export function AuthPage({ verify = false }: { verify?: boolean }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  useEffect(() => { if (!verify) { setMode('login'); setError(''); } }, [verify]);
  function enterVerification() { beginEmailVerification(email); setPassword(''); navigate('/verify'); }
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try {
      if (mode === 'register') {
        await api.post('/auth/register', { email, username, password });
        enterVerification(); return;
      }
      const { data } = await api.post('/auth/login', { email, password });
      setAccessToken(data.accessToken); setCsrfToken(data.csrfToken);
      await qc.invalidateQueries({ queryKey: ['me'] }); navigate('/');
    } catch (err) {
      if (err instanceof ApiError && err.verificationRequired) enterVerification();
      else setError(err instanceof Error ? err.message : 'Не удалось выполнить запрос.');
    } finally { setBusy(false); }
  }
  if (verify) return <EmailVerification/>;
  return <AuthFrame>
    <h2>{mode === 'register' ? 'Создать аккаунт' : 'С возвращением'}</h2>
    <form onSubmit={submit} className="stack">
      {mode === 'register' && <label>Имя пользователя<input required minLength={3} maxLength={24} pattern="[a-zA-Z0-9_.]+" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} placeholder="your.name"/></label>}
      <label>Электронная почта<input required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com"/></label>
      <label>Пароль<input required minLength={mode === 'register' ? 10 : 1} type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Введите пароль"/></label>
      {mode === 'login' && <Link className="forgot-password" to="/password-reset">Забыли пароль?</Link>}
      {error && <div className="error" role="alert">{error}</div>}
      <button className="primary" disabled={busy}>{busy ? 'Подождите…' : mode === 'register' ? 'Создать аккаунт' : 'Войти'}</button>
    </form>
    <p className="auth-switch">{mode === 'login' ? 'Нет аккаунта? ' : 'Уже с нами? '}<button disabled={busy} onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>{mode === 'login' ? 'Зарегистрироваться' : 'Войти'}</button></p>
    {mode === 'login' && <button className="text-button verify-entry" disabled={busy} onClick={enterVerification}>Аккаунт уже создан? Подтвердить почту</button>}
  </AuthFrame>;
}
