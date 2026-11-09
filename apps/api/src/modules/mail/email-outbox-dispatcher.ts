import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EmailOutboxStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { EmailQueueService } from './email-queue.service';
import { emailDeliveryMode } from './email-delivery-mode';

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 5;
const MAX_DISPATCH_ATTEMPTS = 10;
const LEASE_MS = 120_000;

@Injectable()
export class EmailOutboxDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailOutboxDispatcher.name);
  private timer?: NodeJS.Timeout;
  private dispatching = false;

  constructor(private db: PrismaService, private queue: EmailQueueService) {}

  onModuleInit() {
    if (emailDeliveryMode() === 'direct') return;
    this.timer = setInterval(() => void this.dispatch(), 2_000);
    this.timer.unref();
    void this.dispatch();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async dispatch() {
    if (emailDeliveryMode() === 'direct' || this.dispatching || !process.env.REDIS_URL) return;
    this.dispatching = true;
    const now = new Date();
    const expiredLease = new Date(now.getTime() - LEASE_MS);
    try {
      const rows = await this.db.emailOutbox.findMany({
        where: { OR: [
          { status: EmailOutboxStatus.PENDING, availableAt: { lte: now } },
          { status: EmailOutboxStatus.PROCESSING, lockedAt: { lt: expiredLease } },
        ] },
        orderBy: { createdAt: 'asc' },
        take: BATCH_SIZE,
        select: { id: true, status: true, attempts: true, dispatchAttempts: true },
      });
      for (const row of rows) {
        if (row.attempts >= MAX_ATTEMPTS || row.dispatchAttempts >= MAX_DISPATCH_ATTEMPTS) {
          await this.db.emailOutbox.updateMany({ where: { id: row.id, status: { not: EmailOutboxStatus.SENT } }, data: { status: EmailOutboxStatus.FAILED, lockedAt: null, lastError: 'RETRY_LIMIT_REACHED', payloadCiphertext: '', payloadIv: '', payloadTag: '' } });
          continue;
        }
        const leaseFilter: Prisma.EmailOutboxWhereInput = row.status === EmailOutboxStatus.PENDING
          ? { id: row.id, status: EmailOutboxStatus.PENDING, availableAt: { lte: now } }
          : { id: row.id, status: EmailOutboxStatus.PROCESSING, lockedAt: { lt: expiredLease } };
        const claimed = await this.db.emailOutbox.updateMany({ where: leaseFilter, data: { status: EmailOutboxStatus.PROCESSING, lockedAt: now, dispatchAttempts: { increment: 1 } } });
        if (!claimed.count) continue;
        try {
          await this.queue.enqueue(row.id);
        } catch (error) {
          await this.db.emailOutbox.updateMany({ where: { id: row.id, status: EmailOutboxStatus.PROCESSING, lockedAt: now }, data: { status: EmailOutboxStatus.PENDING, lockedAt: null, availableAt: new Date(Date.now() + 5_000), lastError: error instanceof Error ? error.name : 'QUEUE_ERROR' } });
          this.logger.warn(`Email outbox enqueue deferred (${row.id})`);
        }
      }
    } catch (error) {
      this.logger.error(`Email outbox poll failed (${error instanceof Error ? error.name : 'UNKNOWN_ERROR'})`);
    } finally {
      this.dispatching = false;
    }
  }
}
