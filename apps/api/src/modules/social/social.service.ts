import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MediaType, NotificationType, Prisma, Visibility } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class SocialService {
  constructor(private db: PrismaService) {}
  private postInclude = { author: { select: { id: true, username: true, profile: true } }, _count: { select: { likes: true, comments: true } }, likes: { select: { userId: true } } } satisfies Prisma.PostInclude;
  async feed(userId: string, cursor?: string) {
    const following = await this.db.follow.findMany({ where: { followerId: userId, accepted: true }, select: { followingId: true } });
    const ids = following.map(x => x.followingId).concat(userId);
    const items = await this.db.post.findMany({ where: { authorId: { in: ids } }, include: { ...this.postInclude, savedBy: { where: { userId }, select: { userId: true } } }, orderBy: { createdAt: 'desc' }, take: 20, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
    return { items: items.map(p => ({ ...p, liked: p.likes.some(l => l.userId === userId), saved: p.savedBy.length > 0, likes: undefined, savedBy: undefined })), nextCursor: items.length === 20 ? items.at(-1)?.id : null };
  }
  async explore(query = '', videos = false, viewerId: string) {
    const search = query ? { OR: [{ caption: { contains: query, mode: 'insensitive' as const } }, { author: { username: { contains: query, mode: 'insensitive' as const } } }] } : {};
    const items = await this.db.post.findMany({ where: { ...search, ...(videos ? { mediaType: MediaType.VIDEO } : {}), author: { OR: [{ profile: { is: { visibility: Visibility.PUBLIC } } }, { followers: { some: { followerId: viewerId, accepted: true } } }] } }, include: { ...this.postInclude, savedBy: { where: { userId: viewerId }, select: { userId: true } } }, orderBy: [{ likes: { _count: 'desc' } }, { createdAt: 'desc' }], take: 40 });
    return items.map(p => ({ ...p, liked: p.likes.some(l => l.userId === viewerId), saved: p.savedBy.length > 0, likes: undefined, savedBy: undefined }));
  }
  async searchUsers(q: string, viewer: string) {
    if (!q?.trim()) return [];
    return this.db.user.findMany({ where: { id: { not: viewer }, OR: [{ username: { contains: q.trim(), mode: 'insensitive' } }, { profile: { displayName: { contains: q.trim(), mode: 'insensitive' } } }] }, select: { id: true, username: true, profile: true, _count: { select: { followers: true } } }, take: 20 });
  }
  async createPost(authorId: string, input: { mediaUrl: string; mediaType?: MediaType; caption?: string; location?: string }) {
    return this.db.post.create({ data: { authorId, mediaUrl: input.mediaUrl, mediaType: input.mediaType, caption: input.caption, location: input.location }, include: this.postInclude });
  }
  async updateProfile(userId: string, input: { displayName?: string; bio?: string; website?: string; visibility?: Visibility; avatarUrl?: string }) {
    return this.db.profile.update({ where: { userId }, data: { ...input, ...(input.website !== undefined ? { website: input.website || null } : {}) } });
  }
  async toggleSave(userId: string, postId: string) {
    const existing = await this.db.savedPost.findUnique({ where: { userId_postId: { userId, postId } } });
    if (existing) await this.db.savedPost.delete({ where: { userId_postId: { userId, postId } } });
    else await this.db.savedPost.create({ data: { userId, postId } });
    return { saved: !existing };
  }
  async saved(userId: string) {
    return this.db.savedPost.findMany({ where: { userId }, include: { post: { include: this.postInclude } }, orderBy: { createdAt: 'desc' }, take: 100 });
  }
  async profile(username: string, viewer: string) {
    const user = await this.db.user.findUnique({ where: { username }, select: { id: true, username: true, profile: true, _count: { select: { posts: true, followers: true, following: true } }, posts: { orderBy: { createdAt: 'desc' }, include: { ...this.postInclude, savedBy: { where: { userId: viewer }, select: { userId: true } } }, take: 60 } } });
    if (!user) throw new NotFoundException('Profile not found');
    const relation = await this.db.follow.findUnique({ where: { followerId_followingId: { followerId: viewer, followingId: user.id } } });
    if (user.profile?.visibility === Visibility.PRIVATE && user.id !== viewer && !relation?.accepted) return { id: user.id, username: user.username, profile: user.profile, counts: user._count, posts: [], followed: !!relation, requested: !!relation };
    return { ...user, counts: user._count, posts: user.posts.map(p => ({ ...p, liked: p.likes.some(l => l.userId === viewer), saved: p.savedBy.length > 0, likes: undefined, savedBy: undefined })), followed: !!relation?.accepted, requested: !!relation && !relation.accepted };
  }
  async follow(followerId: string, followingId: string) {
    if (followerId === followingId) throw new ForbiddenException('You cannot follow yourself');
    const target = await this.db.user.findUnique({ where: { id: followingId }, select: { id: true, profile: true } });
    if (!target) throw new NotFoundException();
    const accepted = target.profile?.visibility !== Visibility.PRIVATE;
    const relation = await this.db.follow.upsert({ where: { followerId_followingId: { followerId, followingId } }, create: { followerId, followingId, accepted }, update: { accepted } });
    await this.db.notification.create({ data: { recipientId: followingId, actorId: followerId, type: accepted ? NotificationType.FOLLOW : NotificationType.FOLLOW_REQUEST } });
    return { following: accepted, requested: !accepted };
  }
  async unfollow(followerId: string, followingId: string) { await this.db.follow.deleteMany({ where: { followerId, followingId } }); return { following: false }; }
  async toggleLike(userId: string, postId: string) {
    const post = await this.db.post.findUnique({ where: { id: postId }, select: { id: true, authorId: true } });
    if (!post) throw new NotFoundException('Post not found');
    const existing = await this.db.like.findUnique({ where: { userId_postId: { userId, postId } } });
    if (existing) await this.db.like.delete({ where: { userId_postId: { userId, postId } } });
    else {
      await this.db.like.create({ data: { userId, postId } });
      if (post.authorId !== userId) await this.db.notification.create({ data: { recipientId: post.authorId, actorId: userId, type: NotificationType.LIKE, entityId: postId } });
    }
    return { liked: !existing, count: await this.db.like.count({ where: { postId } }) };
  }
  async comment(userId: string, postId: string, body: string) {
    const post = await this.db.post.findUnique({ where: { id: postId }, select: { authorId: true } });
    if (!post) throw new NotFoundException('Post not found');
    const comment = await this.db.comment.create({ data: { userId, postId, body }, include: { user: { select: { username: true, profile: true } } } });
    if (post.authorId !== userId) await this.db.notification.create({ data: { recipientId: post.authorId, actorId: userId, type: NotificationType.COMMENT, entityId: postId } });
    return comment;
  }
  async comments(postId: string) { return this.db.comment.findMany({ where: { postId }, include: { user: { select: { id: true, username: true, profile: true } } }, orderBy: { createdAt: 'asc' }, take: 100 }); }
  async stories(viewerId: string) { return this.db.story.findMany({ where: { expiresAt: { gt: new Date() }, user: { OR: [{ id: viewerId }, { profile: { is: { visibility: Visibility.PUBLIC } } }, { followers: { some: { followerId: viewerId, accepted: true } } }] } }, include: { user: { select: { id: true, username: true, profile: true } } }, orderBy: { createdAt: 'desc' }, take: 100 }); }
  async createStory(userId: string, mediaUrl: string, caption = '') { return this.db.story.create({ data: { userId, mediaUrl, caption, expiresAt: new Date(Date.now() + 24 * 60 * 60_000) } }); }
  async conversations(userId: string) { return this.db.conversation.findMany({ where: { members: { some: { userId } } }, include: { members: { include: { user: { select: { id: true, username: true, profile: true } } } }, messages: { orderBy: { createdAt: 'desc' }, take: 1, include: { sender: { select: { username: true } } } } }, orderBy: { createdAt: 'desc' } }); }
  async startConversation(userId: string, peerId: string) {
    const existing = await this.db.conversation.findFirst({ where: { AND: [{ members: { some: { userId } } }, { members: { some: { userId: peerId } } }] } });
    if (existing) return existing;
    return this.db.conversation.create({ data: { members: { create: [{ userId }, { userId: peerId }] } } });
  }
  async messages(userId: string, conversationId: string) {
    const member = await this.db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId } } });
    if (!member) throw new ForbiddenException();
    return this.db.message.findMany({ where: { conversationId }, include: { sender: { select: { id: true, username: true, profile: true } } }, orderBy: { createdAt: 'asc' }, take: 200 });
  }
  async sendMessage(userId: string, conversationId: string, body: string) {
    const member = await this.db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId } } });
    if (!member) throw new ForbiddenException();
    return this.db.message.create({ data: { conversationId, senderId: userId, body }, include: { sender: { select: { username: true } } } });
  }
  async notifications(userId: string) { return this.db.notification.findMany({ where: { recipientId: userId }, include: { actor: { select: { username: true, profile: true } } }, orderBy: { createdAt: 'desc' }, take: 50 }); }
}
