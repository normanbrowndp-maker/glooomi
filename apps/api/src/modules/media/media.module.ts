import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from '../database/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MediaController } from './media.controller';
import { MEDIA_STORAGE, S3MediaStorage } from './storage';
import { MediaService } from './media.service';
import { LocalMediaStorage, mediaProvider } from './local-storage';
import { LocalMediaController } from './local-media.controller';
@Module({ imports: [JwtModule.register({})], controllers: [MediaController, LocalMediaController], providers: [PrismaService, JwtAuthGuard, MediaService, LocalMediaStorage, { provide: MEDIA_STORAGE, inject: [LocalMediaStorage], useFactory: (local: LocalMediaStorage) => mediaProvider() === 'local' ? local : new S3MediaStorage() }], exports: [MediaService] })
export class MediaModule {}
