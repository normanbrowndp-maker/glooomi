import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { AuthService } from '../src/modules/auth/auth.service';
import { PrismaService } from '../src/modules/database/prisma.service';
import { decryptEmailPayload } from '../src/modules/mail/mail-crypto';
import { MailService } from '../src/modules/mail/mail.service';

const pepper = 'test-only-pepper-with-at-least-32-bytes';
const digest = (code: string) => createHmac('sha256', pepper).update(code).digest('hex');

describe('AuthService verification codes and sessions', () => {
  afterEach(() => vi.unstubAllEnvs());
  let service: AuthService;
  let db: any;
  let tx: any;
  let jwt: any;

  beforeEach(() => {
    process.env.EMAIL_CODE_PEPPER = pepper;
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-32-bytes';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-bytes';
    tx = {
      $queryRaw: vi.fn(),
      user: { update: vi.fn() },
      verificationCode: { findFirst: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }), create: vi.fn() },
      emailOutbox: { create: vi.fn() },
      session: { deleteMany: vi.fn() },
    };
    db = {
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'user-1', email: 'person@example.com' }), update: vi.fn() },
      verificationCode: { findFirst: vi.fn(), updateMany: vi.fn() },
      session: { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
      $transaction: vi.fn(async (callback: (client: any) => unknown) => callback(tx)),
    };
    jwt = { signAsync: vi.fn().mockResolvedValueOnce('signed-refresh-token').mockResolvedValueOnce('signed-access-token') };
    service = new AuthService(db as PrismaService, jwt, { send: vi.fn() } as unknown as MailService);
  });

  it('increments attempts for an incorrect code', async () => {
    tx.verificationCode.findFirst.mockResolvedValue({ id: 'code-1', codeHash: digest('123456'), attempts: 0, invalidatedAt: null });
    await expect(service['consumeVerificationWithClient'](tx, 'user-1', '000000', 'VERIFY' as any)).resolves.toBe(false);
    expect(tx.verificationCode.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { attempts: { increment: 1 } } }));
  });

  it('invalidates a code after the fifth incorrect attempt', async () => {
    tx.verificationCode.findFirst.mockResolvedValue({ id: 'code-1', codeHash: digest('123456'), attempts: 4, invalidatedAt: null });
    await expect(service['consumeVerificationWithClient'](tx, 'user-1', '000000', 'VERIFY' as any)).resolves.toBe(false);
    expect(tx.verificationCode.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { attempts: { increment: 1 }, invalidatedAt: expect.any(Date) } }));
  });

  it('atomically consumes a valid code and verifies the email', async () => {
    tx.verificationCode.findFirst.mockResolvedValue({ id: 'code-1', codeHash: digest('001234'), attempts: 0, invalidatedAt: null });
    const consumed = await service['consumeVerificationWithClient'](tx, 'user-1', '001234', 'VERIFY' as any);
    expect(consumed).toBe(true);
    expect(tx.verificationCode.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'code-1', codeHash: digest('001234') }) }));
  });

  it('rejects a code already consumed by a concurrent request', async () => {
    tx.verificationCode.findFirst.mockResolvedValue({ id: 'code-1', codeHash: digest('001234'), attempts: 0, invalidatedAt: null });
    tx.verificationCode.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service['consumeVerificationWithClient'](tx, 'user-1', '001234', 'VERIFY' as any)).resolves.toBe(false);
  });

  it('signs CSRF tokens so injected cookie values are rejected', () => {
    const token = service.createCsrfToken();
    expect(service.verifyCsrfToken(token)).toBe(true);
    expect(service.verifyCsrfToken(`${token.slice(0, -1)}x`)).toBe(false);
    expect(service.verifyCsrfToken('attacker-controlled')).toBe(false);
  });

  it('stores only encrypted recipient and verification code in the transactional outbox', async () => {
    vi.stubEnv('EMAIL_DELIVERY_MODE', 'queue');
    tx.verificationCode.findFirst.mockResolvedValue(null);
    await service['createVerification'](tx, 'user-1', 'person@example.com', 'VERIFY' as any);
    const outbox = tx.emailOutbox.create.mock.calls[0][0].data;
    expect(outbox.payloadCiphertext).not.toContain('person@example.com');
    expect(decryptEmailPayload({ ciphertext: outbox.payloadCiphertext, iv: outbox.payloadIv, tag: outbox.payloadTag })).toMatchObject({ to: 'person@example.com', code: expect.stringMatching(/^\d{6}$/) });
    expect(outbox.jobId).toBe(outbox.id);
  });
});
