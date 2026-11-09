import { describe, expect, it, vi } from 'vitest';
import { SocialService } from '../src/modules/social/social.service';

function makeService() {
  const db = {
    post: { findUnique: vi.fn() },
    like: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn(), count: vi.fn() },
    savedPost: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
    notification: { create: vi.fn() },
    user: { findUnique: vi.fn() },
    follow: { upsert: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn() },
  };
  const media = { readUrl: vi.fn().mockResolvedValue('https://signed.example/media'), attach: vi.fn() };
  return { service: new SocialService(db as never, media as never), db, media };
}

describe('SocialService', () => {
  it('creates a like and notifies the post author', async () => {
    const { service, db } = makeService();
    db.post.findUnique.mockResolvedValue({ id: 'post-1', authorId: 'author-1', author: { profile: { visibility: 'PUBLIC' } } });
    db.like.findUnique.mockResolvedValue(null);
    db.like.count.mockResolvedValue(1);

    await expect(service.toggleLike('reader-1', 'post-1')).resolves.toEqual({ liked: true, count: 1 });
    expect(db.like.create).toHaveBeenCalledWith({ data: { userId: 'reader-1', postId: 'post-1' } });
    expect(db.notification.create).toHaveBeenCalledWith({ data: { recipientId: 'author-1', actorId: 'reader-1', type: 'LIKE', entityId: 'post-1' } });
  });

  it('removes an existing like without creating another notification', async () => {
    const { service, db } = makeService();
    db.post.findUnique.mockResolvedValue({ id: 'post-1', authorId: 'author-1', author: { profile: { visibility: 'PUBLIC' } } });
    db.like.findUnique.mockResolvedValue({ userId: 'reader-1', postId: 'post-1' });
    db.like.count.mockResolvedValue(0);

    await expect(service.toggleLike('reader-1', 'post-1')).resolves.toEqual({ liked: false, count: 0 });
    expect(db.like.delete).toHaveBeenCalledWith({ where: { userId_postId: { userId: 'reader-1', postId: 'post-1' } } });
    expect(db.notification.create).not.toHaveBeenCalled();
  });

  it('creates a pending follow request for a private profile', async () => {
    const { service, db } = makeService();
    db.user.findUnique.mockResolvedValue({ id: 'private-user', profile: { visibility: 'PRIVATE' } });
    db.follow.upsert.mockResolvedValue({ followerId: 'reader-1', followingId: 'private-user', accepted: false });

    await expect(service.follow('reader-1', 'private-user')).resolves.toEqual({ following: false, requested: true });
    expect(db.follow.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { followerId: 'reader-1', followingId: 'private-user', accepted: false } }));
  });

  it('rejects self-follows', async () => {
    const { service } = makeService();
    await expect(service.follow('same-user', 'same-user')).rejects.toThrow('You cannot follow yourself');
  });
});
