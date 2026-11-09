import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.DATABASE_URL_TEST;
if (!databaseUrl) throw new Error('Set DATABASE_URL_TEST to the dedicated local PostgreSQL test database.');
const url = new URL(databaseUrl);
const database = decodeURIComponent(url.pathname.slice(1));
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '5433' || database !== 'gloomi_test') {
  throw new Error('Integration tests only accept localhost:5433/gloomi_test. Production databases are not allowed.');
}
if (!process.env.DATABASE_URL_MIGRATION_TEST) throw new Error('Set DATABASE_URL_MIGRATION_TEST to the dedicated migration test database.');
const migrationUrl = new URL(process.env.DATABASE_URL_MIGRATION_TEST);
if (!['localhost', '127.0.0.1'].includes(migrationUrl.hostname) || migrationUrl.port !== '5434' || decodeURIComponent(migrationUrl.pathname.slice(1)) !== 'gloomi_migration_test') {
  throw new Error('Migration tests only accept localhost:5434/gloomi_migration_test. Production databases are not allowed.');
}
if (!process.env.REDIS_URL_TEST) throw new Error('Set REDIS_URL_TEST to the local Redis service for queue/rate-limit integration tests.');

const env = { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: process.env.DATABASE_URL_MIGRATION_TEST, REDIS_URL: process.env.REDIS_URL_TEST };
const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
function run(args) {
  const result = spawnSync(corepack, args, { cwd: process.cwd(), env, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

run(['pnpm', 'exec', 'prisma', 'validate', '--schema', '../../prisma/schema.prisma', '--config', '../../prisma.config.ts']);
run(['pnpm', 'exec', 'prisma', 'migrate', 'deploy', '--schema', '../../prisma/schema.prisma', '--config', '../../prisma.config.ts']);
run(['pnpm', 'exec', 'prisma', 'migrate', 'status', '--schema', '../../prisma/schema.prisma', '--config', '../../prisma.config.ts']);
run(['pnpm', 'test:migrations']);
run(['pnpm', 'exec', 'vitest', 'run', 'test/integration']);
