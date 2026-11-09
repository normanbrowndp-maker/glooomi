import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MediaPurpose, MediaStatus, MediaType, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { MEDIA_STORAGE, matchesMediaSignature, MediaStorage } from './storage';

export type UploadIntent = 'POST' | 'STORY' | 'AVATAR';
const MIME_TYPES: Record<string, MediaType> = {
  'image/jpeg': MediaType.IMAGE, 'image/png': MediaType.IMAGE, 'image/webp': MediaType.IMAGE, 'image/gif': MediaType.IMAGE,
  'video/mp4': MediaType.VIDEO, 'video/webm': MediaType.VIDEO, 'video/quicktime': MediaType.VIDEO,
};
const IMAGE_LIMIT = 10 * 1024 * 1024;
const VIDEO_LIMIT = 50 * 1024 * 1024;
const UPLOAD_LIFETIME_MS = 24 * 60 * 60_000;

@Injectable()
export class MediaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediaService.name);
  private cleanupTimer?: NodeJS.Timeout;

  constructor(private readonly db: PrismaService, @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage) {}

  onModuleInit() {
    this.cleanupTimer = setInterval(() => void this.cleanupExpired(), 60 * 60_000);
    this.cleanupTimer.unref();
    void this.cleanupExpired();
  }

  onModuleDestroy() { if (this.cleanupTimer) clearInterval(this.cleanupTimer); }

  async createUpload(ownerId: string, contentType: string, sizeBytes: number, intent: UploadIntent) {
    const mediaType = MIME_TYPES[contentType];
    if (!mediaType) throw new BadRequestException('Unsupported media type.');
    if (intent === 'AVATAR' && mediaType !== MediaType.IMAGE) throw new BadRequestException('Profile photos must be images.');
    const maxBytes = mediaType === MediaType.IMAGE ? IMAGE_LIMIT : VIDEO_LIMIT;
    if (!Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > maxBytes) throw new BadRequestException(`Media must be smaller than ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
    const asset = await this.db.mediaAsset.create({ data: {
      ownerId, objectKey: `private-media/${randomUUID()}`, mediaType, purpose: intent as MediaPurpose, contentType, sizeBytes,
      uploadUntil: new Date(Date.now() + UPLOAD_LIFETIME_MS),
    } });
    try {
      const signed = await this.storage.createUpload(asset.objectKey, contentType, maxBytes);
      return { mediaId: asset.id, uploadUrl: signed.url, fields: signed.fields, expiresIn: 300 };
    } catch (error) {
      await this.db.mediaAsset.updateMany({ where: { id: asset.id, status: MediaStatus.PENDING }, data: { status: MediaStatus.FAILED } });
      throw error;
    }
  }

  async finalize(ownerId: string, mediaId: string) {
    const asset = await this.db.mediaAsset.findFirst({ where: { id: mediaId, ownerId } });
    if (!asset) throw new NotFoundException('Upload not found.');
    if (asset.status === MediaStatus.READY || asset.status === MediaStatus.ATTACHED) return { mediaId: asset.id, status: asset.status };
    if (asset.status !== MediaStatus.PENDING || asset.uploadUntil <= new Date()) throw new BadRequestException('Upload has expired or is no longer available.');

    let verified: Awaited<ReturnType<MediaStorage['inspect']>>;
    try { verified = await this.storage.inspect(asset.objectKey); }
    catch (error) { throw error; }
    if (verified.size !== asset.sizeBytes || verified.contentType !== asset.contentType || !matchesMediaSignature(asset.contentType, verified.prefix)) {
      await this.rejectUpload(asset.id, asset.objectKey);
      throw new BadRequestException('Uploaded file does not match the declared type or size.');
    }
    const changed = await this.db.mediaAsset.updateMany({ where: { id: asset.id, ownerId, status: MediaStatus.PENDING, uploadUntil: { gt: new Date() } }, data: { status: MediaStatus.READY } });
    if (!changed.count) {
      const latest = await this.db.mediaAsset.findUnique({ where: { id: asset.id }, select: { status: true } });
      if (latest?.status === MediaStatus.READY || latest?.status === MediaStatus.ATTACHED) return { mediaId: asset.id, status: latest.status };
      throw new ConflictException('Upload state changed; please retry.');
    }
    return { mediaId: asset.id, status: MediaStatus.READY };
  }

  async attach(tx: Prisma.TransactionClient, ownerId: string, mediaId: string, purpose: MediaPurpose, allowedTypes: MediaType[]) {
    const changed = await tx.mediaAsset.updateMany({
      where: { id: mediaId, ownerId, purpose, mediaType: { in: allowedTypes }, status: MediaStatus.READY, uploadUntil: { gt: new Date() } },
      data: { status: MediaStatus.ATTACHED },
    });
    if (!changed.count) throw new BadRequestException('Media is not ready or is not owned by this account.');
    return tx.mediaAsset.findUniqueOrThrow({ where: { id: mediaId } });
  }

  async readUrl(asset: { objectKey: string; contentType: string; status: MediaStatus }) {
    if (asset.status !== MediaStatus.ATTACHED && asset.status !== MediaStatus.READY) throw new NotFoundException('Media is not available.');
    return this.storage.readUrl(asset.objectKey, asset.contentType);
  }

  async presentProfile(profile: { avatarMedia?: { id: string; objectKey: string; contentType: string; status: MediaStatus } | null; avatarMediaId?: string | null; avatarUrl?: string | null; visibility?: string } | null, allowPrivate = false) {
    if (!profile) return profile;
    const { avatarMedia, avatarMediaId: _avatarMediaId, ...safeProfile } = profile;
    return { ...safeProfile, avatarUrl: avatarMedia && (allowPrivate || profile.visibility !== 'PRIVATE') ? await this.readUrl(avatarMedia) : avatarMedia ? null : safeProfile.avatarUrl };
  }

  async setAvatar(ownerId: string, mediaId: string) {
    await this.db.$transaction(async tx => {
      const asset = await this.attach(tx, ownerId, mediaId, MediaPurpose.AVATAR, [MediaType.IMAGE]);
      const profile = await tx.profile.findUniqueOrThrow({ where: { userId: ownerId }, select: { avatarMediaId: true } });
      await tx.profile.update({ where: { userId: ownerId }, data: { avatarMediaId: asset.id, avatarUrl: null } });
      if (profile.avatarMediaId && profile.avatarMediaId !== asset.id) await tx.mediaAsset.updateMany({ where: { id: profile.avatarMediaId, ownerId, status: MediaStatus.ATTACHED }, data: { status: MediaStatus.READY } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { ok: true };
  }

  async remove(ownerId: string, mediaId: string) {
    const key = await this.db.$transaction(async tx => {
      const asset = await tx.mediaAsset.findFirst({ where: { id: mediaId, ownerId } });
      if (!asset) throw new NotFoundException('Media not found.');
      if (asset.status === MediaStatus.ATTACHED) throw new ConflictException('Attached media cannot be deleted.');
      const changed = await tx.mediaAsset.updateMany({ where: { id: mediaId, ownerId, status: { in: [MediaStatus.READY, MediaStatus.PENDING, MediaStatus.FAILED] } }, data: { status: MediaStatus.DELETED } });
      if (!changed.count) throw new ConflictException('Media is already unavailable.');
      return asset.objectKey;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await this.storage.remove(key);
    await this.db.mediaAsset.deleteMany({ where: { id: mediaId, ownerId, status: MediaStatus.DELETED } });
    return { ok: true };
  }

  async cleanupExpired() {
    const expired = await this.db.mediaAsset.findMany({
      where: { OR: [
        { status: { in: [MediaStatus.PENDING, MediaStatus.READY] }, uploadUntil: { lt: new Date() } },
        { status: { in: [MediaStatus.FAILED, MediaStatus.DELETED] } },
      ] },
      take: 100, orderBy: { updatedAt: 'asc' }, select: { id: true, objectKey: true, status: true },
    }).catch(error => {
      this.logger.warn(`Media cleanup query failed (${error instanceof Error ? error.name : 'UNKNOWN_ERROR'})`);
      return [];
    });
    for (const item of expired) {
      try {
        if (item.status !== MediaStatus.DELETED) {
          const claimed = await this.db.mediaAsset.updateMany({ where: { id: item.id, status: item.status }, data: { status: MediaStatus.DELETED } });
          if (!claimed.count) continue;
        }
        await this.storage.remove(item.objectKey);
        await this.db.mediaAsset.deleteMany({ where: { id: item.id, status: MediaStatus.DELETED } });
      } catch (error) {
        this.logger.warn(`Media cleanup deferred (${item.id}, ${error instanceof Error ? error.name : 'UNKNOWN_ERROR'})`);
      }
    }
  }

  private async rejectUpload(id: string, objectKey: string) {
    await this.db.mediaAsset.updateMany({ where: { id, status: MediaStatus.PENDING }, data: { status: MediaStatus.FAILED } });
    try { await this.storage.remove(objectKey); } catch { /* the cleanup timer retries failed assets */ }
  }
}
