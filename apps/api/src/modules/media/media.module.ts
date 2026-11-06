import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from '../database/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MediaController } from './media.controller';
@Module({ imports: [JwtModule.register({})], controllers: [MediaController], providers: [PrismaService, JwtAuthGuard] })
export class MediaModule {}
