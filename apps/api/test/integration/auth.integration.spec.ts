import { JwtModule, JwtService } from '@nestjs/jwt';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../src/modules/database/prisma.service';
import { AuthController } from '../../src/modules/auth/auth.controller';
import { AuthService } from '../../src/modules/auth/auth.service';
import { JwtAuthGuard } from '../../src/modules/auth/jwt-auth.guard';
import { RateLimitService } from '../../src/modules/auth/rate-limit.service';
import { decryptEmailPayload } from '../../src/modules/mail/mail-crypto';
import { EmailOutboxKind, VerificationPurpose } from '@prisma/client';
import { EmailQueueService } from '../../src/modules/mail/email-queue.service';
import { RateLimitService } from '../../src/modules/auth/rate-limit.service';
import { HttpException } from '@nestjs/common';
import request from 'supertest';
import type { Response as SupertestResponse } from 'supertest';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';

const testDatabaseUrl = process.env.DATABASE_URL_TEST;
const emailPrefix = `phase2-${randomUUID()}`;
const allowedOrigin = 'http://gloomi-test.local';
process.env.WEB_ORIGIN = allowedOrigin;
process.env.JWT_ACCESS_SECRET = 'phase-two-test-access-secret-32-bytes';
process.env.JWT_REFRESH_SECRET = 'phase-two-test-refresh-secret-32-bytes';
process.env.EMAIL_CODE_PEPPER = 'phase-two-email-code-pepper-32-bytes';
process.env.NODE_ENV = 'test';

describe.skipIf(!testDatabaseUrl)('auth HTTP integration', () => {
  let app: INestApplication;
  let db: PrismaService;
  let auth: AuthService;
  let email: string;
  let username: string;
  let originalSignupCode: string;

  const server = () => app.getHttpServer();
  const setCookieValues = (response: SupertestResponse) => (response.headers['set-cookie'] as string[]).map(value => value.split(';')[0]);
  const cookieValue = (cookies: string[], name: string) => cookies.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
  const cookieHeader = (cookies: string[]) => cookies.join('; ');
  const verificationPayload = async (userId: string, purpose = VerificationPurpose.VERIFY) => {
    const outbox = await db.emailOutbox.findFirst({ where: { userId, kind: purpose === VerificationPurpose.VERIFY ? EmailOutboxKind.VERIFY_EMAIL : EmailOutboxKind.RESET_PASSWORD }, orderBy: { createdAt: 'desc' } });
    if (!outbox) throw new Error('Expected email outbox row');
    return { outbox, ...decryptEmailPayload({ ciphertext: outbox.payloadCiphertext, iv: outbox.payloadIv, tag: outbox.payloadTag }) };
  };
  const register = async (suffix: string) => {
    const userEmail = `${emailPrefix}-${suffix}@example.test`;
    const userName = `p2_${emailPrefix.slice(-8).replaceAll('-', '_')}_${suffix}`.slice(0, 24);
    const response = await request(server()).post('/api/auth/register').send({ email: userEmail, username: userName, password: 'Correct horse battery 42!' });
    expect(response.status).toBe(201);
    const user = await db.user.findUniqueOrThrow({ where: { email: userEmail } });
    return { user, email: userEmail, username: userName };
  };

  beforeAll(async () => {
    if (!testDatabaseUrl) return;
    process.env.DATABASE_URL = testDatabaseUrl;
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      controllers: [AuthController],
      providers: [
        AuthService,
        JwtAuthGuard,
        PrismaService,
        { provide: RateLimitService, useValue: { consume: async () => undefined } },
        { provide: (await import('../../src/modules/media/media.service')).MediaService, useValue: { presentProfile: async (profile: unknown) => profile } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableCors({ origin: [allowedOrigin], credentials: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    db = app.get(PrismaService);
    auth = app.get(AuthService);
    const account = await register('main');
    email = account.email;
    username = account.username;
    const rawCode = await verificationPayload(account.user.id);
    originalSignupCode = rawCode.code;
    const verified = await request(server()).post('/api/auth/verify-email').set('Origin', allowedOrigin).send({ email, code: rawCode.code });
    expect(verified.status).toBe(201);
  }, 30_000);

  afterAll(async () => {
    if (db) await db.user.deleteMany({ where: { email: { startsWith: `${emailPrefix}-` } } });
    if (app) await app.close();
  }, 30_000);

  it('creates the user, verification code, and encrypted outbox item atomically', async () => {
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    const { outbox, code, to } = await verificationPayload(user.id);
    expect(outbox.status).toBe('PENDING');
    expect(outbox.jobId).toBe(outbox.id);
    expect(to).toBe(email);
    expect(outbox.payloadCiphertext).not.toContain(code);
  });

  it('rejects an incorrect Origin when creating an authenticated cookie session', async () => {
    const response = await request(server()).post('/api/auth/login').set('Origin', 'https://attacker.example').send({ email, password: 'Correct horse battery 42!' });
    expect(response.status).toBe(403);
  });

  it('rejects missing refresh cookies and invalid CSRF tokens', async () => {
    const csrf = auth.createCsrfToken();
    const missing = await request(server()).post('/api/auth/refresh').set('Origin', allowedOrigin).set('Cookie', `gloomi.csrf=${csrf}`).set('X-CSRF-Token', csrf);
    expect(missing.status).toBe(401);
    const invalid = await request(server()).post('/api/auth/refresh').set('Origin', allowedOrigin).set('Cookie', 'gloomi.csrf=not-signed; gloomi.refresh=fake').set('X-CSRF-Token', 'not-signed');
    expect(invalid.status).toBe(401);
  });

  it('rotates refresh tokens and returns the same rotated cookie to parallel browser tabs', async () => {
    const login = await request(server()).post('/api/auth/login').set('Origin', allowedOrigin).send({ email, password: 'Correct horse battery 42!' });
    expect(login.status).toBe(201);
    const cookies = setCookieValues(login);
    const oldRefresh = cookieValue(cookies, 'gloomi.refresh');
    const csrf = login.body.csrfToken as string;
    const headers = { Cookie: cookieHeader(cookies), 'X-CSRF-Token': csrf, Origin: allowedOrigin };
    const [first, second] = await Promise.all([
      request(server()).post('/api/auth/refresh').set(headers),
      request(server()).post('/api/auth/refresh').set(headers),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstRefresh = cookieValue(setCookieValues(first), 'gloomi.refresh');
    const secondRefresh = cookieValue(setCookieValues(second), 'gloomi.refresh');
    expect(firstRefresh).toBe(secondRefresh);
    expect(firstRefresh).not.toBe(oldRefresh);
  });

  it('revokes sessions when an old refresh token is reused outside the parallel-request grace period', async () => {
    const login = await request(server()).post('/api/auth/login').set('Origin', allowedOrigin).send({ email, password: 'Correct horse battery 42!' });
    const cookies = setCookieValues(login);
    const oldRefresh = cookieValue(cookies, 'gloomi.refresh')!;
    const csrf = login.body.csrfToken as string;
    const rotated = await request(server()).post('/api/auth/refresh').set({ Cookie: cookieHeader(cookies), 'X-CSRF-Token': csrf, Origin: allowedOrigin });
    expect(rotated.status).toBe(201);
    const claims = await app.get(JwtService).verifyAsync(oldRefresh, { secret: process.env.JWT_REFRESH_SECRET });
    await db.session.update({ where: { id: claims.sid }, data: { rotatedAt: new Date(Date.now() - 16_000) } });
    const replay = await request(server()).post('/api/auth/refresh').set({ Cookie: cookieHeader(cookies), 'X-CSRF-Token': csrf, Origin: allowedOrigin });
    expect(replay.status).toBe(401);
    expect(await db.session.count({ where: { userId: claims.sub } })).toBe(0);
  });

  it('logs out the current session and all devices', async () => {
    const login = await request(server()).post('/api/auth/login').set('Origin', allowedOrigin).send({ email, password: 'Correct horse battery 42!' });
    const cookies = setCookieValues(login);
    const logout = await request(server()).post('/api/auth/logout').set({ Cookie: cookieHeader(cookies), 'X-CSRF-Token': login.body.csrfToken, Origin: allowedOrigin });
    expect(logout.status).toBe(201);
    expect(logout.headers['set-cookie'].join(';')).toContain('Max-Age=0');
    const afterLogout = await request(server()).post('/api/auth/refresh').set({ Cookie: cookieHeader(cookies), 'X-CSRF-Token': login.body.csrfToken, Origin: allowedOrigin });
    expect(afterLogout.status).toBe(401);

    const first = await auth.createSession((await db.user.findUniqueOrThrow({ where: { email } })).id, email);
    await auth.createSession((await db.user.findUniqueOrThrow({ where: { email } })).id, email);
    const all = await request(server()).post('/api/auth/logout-all').set('Authorization', `Bearer ${first.accessToken}`);
    expect(all.status).toBe(201);
    expect(await db.session.count()).toBe(0);
  });

  it('rejects expired access tokens', async () => {
    const token = await app.get(JwtService).signAsync({ sub: 'expired-user', email }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '1ms' });
    await new Promise(resolve => setTimeout(resolve, 20));
    const response = await request(server()).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(401);
  });

  it('limits verification attempts, invalidates codes on resend, and never mixes reset and signup purposes', async () => {
    const unverified = await register('codes');
    const signup = await verificationPayload(unverified.user.id);
    const wrongCode = signup.code === '000000' ? '000001' : '000000';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wrong = await request(server()).post('/api/auth/verify-email').send({ email: unverified.email, code: wrongCode });
      expect(wrong.status).toBe(400);
    }
    const locked = await db.verificationCode.findFirst({ where: { userId: unverified.user.id, purpose: VerificationPurpose.VERIFY } });
    expect(locked?.attempts).toBe(5);
    expect(locked?.invalidatedAt).not.toBeNull();
    expect(signup.code).toMatch(/^\d{6}$/);
    const afterLock = await request(server()).post('/api/auth/verify-email').send({ email: unverified.email, code: signup.code });
    expect(afterLock.status).toBe(400);

    const expiredAccount = await register('expired');
    const expiredCode = await verificationPayload(expiredAccount.user.id);
    await db.verificationCode.updateMany({ where: { userId: expiredAccount.user.id, purpose: VerificationPurpose.VERIFY }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    const expired = await request(server()).post('/api/auth/verify-email').send({ email: expiredAccount.email, code: expiredCode.code });
    expect(expired.status).toBe(400);

    const resendAccount = await register('resend');
    const oldSignup = await verificationPayload(resendAccount.user.id);
    await db.verificationCode.updateMany({ where: { userId: resendAccount.user.id, purpose: VerificationPurpose.VERIFY }, data: { createdAt: new Date(Date.now() - 61_000) } });
    const resent = await request(server()).post('/api/auth/resend-code').send({ email: resendAccount.email });
    expect(resent.status).toBe(201);
    const newSignup = await verificationPayload(resendAccount.user.id);
    expect(newSignup.code).not.toBe(oldSignup.code);
    const oldCodeResponse = await request(server()).post('/api/auth/verify-email').send({ email: resendAccount.email, code: oldSignup.code });
    expect(oldCodeResponse.status).toBe(400);
    const validNewCode = await request(server()).post('/api/auth/verify-email').send({ email: resendAccount.email, code: newSignup.code });
    expect(validNewCode.status).toBe(201);
    const reused = await request(server()).post('/api/auth/verify-email').send({ email: resendAccount.email, code: newSignup.code });
    expect(reused.status).toBe(400);

    const reset = await request(server()).post('/api/auth/password-reset/request').send({ email });
    expect(reset.status).toBe(201);
    const verifiedUser = await db.user.findUniqueOrThrow({ where: { email } });
    const resetCode = await verificationPayload(verifiedUser.id, VerificationPurpose.RESET_PASSWORD);
    const signupCodeAsReset = await request(server()).post('/api/auth/password-reset/confirm').send({ email, code: originalSignupCode, password: 'Another correct battery 73!' });
    expect(signupCodeAsReset.status).toBe(400);
    const wrongPurpose = await request(server()).post('/api/auth/verify-email').send({ email, code: resetCode.code });
    expect(wrongPurpose.status).toBe(400);
    const passwordChanged = await request(server()).post('/api/auth/password-reset/confirm').send({ email, code: resetCode.code, password: 'Another correct battery 73!' });
    expect(passwordChanged.status).toBe(201);
    expect(await db.session.count({ where: { userId: verifiedUser.id } })).toBe(0);
    const oldPasswordLogin = await request(server()).post('/api/auth/login').send({ email, password: 'Correct horse battery 42!' });
    expect(oldPasswordLogin.status).toBe(401);
    const newPasswordLogin = await request(server()).post('/api/auth/login').send({ email, password: 'Another correct battery 73!' });
    expect(newPasswordLogin.status).toBe(201);
  });

  it('keeps the encrypted outbox record when delivery has not been attempted', async () => {
    const account = await register('smtp-pending');
    const { outbox } = await verificationPayload(account.user.id);
    expect(outbox.status).toBe('PENDING');
    expect(outbox.attempts).toBe(0);
    expect(outbox.payloadCiphertext).not.toContain(account.email);
  });
});

describe.skipIf(!process.env.REDIS_URL_TEST)('email queue integration', () => {
  it('places only an opaque outbox ID in Redis job data', async () => {
    process.env.REDIS_URL = process.env.REDIS_URL_TEST;
    const queue = new EmailQueueService();
    await queue.onModuleInit();
    try {
      const id = `queue-test-${randomUUID()}`;
      await queue.enqueue(id);
      const job = await queue['queue']!.getJob(id);
      expect(job?.data).toEqual({ outboxId: id });
      await job?.remove();
    } finally { await queue.onModuleDestroy(); }
  }, 15_000);

  it('enforces operation and identity limits through Redis across service instances', async () => {
    process.env.REDIS_URL = process.env.REDIS_URL_TEST;
    const first = new RateLimitService();
    const second = new RateLimitService();
    await first.onModuleInit();
    await second.onModuleInit();
    try {
      const identity = `redis-rate-${randomUUID()}@example.test`;
      const limits = { email: { max: 1, windowMs: 60_000 } };
      await first.consume('integration-test', { email: identity }, limits);
      await expect(second.consume('integration-test', { email: identity }, limits)).rejects.toBeInstanceOf(HttpException);
    } finally {
      await first.onModuleDestroy();
      await second.onModuleDestroy();
    }
  }, 15_000);
});
