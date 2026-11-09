// Explicit recipient only. Uses the real API's resend endpoint and all its limits.
// Existing accounts/passwords are never replaced; no migrations are performed.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Pass an explicitly authorized recipient email as the only argument.');
const purpose = process.argv[3] || 'verify';
if (!['verify', 'reset'].includes(purpose)) throw new Error('Purpose must be verify or reset.');
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../../', import.meta.url));
require('dotenv').config({ path: resolve(root, '.env') });
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient({ log: [] });
let child;
try {
  const user = await db.user.findUnique({ where: { email }, select: { id: true, emailVerified: true } });
  if (!user) { console.log(JSON.stringify({ status: 'account_not_found', message: 'Register this email in GLOOMI first. No account or password was created by this script.' })); process.exitCode = 1; }
  else if (user.emailVerified && purpose === 'verify') console.log(JSON.stringify({ status: 'already_verified', message: 'No verification message sent; the account is already verified.' }));
  else if (!user.emailVerified && purpose === 'reset') { console.log(JSON.stringify({ status: 'verification_required', message: 'Confirm the account before requesting a password reset.' })); process.exitCode = 1; }
  else {
    const listener = createServer();
    await new Promise((ok, fail) => { listener.once('error', fail); listener.listen(0, '127.0.0.1', ok); });
    const port = listener.address().port;
    await new Promise(ok => listener.close(ok));
    child = spawn(process.execPath, [resolve(root, 'apps/api/dist/main.js')], { cwd: root, windowsHide: true,
      env: { ...process.env, NODE_ENV: 'development', EMAIL_DELIVERY_MODE: 'direct', REDIS_URL: '', PORT: String(port), AWS_EC2_METADATA_DISABLED: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.resume(); child.stderr.resume();
    let ready = false;
    for (let n = 0; n < 120 && child.exitCode === null; n++) {
      try { const health = await fetch(`http://127.0.0.1:${port}/api/health/email`, { signal: AbortSignal.timeout(500) });
        if (health.ok && (await health.json()).mode === 'direct') { ready = true; break; }
      } catch {}
      await delay(250);
    }
    if (!ready) throw new Error('API startup failed');
    const endpoint = purpose === 'reset' ? 'password-reset/request' : 'resend-code';
    const result = await fetch(`http://127.0.0.1:${port}/api/auth/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }), signal: AbortSignal.timeout(45_000) });
    if (!result.ok) {
      const response = await result.json().catch(() => ({}));
      console.log(JSON.stringify({ status: 'not_accepted', httpStatus: result.status,
        code: ['EMAIL_CODE_COOLDOWN', 'EMAIL_DELIVERY_FAILED'].includes(response.code) ? response.code : 'REQUEST_FAILED',
        ...(typeof response.retryAfterSeconds === 'number' ? { retryAfterSeconds: response.retryAfterSeconds } : {}) }));
      process.exitCode = 1;
    } else {
      const code = await db.verificationCode.findFirst({ where: { userId: user.id, purpose: purpose === 'reset' ? 'RESET_PASSWORD' : 'VERIFY', invalidatedAt: null }, orderBy: { createdAt: 'desc' }, select: { expiresAt: true } });
      console.log(JSON.stringify({ status: 'smtp_accepted', purpose, verificationPersisted: !!code, expiresAt: code?.expiresAt,
        message: 'SMTP accepted the message. Inbox delivery must be confirmed by the recipient. No code, password or token is printed.' }));
    }
  }
} catch {
  console.log(JSON.stringify({ status: 'failed', message: 'Check local connectivity and API configuration. Raw driver/SMTP errors are suppressed.' }));
  process.exitCode = 1;
} finally { child?.kill(); await db.$disconnect(); }
