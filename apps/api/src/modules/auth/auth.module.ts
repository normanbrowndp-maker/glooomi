import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PrismaService } from '../database/prisma.service';
import { MailService } from '../mail/mail.service';
@Module({ imports: [JwtModule.register({})], controllers: [AuthController], providers: [AuthService, JwtAuthGuard, PrismaService, MailService], exports: [AuthService, JwtAuthGuard] })
export class AuthModule {}
