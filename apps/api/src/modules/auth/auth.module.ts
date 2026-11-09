import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PrismaService } from '../database/prisma.service';
import { RateLimitModule } from './rate-limit.module';
import { MediaModule } from '../media/media.module';
import { MailModule } from '../mail/mail.module';
@Module({ imports: [JwtModule.register({}), RateLimitModule, MediaModule, MailModule], controllers: [AuthController], providers: [AuthService, JwtAuthGuard, PrismaService], exports: [AuthService, JwtAuthGuard] })
export class AuthModule {}
