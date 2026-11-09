import { afterEach, describe, expect, it, vi } from 'vitest';
import { emailDeliveryMode } from '../src/modules/mail/email-delivery-mode';
import { EmailQueueService } from '../src/modules/mail/email-queue.service';
import { EmailOutboxDispatcher } from '../src/modules/mail/email-outbox-dispatcher';
import { EmailProcessor } from '../src/modules/mail/email.processor';
import { RateLimitService } from '../src/modules/auth/rate-limit.service';

describe('local SMTP mode without Redis', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('defaults to direct outside production, keeping queue as the production default', () => {
    vi.stubEnv('EMAIL_DELIVERY_MODE', ''); vi.stubEnv('NODE_ENV', 'development'); expect(emailDeliveryMode()).toBe('direct');
    vi.stubEnv('NODE_ENV', 'production'); expect(emailDeliveryMode()).toBe('queue');
  });
  it.each(['', 'redis://127.0.0.1:1'])('initializes queue, dispatcher, worker and local limiter without connecting to Redis (%s)', async redis => {
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('EMAIL_DELIVERY_MODE', 'direct'); vi.stubEnv('REDIS_URL', redis);
    vi.stubEnv('EMAIL_CODE_PEPPER', 'local-mode-test-pepper-at-least-32-bytes');
    const queue = new EmailQueueService();
    const dispatcher = new EmailOutboxDispatcher({} as any, queue);
    const worker = new EmailProcessor({} as any, {} as any);
    const limiter = new RateLimitService();
    await queue.onModuleInit(); dispatcher.onModuleInit(); await dispatcher.dispatch(); await worker.onModuleInit(); await limiter.onModuleInit();
    expect(await queue.health()).toEqual({ status: 'not_required' });
    expect(queue['queue']).toBeUndefined(); expect(dispatcher['timer']).toBeUndefined(); expect(worker['worker']).toBeUndefined(); expect(limiter['redis']).toBeUndefined();
    await limiter.consume('resend', { email: 'person@example.test' }, { email: { max: 1, windowMs: 60_000 } });
    await expect(limiter.consume('resend', { email: 'person@example.test' }, { email: { max: 1, windowMs: 60_000 } })).rejects.toMatchObject({ status: 429 });
    await queue.onModuleDestroy(); dispatcher.onModuleDestroy(); await worker.onModuleDestroy(); await limiter.onModuleDestroy();
  });
  it('rejects an invalid mode and keeps production rate limiting fail-closed', async () => {
    vi.stubEnv('EMAIL_DELIVERY_MODE', 'typo'); expect(emailDeliveryMode).toThrow('EMAIL_DELIVERY_MODE');
    vi.stubEnv('EMAIL_DELIVERY_MODE', 'direct'); vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('REDIS_URL', '');
    await expect(new RateLimitService().onModuleInit()).rejects.toThrow('REDIS_URL');
  });
});
