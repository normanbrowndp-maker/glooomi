import { Module } from '@nestjs/common';
import { resolve } from 'node:path';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from './database/prisma.service';
import { AuthModule } from './auth/auth.module';
import { SocialModule } from './social/social.module';
import { MediaModule } from './media/media.module';
import { MailService } from './mail/mail.service';
import { HealthController } from './health.controller';
@Module({ imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: resolve(__dirname, '../../../../.env') }), JwtModule.register({}), AuthModule, SocialModule, MediaModule], controllers: [HealthController], providers: [PrismaService, MailService], exports: [PrismaService, MailService] })
export class AppModule {}
