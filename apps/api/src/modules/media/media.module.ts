import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from '../database/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MediaController } from './media.controller';
import { MEDIA_STORAGE, S3MediaStorage } from './storage';
import { MediaService } from './media.service';
@Module({ imports: [JwtModule.register({})], controllers: [MediaController], providers: [PrismaService, JwtAuthGuard, MediaService, S3MediaStorage, { provide: MEDIA_STORAGE, useExisting: S3MediaStorage }], exports: [MediaService] })
export class MediaModule {}
