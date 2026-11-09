import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { AuthService } from '../src/modules/auth/auth.service';

const pepper = 'direct-email-test-pepper-at-least-32-bytes';
const input = { email: 'Person@example.test', username: 'Person', password: 'safe-test-password123' };

describe('direct SMTP registration and verification', () => {
  let auth: AuthService;
  let db: any;
  let tx: any;
  let mail: any;
  let user: any;
  let codes: any[];
  let inTransaction: boolean;
  const response = (error: unknown) => (error as HttpException).getResponse() as Record<string, any>;

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('EMAIL_DELIVERY_MODE', 'direct');
    vi.stubEnv('EMAIL_CODE_PEPPER', pepper);
    vi.stubEnv('JWT_ACCESS_SECRET', 'direct-test-access-secret-at-least-32-bytes');
    vi.stubEnv('JWT_REFRESH_SECRET', 'direct-test-refresh-secret-at-least-32-bytes');
    user = null; codes = []; inTransaction = false;
    tx = {
      $queryRaw: vi.fn(),
      user: {
        create: vi.fn(async ({ data }: any) => { user = { ...data, id: 'u1', emailVerified: null }; return user; }),
        update: vi.fn(async ({ data }: any) => { Object.assign(user, data); return user; }),
      },
      verificationCode: {
        findFirst: vi.fn(async ({ where }: any) => [...codes].reverse().find(c => c.userId === where.userId && c.purpose === where.purpose
          && (where.invalidatedAt === undefined || c.invalidatedAt === null) && (!where.expiresAt || c.expiresAt > where.expiresAt.gt)) || null),
        create: vi.fn(async ({ data }: any) => { const code = { ...data, id: `c${codes.length}`, createdAt: new Date(), attempts: 0, invalidatedAt: null }; codes.push(code); return code; }),
        updateMany: vi.fn(async ({ where, data }: any) => {
          const matching = codes.filter(c => (!where.id || c.id === where.id) && (!where.userId || c.userId === where.userId)
            && (!where.purpose || c.purpose === where.purpose) && (where.invalidatedAt === undefined || c.invalidatedAt === null)
            && (!where.attempts || c.attempts < where.attempts.lt) && (!where.expiresAt || c.expiresAt > where.expiresAt.gt));
          for (const c of matching) { if (data.invalidatedAt) c.invalidatedAt = data.invalidatedAt; if (data.attempts) c.attempts += data.attempts.increment; }
          return { count: matching.length };
        }),
      },
      emailOutbox: { create: vi.fn() }, session: { deleteMany: vi.fn() },
    };
    db = {
      user: { findUnique: vi.fn(async () => user) },
      session: { create: vi.fn() },
      $transaction: vi.fn(async (fn: any) => { inTransaction = true; try { return await fn(tx); } finally { inTransaction = false; } }),
    };
    mail = { send: vi.fn(async () => { expect(inTransaction).toBe(false); expect(codes.length).toBeGreaterThan(0); return { accepted: true }; }) };
    auth = new AuthService(db, { signAsync: vi.fn(async () => 'signed-token') } as any, mail);
  });
  afterEach(() => vi.unstubAllEnvs());
  const sentCode = (mail: any) => mail.send.mock.calls.at(-1)[1].code as string;
  const ageCode = (codes: any[]) => { codes.at(-1).createdAt = new Date(Date.now() - 61_000); };

  it('registers without sending, then commits a hashed expiring code before the explicit SMTP request', async () => {
    expect(await auth.register(input)).toMatchObject({ verificationRequired: true, delivery: 'not_requested' });
    expect(codes).toHaveLength(0); expect(mail.send).not.toHaveBeenCalled();
    const requested = await auth.resend(input.email);
    expect(requested.retryAfterSeconds).toBe(60); expect(requested.expiresAt).toBeInstanceOf(Date);
    expect(user.email).toBe('person@example.test'); expect(user.username).toBe('person');
    expect(user.passwordHash).not.toBe(input.password);
    const code = sentCode(mail);
    expect(code).toMatch(/^\d{6}$/);
    expect(codes[0].codeHash).toBe(createHmac('sha256', pepper).update(code).digest('hex'));
    expect(codes[0].expiresAt.getTime() - Date.now()).toBeGreaterThan(590_000);
    expect(tx.emailOutbox.create).not.toHaveBeenCalled(); expect(mail.send).toHaveBeenCalledOnce();
  });
  it('retains the unverified account on SMTP failure and reports 503, allowing resend after cooldown', async () => {
    await auth.register(input);
    mail.send.mockRejectedValueOnce(new Error('sensitive SMTP response must not escape'));
    const error = await auth.resend(input.email).catch(e => e);
    expect(error.getStatus()).toBe(503);
    expect(response(error)).toMatchObject({ code: 'EMAIL_DELIVERY_FAILED', verificationRequired: true, retryAfterSeconds: 60 });
    expect(JSON.stringify(response(error))).not.toContain('sensitive'); expect(user).not.toBeNull();
    const existing = await auth.register(input);
    expect(existing).toMatchObject({ delivery: 'not_requested', verificationRequired: true });
    expect(tx.user.create).toHaveBeenCalledOnce();
    await expect(auth.resend(input.email)).rejects.toMatchObject({ status: 429 });
    ageCode(codes); await auth.resend(input.email);
    expect(mail.send).toHaveBeenCalledTimes(2); expect(codes[0].invalidatedAt).not.toBeNull();
  });
  it('lets an existing unverified user continue without changing username or password', async () => {
    await auth.register(input); const passwordHash = user.passwordHash;
    expect(await auth.register({ ...input, username: 'attacker', password: 'another-password123' })).toMatchObject({ verificationRequired: true, delivery: 'not_requested' });
    expect(user.passwordHash).toBe(passwordHash); expect(user.username).toBe('person');
    expect(tx.user.create).toHaveBeenCalledOnce(); expect(mail.send).not.toHaveBeenCalled();
  });
  it('accepts a received code after an ambiguous SMTP timeout without recreating the account', async () => {
    await auth.register(input);
    mail.send.mockRejectedValueOnce(new Error('SMTP timeout after acceptance'));
    await expect(auth.resend(input.email)).rejects.toMatchObject({ status: 503 });
    await expect(auth.verify({ email: input.email, code: sentCode(mail) })).resolves.toMatchObject({ accessToken: 'signed-token' });
    expect(tx.user.create).toHaveBeenCalledOnce(); expect(user.emailVerified).toBeInstanceOf(Date);
  });
  it('resends with a new code and invalidates the previous one', async () => {
    await auth.register(input); await auth.resend(input.email); ageCode(codes); await auth.resend(input.email);
    expect(mail.send).toHaveBeenCalledTimes(2); expect(codes).toHaveLength(2);
    expect(codes[0].invalidatedAt).not.toBeNull(); expect(codes[1].invalidatedAt).toBeNull();
  });
  it('does not send on cooldown, including when the previous code is invalidated', async () => {
    await auth.register(input); await auth.resend(input.email); codes[0].invalidatedAt = new Date();
    const error = await auth.resend(input.email).catch(e => e);
    expect(error.getStatus()).toBe(429); expect(response(error).retryAfterSeconds).toBeGreaterThan(0);
    expect(mail.send).toHaveBeenCalledOnce();
  });
  it('reports SMTP failure on resend instead of a successful delivery', async () => {
    await auth.register(input); await auth.resend(input.email); ageCode(codes); mail.send.mockRejectedValueOnce(new Error('rejected'));
    await expect(auth.resend(input.email)).rejects.toMatchObject({ status: 503 });
    expect(tx.user.create).toHaveBeenCalledOnce();
  });
  it('confirms once, persists emailVerified, and allows login', async () => {
    const registered = await auth.register(input); await auth.resend(input.email); const code = sentCode(mail);
    await expect(auth.login(input)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'EMAIL_VERIFICATION_REQUIRED' }) });
    await expect(auth.verify({ email: input.email, code })).resolves.toMatchObject({ accessToken: 'signed-token' });
    expect(user.emailVerified).toBeInstanceOf(Date);
    await expect(auth.verify({ email: input.email, code })).rejects.toMatchObject({ status: 400 });
    await expect(auth.login(input)).resolves.toMatchObject({ accessToken: 'signed-token' });
    await expect(auth.register(input)).resolves.toEqual(registered);
  });
  it('limits incorrect guesses to five attempts and rejects expired codes', async () => {
    await auth.register(input); await auth.resend(input.email); const code = sentCode(mail); const wrong = code === '000000' ? '000001' : '000000';
    for (let n = 0; n < 5; n++) await expect(auth.verify({ email: input.email, code: wrong })).rejects.toMatchObject({ status: 400 });
    expect(codes[0].attempts).toBe(5); expect(codes[0].invalidatedAt).not.toBeNull();
    await expect(auth.verify({ email: input.email, code })).rejects.toMatchObject({ status: 400 });
    ageCode(codes); await auth.resend(input.email); codes.at(-1).expiresAt = new Date(Date.now() - 1);
    await expect(auth.verify({ email: input.email, code: sentCode(mail) })).rejects.toMatchObject({ status: 400 });
    expect(user.emailVerified).toBeNull();
  });
  it('does not send for unknown or verified accounts', async () => {
    await auth.resend(input.email); expect(mail.send).not.toHaveBeenCalled();
    await auth.register(input); user.emailVerified = new Date();
    await auth.resend(input.email); expect(mail.send).not.toHaveBeenCalled();
  });
  it('uses identical neutral registration and resend messages for unknown, verified and unverified email', async () => {
    const unknown = await auth.resend(input.email);
    const registered = await auth.register(input);
    expect(await auth.register(input)).toEqual(registered);
    const unverified = await auth.resend(input.email);
    user.emailVerified = new Date();
    expect(await auth.register(input)).toEqual(registered);
    const verified = await auth.resend(input.email);
    for (const result of [unknown, unverified, verified]) {
      expect(result.message).toBe(unknown.message); expect(result.retryAfterSeconds).toBe(60);
      expect(Object.keys(result)).toEqual(Object.keys(unknown));
    }
    expect(mail.send).toHaveBeenCalledOnce();
  });
  it('never consumes a password-reset code as an email-verification code', async () => {
    await auth.register(input); await auth.resend(input.email);
    codes[0].invalidatedAt = new Date(); user.emailVerified = new Date();
    await auth.requestPasswordReset(input.email); const reset = sentCode(mail); user.emailVerified = null;
    await expect(auth.verify({ email: input.email, code: reset })).rejects.toMatchObject({ status: 400, response: expect.objectContaining({ code: 'INVALID_VERIFICATION_CODE' }) });
    expect(codes.at(-1).purpose).toBe('RESET_PASSWORD'); expect(codes.at(-1).attempts).toBe(0); expect(user.emailVerified).toBeNull();
  });
  it('also sends password-reset codes directly without an outbox', async () => {
    await auth.register(input); user.emailVerified = new Date();
    await auth.requestPasswordReset(input.email);
    expect(mail.send).toHaveBeenLastCalledWith('RESET_PASSWORD', expect.objectContaining({ to: user.email }), expect.any(String));
    expect(tx.emailOutbox.create).not.toHaveBeenCalled();
    await auth.resetPassword({ email: input.email, code: sentCode(mail), password: 'updated-password123' });
    expect(tx.session.deleteMany).toHaveBeenCalledWith({ where: { userId: user.id } });
  });
});
