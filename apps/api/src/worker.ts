import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './modules/worker.module';

async function bootstrap() {
  const logger = new Logger('EmailWorker');
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['error', 'warn', 'log'] });
  const shutdown = async (signal: string) => {
    logger.log(`${signal} received; closing email worker`);
    await app.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

void bootstrap().catch(error => {
  const logger = new Logger('EmailWorker');
  logger.error(`Worker startup failed (${error instanceof Error ? error.name : 'UNKNOWN_ERROR'})`);
  process.exitCode = 1;
});
