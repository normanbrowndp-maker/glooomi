// Read-only diagnostics: no emails, database writes, migrations, or Redis calls.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../../', import.meta.url));
require('dotenv').config({ path: resolve(root, '.env') });
const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM', 'EMAIL_CODE_PEPPER', 'DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
const missing = required.filter(key => !process.env[key]?.trim());
console.log(JSON.stringify({ configuration: missing.length ? 'missing' : 'present', missing,
  pepperLengthValid: Buffer.byteLength(process.env.EMAIL_CODE_PEPPER || '') >= 32,
  gmailHost: process.env.SMTP_HOST === 'smtp.gmail.com',
  gmailTlsPortCompatible: (process.env.SMTP_PORT === '465' && process.env.SMTP_SECURE === 'true') || (process.env.SMTP_PORT === '587' && process.env.SMTP_SECURE === 'false'),
  fromMatchesSmtpUser: process.env.SMTP_FROM === process.env.SMTP_USER,
}));
if (missing.length) process.exit(1);
const { PrismaClient, Prisma } = require('@prisma/client');
const db = new PrismaClient({ log: [] });
let schemaReady = false;
try {
  const tables = ['User', 'Profile', 'VerificationCode', 'Session', 'MediaAsset', 'Post', 'Story', 'Follow', 'Like', 'SavedPost', 'Comment', 'Conversation', 'ConversationMember', 'Message', 'Notification'];
  const columns = await db.$queryRaw`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('User', 'Profile', 'VerificationCode', 'Session', 'MediaAsset', 'Post', 'Story', 'Follow', 'Like', 'SavedPost', 'Comment', 'Conversation', 'ConversationMember', 'Message', 'Notification')`;
  const absent = [];
  for (const model of Prisma.dmmf.datamodel.models.filter(model => tables.includes(model.name))) {
    for (const field of model.fields.filter(field => field.kind !== 'object')) {
      if (!columns.some(column => column.table_name === (model.dbName || model.name) && column.column_name === (field.dbName || field.name))) absent.push(`${model.name}.${field.name}`);
    }
  }
  schemaReady = absent.length === 0;
  console.log(JSON.stringify({ authSchema: schemaReady ? 'ok' : 'missing_columns', missingColumns: absent }));
} catch {
  console.log(JSON.stringify({ authSchema: 'unavailable', hint: 'Check database access locally; no raw driver error is printed.' }));
} finally { await db.$disconnect(); }
const { MailService } = require('../dist/modules/mail/mail.service.js');
const mail = new MailService();
await mail.onModuleInit();
const smtp = mail.health();
console.log(JSON.stringify({ smtp: smtp.status, ...(smtp.reason ? { reason: smtp.reason } : {}) }));
await mail.onModuleDestroy();

// A dedicated port and explicit process-only settings isolate this probe from
// existing local processes. Existing .env values and PostgreSQL rows stay intact.
const port = '3317';
const child = spawn(process.execPath, [resolve(root, 'apps/api/dist/main.js')], {
  cwd: root, windowsHide: true,
  env: { ...process.env, NODE_ENV: 'development', EMAIL_DELIVERY_MODE: 'direct', REDIS_URL: '', PORT: port, AWS_EC2_METADATA_DISABLED: 'true', MEDIA_CLEANUP_ENABLED: 'false' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
// Suppress framework/driver diagnostics; raw errors can contain connection data.
child.stdout.resume(); child.stderr.resume();
let ready = false;
try {
  for (let n = 0; n < 120 && child.exitCode === null; n++) {
    try {
      const result = await fetch(`http://127.0.0.1:${port}/api/health/email`, { signal: AbortSignal.timeout(500) });
      if (result.ok) {
        const data = await result.json();
        ready = data.mode === 'direct' && data.redis?.status === 'not_required';
        console.log(JSON.stringify({ apiWithoutRedis: ready ? 'ok' : 'failed', mode: data.mode, redis: data.redis?.status, smtp: data.smtp?.status }));
        break;
      }
    } catch {}
    await delay(250);
  }
} finally {
  child.kill();
}
if (!ready) console.log(JSON.stringify({ apiWithoutRedis: 'failed', hint: 'Check database connectivity and required JWT configuration locally; no secret values are printed.' }));
if (smtp.status !== 'ok' || !ready || !schemaReady) process.exitCode = 1;
