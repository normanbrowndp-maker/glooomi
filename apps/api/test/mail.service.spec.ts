import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailOutboxKind } from '@prisma/client';
const transport = vi.hoisted(() => ({ verify: vi.fn(), sendMail: vi.fn(), close: vi.fn() }));
const createTransport = vi.hoisted(() => vi.fn(() => transport));
vi.mock('nodemailer', () => ({ createTransport }));
import { MailService } from '../src/modules/mail/mail.service';

describe('MailService SMTP acceptance and redaction', () => {
  let mail: MailService;
  beforeEach(() => {
    vi.clearAllMocks();
    for (const [key, value] of Object.entries({ SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '465', SMTP_SECURE: 'true', SMTP_USER: 'sender@example.test', SMTP_PASSWORD: 'abcd efgh ijkl mnop', SMTP_FROM: 'sender@example.test' })) vi.stubEnv(key, value);
    transport.verify.mockResolvedValue(true); transport.sendMail.mockResolvedValue({ accepted: ['person@example.test'], rejected: [] });
    mail = new MailService();
  });
  afterEach(async () => { await mail.onModuleDestroy(); vi.unstubAllEnvs(); });
  it('reuses Nodemailer with Gmail TLS and removes App Password display spaces only in memory', async () => {
    await mail.onModuleInit();
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: 'sender@example.test', pass: 'abcdefghijklmnop' } }));
    expect(process.env.SMTP_PASSWORD).toBe('abcd efgh ijkl mnop');
    await expect(mail.send(EmailOutboxKind.VERIFY_EMAIL, { to: 'person@example.test', code: '001234' }, 'mail-1')).resolves.toEqual({ accepted: true });
    expect(transport.sendMail).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('001234'), to: 'person@example.test' }));
    expect(mail.health().status).toBe('ok');
  });
  it('rejects a resolved sendMail result when the recipient was not accepted', async () => {
    await mail.onModuleInit(); transport.sendMail.mockResolvedValue({ accepted: [], rejected: ['person@example.test'] });
    await expect(mail.send(EmailOutboxKind.VERIFY_EMAIL, { to: 'person@example.test', code: '123456' }, 'mail-2')).rejects.toMatchObject({ status: 503 });
    expect(mail.health().status).toBe('unavailable');
  });
  it('returns sanitized failures and never logs raw SMTP errors, passwords or codes', async () => {
    const log = vi.spyOn(mail['logger'], 'warn').mockImplementation(() => {});
    await mail.onModuleInit();
    transport.sendMail.mockRejectedValue(Object.assign(new Error('SECRET_PASSWORD and 123456'), { code: 'EAUTH', name: 'SECRET_PASSWORD' }));
    const error = await mail.send(EmailOutboxKind.VERIFY_EMAIL, { to: 'person@example.test', code: '123456' }, 'mail-3').catch(e => e);
    expect(error.getStatus()).toBe(503);
    expect(JSON.stringify([error.getResponse(), log.mock.calls, mail.health()])).not.toMatch(/SECRET_PASSWORD|123456/);
    expect(mail.health()).toMatchObject({ reason: 'EAUTH' });
  });
  it('recovers after a transient SMTP failure', async () => {
    await mail.onModuleInit(); transport.sendMail.mockRejectedValueOnce(new Error('offline'));
    await expect(mail.send(EmailOutboxKind.VERIFY_EMAIL, { to: 'person@example.test', code: '123456' }, 'mail-4')).rejects.toMatchObject({ status: 503 });
    await expect(mail.send(EmailOutboxKind.VERIFY_EMAIL, { to: 'person@example.test', code: '654321' }, 'mail-5')).resolves.toEqual({ accepted: true });
    expect(mail.health().status).toBe('ok');
  });
  it('rejects missing configuration without attempting to send', async () => {
    vi.stubEnv('SMTP_FROM', ''); await mail.onModuleInit();
    await expect(mail.send(EmailOutboxKind.VERIFY_EMAIL, { to: 'person@example.test', code: '123456' }, 'mail-6')).rejects.toMatchObject({ status: 503 });
    expect(createTransport).not.toHaveBeenCalled(); expect(transport.sendMail).not.toHaveBeenCalled();
  });
  it('requires STARTTLS for authenticated SMTP on port 587', async () => {
    vi.stubEnv('SMTP_PORT', '587'); vi.stubEnv('SMTP_SECURE', 'false'); await mail.onModuleInit();
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: false, requireTLS: true }));
  });
});
