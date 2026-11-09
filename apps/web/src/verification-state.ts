export type VerificationState = { email: string; step: 'request' | 'code'; retryAt: number; expiresAt: number; requested: boolean };
const key = 'gloomi.email-verification.v1';
const empty = (): VerificationState => ({ email: '', step: 'request', retryAt: 0, expiresAt: 0, requested: false });

export function readVerification(): VerificationState {
  try {
    const data = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (!data || typeof data.email !== 'string' || !['request', 'code'].includes(data.step) || typeof data.requested !== 'boolean') return empty();
    const timestamp = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < Date.now() + 86_400_000 ? value : 0;
    return { email: data.email.slice(0, 254), step: data.requested ? data.step : 'request', retryAt: timestamp(data.retryAt), expiresAt: timestamp(data.expiresAt), requested: data.requested };
  } catch { return empty(); }
}
export function saveVerification(state: VerificationState) { try { sessionStorage.setItem(key, JSON.stringify(state)); } catch { /* Storage-disabled browsers still work in memory. */ } }
export function beginEmailVerification(email: string) {
  const previous = readVerification();
  const nextEmail = (email.trim() || previous.email).toLowerCase();
  saveVerification(previous.email === nextEmail ? { ...previous, step: 'request' } : { ...empty(), email: nextEmail });
}
export function clearVerification() { try { sessionStorage.removeItem(key); } catch {} }
