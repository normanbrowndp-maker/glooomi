import { BadRequestException, ConflictException } from '@nestjs/common';
import { MediaPurpose, MediaStatus, MediaType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaService } from '../src/modules/media/media.service';
import { matchesMediaSignature } from '../src/modules/media/storage';

describe('private media upload validation', () => {
  it('accepts supported image signatures and rejects spoofed MIME headers', () => {
    expect(matchesMediaSignature('image/png', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(matchesMediaSignature('image/png', Buffer.from('<script>alert(1)</script>'))).toBe(false);
    expect(matchesMediaSignature('image/svg+xml', Buffer.from('<svg/>'))).toBe(false);
  });

  describe('MediaService', () => {
    let service: MediaService;
    let db: any;
    let storage: any;

    beforeEach(() => {
      db = {
        mediaAsset: {
          create: vi.fn().mockResolvedValue({ id: 'media-1', objectKey: 'private-media/random', mediaType: MediaType.IMAGE, purpose: MediaPurpose.POST, contentType: 'image/png', sizeBytes: 8, status: MediaStatus.PENDING, uploadUntil: new Date(Date.now() + 60_000) }),
          findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }), deleteMany: vi.fn(), findMany: vi.fn(),
        },
        $transaction: vi.fn(async (callback: (tx: any) => unknown) => callback({
          mediaAsset: { findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'media-1', mediaType: MediaType.IMAGE }) },
          profile: { findUniqueOrThrow: vi.fn().mockResolvedValue({ avatarMediaId: null }), update: vi.fn() },
        })),
      };
      storage = {
        createUpload: vi.fn().mockResolvedValue({ url: 'https://s3.invalid', fields: { key: 'private-media/random' } }),
        inspect: vi.fn().mockResolvedValue({ size: 8, contentType: 'image/png', prefix: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }),
        readUrl: vi.fn().mockResolvedValue('https://signed.invalid'), remove: vi.fn(),
      };
      service = new MediaService(db, storage);
    });

    it('rejects unsupported types, oversized uploads, and video avatars before storage access', async () => {
      await expect(service.createUpload('owner-1', 'image/svg+xml', 100, 'POST')).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.createUpload('owner-1', 'image/png', 10 * 1024 * 1024 + 1, 'POST')).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.createUpload('owner-1', 'video/mp4', 100, 'AVATAR')).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.createUpload).not.toHaveBeenCalled();
    });

    it('creates a server-keyed pending asset and signs a bounded upload', async () => {
      await service.createUpload('owner-1', 'image/png', 8, 'POST');
      expect(db.mediaAsset.create.mock.calls[0][0].data).toMatchObject({ ownerId: 'owner-1', objectKey: expect.stringMatching(/^private-media\//), purpose: MediaPurpose.POST });
      expect(storage.createUpload).toHaveBeenCalledWith(expect.stringMatching(/^private-media\//), 'image/png', 10 * 1024 * 1024);
    });
    it('authenticates the owner and pending state before receiving local bytes', async () => {
      storage.write = vi.fn();
      db.mediaAsset.findFirst.mockResolvedValue(null);
      await expect(service.acceptLocalUpload('other-user', 'media-1', {} as any, 'image/png', '8')).rejects.toMatchObject({ status: 404 });
      expect(storage.write).not.toHaveBeenCalled();
      db.mediaAsset.findFirst.mockResolvedValue({ objectKey: 'private-media/key', contentType: 'image/png', sizeBytes: 8, status: MediaStatus.ATTACHED, uploadUntil: new Date(Date.now() + 60000) });
      await expect(service.acceptLocalUpload('owner', 'media-1', {} as any, 'image/png', '8')).rejects.toMatchObject({ status: 400 });
      expect(storage.write).not.toHaveBeenCalled();
    });

    it('finalizes only a matching object signature and exact size', async () => {
      db.mediaAsset.findFirst.mockResolvedValue({ id: 'media-1', ownerId: 'owner-1', objectKey: 'private-media/key', mediaType: MediaType.IMAGE, contentType: 'image/png', sizeBytes: 8, status: MediaStatus.PENDING, uploadUntil: new Date(Date.now() + 60_000) });
      await expect(service.finalize('owner-1', 'media-1')).resolves.toMatchObject({ status: MediaStatus.READY });
      expect(db.mediaAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: MediaStatus.READY } }));
    });

    it('rejects mismatched file bytes and schedules deletion', async () => {
      db.mediaAsset.findFirst.mockResolvedValue({ id: 'media-1', ownerId: 'owner-1', objectKey: 'private-media/key', mediaType: MediaType.IMAGE, contentType: 'image/png', sizeBytes: 8, status: MediaStatus.PENDING, uploadUntil: new Date(Date.now() + 60_000) });
      storage.inspect.mockResolvedValue({ size: 8, contentType: 'image/png', prefix: Buffer.from('<script>') });
      await expect(service.finalize('owner-1', 'media-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(db.mediaAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: MediaStatus.FAILED } }));
      expect(storage.remove).toHaveBeenCalledWith('private-media/key');
    });

    it('does not reveal or delete assets belonging to another account', async () => {
      db.mediaAsset.findFirst.mockResolvedValue(null);
      await expect(service.finalize('attacker', 'media-1')).rejects.toThrow('Upload not found.');
      await expect(service.remove('attacker', 'media-1')).rejects.toThrow('Media not found.');
      expect(storage.inspect).not.toHaveBeenCalled();
      expect(storage.remove).not.toHaveBeenCalled();
    });

    it('refuses to delete an attached media asset', async () => {
      db.$transaction.mockImplementationOnce(async callback => callback({ mediaAsset: { findFirst: vi.fn().mockResolvedValue({ status: MediaStatus.ATTACHED }), updateMany: vi.fn() } }));
      await expect(service.remove('owner-1', 'media-1')).rejects.toBeInstanceOf(ConflictException);
      expect(storage.remove).not.toHaveBeenCalled();
    });

    it('refuses cross-owner media attachment in the business transaction', async () => {
      db.$transaction.mockImplementationOnce(async callback => callback({ mediaAsset: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } }));
      await expect(service.attach({ mediaAsset: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } } as never, 'attacker', 'media-1', MediaPurpose.POST, [MediaType.IMAGE])).rejects.toBeInstanceOf(BadRequestException);
    });

    it('reclaims expired READY assets that were never attached', async () => {
      db.mediaAsset.findMany.mockResolvedValue([]);
      await service.cleanupExpired();
      const where = db.mediaAsset.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual(expect.arrayContaining([
        expect.objectContaining({ status: { in: [MediaStatus.PENDING, MediaStatus.READY] }, uploadUntil: expect.objectContaining({ lt: expect.any(Date) }) }),
      ]));
    });
  });
});
