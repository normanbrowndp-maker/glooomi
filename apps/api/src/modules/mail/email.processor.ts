import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EmailOutboxStatus } from '@prisma/client';
import { Job, Worker } from 'bullmq';
import { PrismaService } from '../database/prisma.service';
import { decryptEmailPayload } from './mail-crypto';
import { EmailJob, EMAIL_QUEUE_NAME } from './email-queue.service';
import { MailService } from './mail.service';
import { redisConnectionOptions } from './redis-connection';
import { emailDeliveryMode } from './email-delivery-mode';

const MAX_ATTEMPTS = 5;

@Injectable()
export class EmailProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailProcessor.name);
  private worker?: Worker<EmailJob>;

  constructor(private db: PrismaService, private mail: MailService) {}

  async onModuleInit() {
    if (emailDeliveryMode() === 'direct') {
      this.logger.log('Direct email delivery is active; no email worker is required');
      return;
    }
    const connection = redisConnectionOptions();
    if (!connection) throw new Error('REDIS_URL is required to start the email worker');
    this.worker = new Worker<EmailJob>(EMAIL_QUEUE_NAME, job => this.process(job), { connection, concurrency: 4, autorun: true });
    this.worker.on('ready', () => this.logger.log('Email worker is ready'));
    this.worker.on('failed', (job, error) => {
      this.logger.error(`Email job ${job?.id || 'unknown'} failed (${error.name})`);
      if (job && job.attemptsMade >= MAX_ATTEMPTS) void this.markFailed(job.data.outboxId, error.name);
    });
    await this.worker.waitUntilReady();
  }

  async onModuleDestroy() { await this.worker?.close(); }

  private async process(job: Job<EmailJob>) {
    const row = await this.db.emailOutbox.findUnique({ where: { id: job.data.outboxId } });
    if (!row || row.status === EmailOutboxStatus.SENT || row.status === EmailOutboxStatus.FAILED) return;
    const claim = await this.db.emailOutbox.updateMany({
      where: { id: row.id, status: { in: [EmailOutboxStatus.PENDING, EmailOutboxStatus.PROCESSING] } },
      data: { status: EmailOutboxStatus.PROCESSING, attempts: { increment: 1 }, lockedAt: new Date() },
    });
    if (!claim.count) return;
    const current = await this.db.emailOutbox.findUniqueOrThrow({ where: { id: row.id } });
    if (current.attempts > MAX_ATTEMPTS) {
      await this.markFailed(row.id, 'RETRY_LIMIT_REACHED');
      return;
    }
    const payload = decryptEmailPayload({ ciphertext: current.payloadCiphertext, iv: current.payloadIv, tag: current.payloadTag });
    await this.mail.send(current.kind, payload, current.jobId);
    await this.db.emailOutbox.updateMany({
      where: { id: current.id, status: EmailOutboxStatus.PROCESSING },
      data: { status: EmailOutboxStatus.SENT, sentAt: new Date(), lockedAt: null, lastError: null, payloadCiphertext: '', payloadIv: '', payloadTag: '' },
    });
  }

  private async markFailed(id: string, errorName: string) {
    await this.db.emailOutbox.updateMany({
      where: { id, status: { not: EmailOutboxStatus.SENT } },
      data: { status: EmailOutboxStatus.FAILED, lockedAt: null, lastError: errorName.slice(0, 80), payloadCiphertext: '', payloadIv: '', payloadTag: '' },
    });
  }
}
