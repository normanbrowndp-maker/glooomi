import { Module } from '@nestjs/common';
import { resolve } from 'node:path';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from './database/prisma.service';
import { AuthModule } from './auth/auth.module';
import { SocialModule } from './social/social.module';
import { MediaModule } from './media/media.module';
import { EmailQueueModule } from './mail/email-queue.module';
import { MailModule } from './mail/mail.module';
import { HealthController } from './health.controller';
@Module({ imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: resolve(__dirname, '../../../../.env') }), JwtModule.register({}), MailModule, EmailQueueModule, AuthModule, SocialModule, MediaModule], controllers: [HealthController], providers: [PrismaService], exports: [PrismaService] })
export class AppModule {}
