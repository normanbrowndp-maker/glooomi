import { Module } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { EmailOutboxDispatcher } from './email-outbox-dispatcher';
import { EmailQueueService } from './email-queue.service';

@Module({ providers: [PrismaService, EmailQueueService, EmailOutboxDispatcher], exports: [EmailQueueService, EmailOutboxDispatcher] })
export class EmailQueueModule {}
