import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';

const rawUrl = process.env.DATABASE_URL_MIGRATION_TEST;
if (!rawUrl) throw new Error('Set DATABASE_URL_MIGRATION_TEST to the dedicated local migration test database.');
const url = new URL(rawUrl);
const database = decodeURIComponent(url.pathname.slice(1));
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '5434' || database !== 'gloomi_migration_test') {
  throw new Error('Migration tests only accept localhost:5434/gloomi_migration_test. No production database is allowed.');
}

const migrationDirectory = new URL('../../../prisma/migrations/', import.meta.url);
const migration001 = await readFile(new URL('0001_init/migration.sql', migrationDirectory), 'utf8');
const migration002 = await readFile(new URL('0002_auth_hardening/migration.sql', migrationDirectory), 'utf8');
const migration003 = await readFile(new URL('0003_email_outbox_sessions/migration.sql', migrationDirectory), 'utf8');
const migration004 = await readFile(new URL('0004_private_media/migration.sql', migrationDirectory), 'utf8');
const client = new Client({ connectionString: rawUrl });
const schema = `gloomi_migration_${randomBytes(6).toString('hex')}`;

try {
  await client.connect();
  await client.query('BEGIN');
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET LOCAL search_path TO "${schema}", public`);
  await client.query(migration001);
  await client.query('INSERT INTO "User" ("id", "email", "username", "passwordHash") VALUES ($1, $2, $3, $4)', ['legacy-user', 'legacy@example.test', 'legacy_user', 'legacy-hash']);
  await client.query('INSERT INTO "VerificationCode" ("id", "userId", "purpose", "codeHash", "expiresAt") VALUES ($1, $2, $3, $4, NOW() + INTERVAL \'1 day\')', ['legacy-code', 'legacy-user', 'VERIFY', 'legacy-digest']);
  await client.query('INSERT INTO "Session" ("id", "userId", "refreshTokenHash", "expiresAt") VALUES ($1, $2, $3, NOW() + INTERVAL \'1 day\')', ['legacy-session', 'legacy-user', 'legacy-session-hash']);

  await client.query(migration002);
  const codeAfter002 = await client.query('SELECT "attempts", "invalidatedAt" FROM "VerificationCode" WHERE "id" = $1', ['legacy-code']);
  if (codeAfter002.rows[0]?.attempts !== 0 || codeAfter002.rows[0]?.invalidatedAt !== null) throw new Error('0002_auth_hardening did not preserve legacy verification data/defaults.');

  await client.query(migration003);
  const dataAfter003 = await client.query('SELECT u."email", s."refreshTokenHash", s."previousRefreshTokenHash" FROM "User" u JOIN "Session" s ON s."userId" = u."id" WHERE s."id" = $1', ['legacy-session']);
  if (dataAfter003.rows[0]?.email !== 'legacy@example.test' || dataAfter003.rows[0]?.refreshTokenHash !== 'legacy-session-hash' || dataAfter003.rows[0]?.previousRefreshTokenHash !== null) {
    throw new Error('0003_email_outbox_sessions did not preserve legacy user/session data.');
  }
  const indexes = await client.query('SELECT indexname FROM pg_indexes WHERE schemaname = $1', [schema]);
  if (!indexes.rows.some(row => row.indexname === 'EmailOutbox_jobId_key')) throw new Error('EmailOutbox job id uniqueness index was not created.');
  await client.query(migration004);
  const afterMedia = await client.query('SELECT "email", (SELECT count(*) FROM "MediaAsset") AS "mediaCount" FROM "User" WHERE "id" = $1', ['legacy-user']);
  if (afterMedia.rows[0]?.email !== 'legacy@example.test' || Number(afterMedia.rows[0]?.mediaCount) !== 0) throw new Error('0004_private_media did not preserve legacy rows.');
  const mediaIndexes = await client.query('SELECT indexname FROM pg_indexes WHERE schemaname = $1', [schema]);
  if (!mediaIndexes.rows.some(row => row.indexname === 'MediaAsset_objectKey_key')) throw new Error('Media object key uniqueness index was not created.');
  console.log('Migration tests passed: 0002-0004 preserve legacy rows and create expected indexes.');
} finally {
  try { await client.query('ROLLBACK'); } catch {}
  await client.end();
}
