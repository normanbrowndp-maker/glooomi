import { describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { RateLimitService } from '../src/modules/auth/rate-limit.service';

describe('RateLimitService local fallback', () => {
  it('applies operation-scoped limits to IP and normalized identity keys', async () => {
    process.env.NODE_ENV = 'test';
    process.env.EMAIL_CODE_PEPPER = 'rate-limit-test-pepper-at-least-32-bytes';
    const limiter = new RateLimitService();
    await limiter.consume('login', { ip: '127.0.0.1', email: 'User@example.test' }, { ip: { max: 1, windowMs: 60_000 } });
    await expect(limiter.consume('login', { ip: '127.0.0.1', email: 'Other@example.test' }, { ip: { max: 1, windowMs: 60_000 } }))
      .rejects.toBeInstanceOf(HttpException);
    await expect(limiter.consume('register', { ip: '127.0.0.1', email: 'Other@example.test' }, { ip: { max: 1, windowMs: 60_000 } })).resolves.toBeUndefined();
  });
});
