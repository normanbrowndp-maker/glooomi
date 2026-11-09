import { Module } from '@nestjs/common';
import { resolve } from 'node:path';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from './database/prisma.service';
import { EmailProcessor } from './mail/email.processor';
import { MailModule } from './mail/mail.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: resolve(__dirname, '../../../../.env') }), MailModule],
  providers: [PrismaService, EmailProcessor],
})
export class WorkerModule {}
