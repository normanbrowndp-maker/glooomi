import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailOutboxKind, EmailOutboxStatus } from '@prisma/client';
import { EmailProcessor } from '../src/modules/mail/email.processor';
import { encryptEmailPayload } from '../src/modules/mail/mail-crypto';
import { PrismaService } from '../src/modules/database/prisma.service';
import { MailService } from '../src/modules/mail/mail.service';

describe('EmailProcessor', () => {
  let processor: EmailProcessor;
  let db: any;
  let mail: any;
  let row: any;

  beforeEach(() => {
    process.env.EMAIL_CODE_PEPPER = 'worker-test-email-pepper-32-bytes';
    const encrypted = encryptEmailPayload({ to: 'person@example.test', code: '713204' });
    row = {
      id: 'outbox-1', jobId: 'outbox-1', userId: 'user-1', kind: EmailOutboxKind.VERIFY_EMAIL,
      status: EmailOutboxStatus.PENDING, attempts: 1, payloadCiphertext: encrypted.ciphertext, payloadIv: encrypted.iv, payloadTag: encrypted.tag,
    };
    db = {
      emailOutbox: {
        findUnique: vi.fn().mockResolvedValue(row),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ ...row, status: EmailOutboxStatus.PROCESSING, attempts: 1 }),
      },
    };
    mail = { send: vi.fn().mockResolvedValue(undefined) };
    processor = new EmailProcessor(db as PrismaService, mail as MailService);
  });

  it('sends the decrypted outbox payload and clears it after successful delivery', async () => {
    await processor['process']({ data: { outboxId: row.id } } as any);
    expect(mail.send).toHaveBeenCalledWith(EmailOutboxKind.VERIFY_EMAIL, { to: 'person@example.test', code: '713204' }, row.id);
    expect(db.emailOutbox.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: EmailOutboxStatus.SENT, payloadCiphertext: '' }) }));
  });

  it('keeps the encrypted outbox payload when SMTP delivery fails for a queue retry', async () => {
    mail.send.mockRejectedValue(new Error('SMTP unavailable'));
    await expect(processor['process']({ data: { outboxId: row.id } } as any)).rejects.toThrow('SMTP unavailable');
    expect(row.payloadCiphertext).not.toBe('');
    expect(db.emailOutbox.updateMany).toHaveBeenCalledOnce();
  });
});
