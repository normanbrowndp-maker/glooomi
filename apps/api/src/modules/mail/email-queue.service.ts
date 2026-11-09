import { Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { redisConnectionOptions } from './redis-connection';
import { emailDeliveryMode } from './email-delivery-mode';

export type EmailJob = { outboxId: string };
export const EMAIL_QUEUE_NAME = 'gloomi-emails';

@Injectable()
export class EmailQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailQueueService.name);
  private queue?: Queue<EmailJob>;

  async onModuleInit() {
    if (emailDeliveryMode() === 'direct') return;
    const connection = redisConnectionOptions();
    if (!connection) {
      this.logger.warn('REDIS_URL is missing; email outbox dispatch is paused');
      return;
    }
    this.queue = new Queue<EmailJob>(EMAIL_QUEUE_NAME, {
      connection: connection as ConnectionOptions,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { age: 86_400, count: 1_000 },
        removeOnFail: { age: 86_400, count: 1_000 },
      },
    });
    await this.queue.waitUntilReady();
  }

  async onModuleDestroy() { await this.queue?.close(); }

  async enqueue(outboxId: string) {
    if (!this.queue) throw new ServiceUnavailableException('Email queue is not configured. Set REDIS_URL.');
    await this.queue.add('deliver-email', { outboxId }, { jobId: outboxId });
  }

  async health() {
    if (emailDeliveryMode() === 'direct') return { status: 'not_required' as const };
    if (!this.queue) return { status: 'unavailable' as const };
    try { await (await this.queue.client).ping(); return { status: 'ok' as const }; }
    catch { return { status: 'unavailable' as const }; }
  }
}
