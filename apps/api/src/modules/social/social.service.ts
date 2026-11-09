import { ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { MediaPurpose, MediaStatus, MediaType, NotificationType, Prisma, Visibility } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { MediaService } from '../media/media.service';
import { MessagesGateway } from './messages.gateway';

@Injectable()
export class SocialService {
  constructor(private db: PrismaService, private media: MediaService, @Optional() private gateway?: MessagesGateway) {}
  private postInclude = { author: { select: { id: true, username: true, profile: { include: { avatarMedia: true } } } }, mediaAsset: true, _count: { select: { likes: true, comments: true } }, likes: { select: { userId: true } } } satisfies Prisma.PostInclude;

  private async presentProfile<T extends { avatarMedia?: { objectKey: string; contentType: string; status: MediaStatus } | null; avatarMediaId?: string | null; avatarUrl?: string | null; visibility?: Visibility } | null>(profile: T, showPrivateAvatar = profile?.visibility !== Visibility.PRIVATE) {
    if (!profile) return profile;
    const { avatarMedia, avatarMediaId: _avatarMediaId, ...rest } = profile;
    const avatarUrl = avatarMedia && showPrivateAvatar ? await this.media.readUrl(avatarMedia) : rest.avatarUrl;
    return { ...rest, avatarUrl };
  }

  private async presentPost<T extends { mediaAsset?: { objectKey: string; contentType: string; status: MediaStatus } | null; mediaAssetId?: string | null; mediaUrl: string; author?: { profile?: any } }>(post: T) {
    const { mediaAsset, mediaAssetId: _mediaAssetId, ...rest } = post;
    const author = rest.author ? { ...rest.author, profile: await this.presentProfile(rest.author.profile, true) } : rest.author;
    return { ...rest, author, mediaUrl: mediaAsset ? await this.media.readUrl(mediaAsset) : post.mediaUrl };
  }
  private async assertPostVisible(postId: string, viewerId: string) {
    const post = await this.db.post.findUnique({ where: { id: postId }, select: { authorId: true, author: { select: { profile: { select: { visibility: true } } } } } });
    if (!post) throw new NotFoundException('Post not found.');
    if (post.authorId !== viewerId && post.author.profile?.visibility === Visibility.PRIVATE) {
      const follow = await this.db.follow.findUnique({ where: { followerId_followingId: { followerId: viewerId, followingId: post.authorId } }, select: { accepted: true } });
      if (!follow?.accepted) throw new ForbiddenException();
    }
    return post.authorId;
  }
  async feed(userId: string, cursor?: string) {
    const following = await this.db.follow.findMany({ where: { followerId: userId, accepted: true }, select: { followingId: true } });
    const ids = following.map(x => x.followingId).concat(userId);
    const items = await this.db.post.findMany({ where: { authorId: { in: ids } }, include: { ...this.postInclude, savedBy: { where: { userId }, select: { userId: true } } }, orderBy: { createdAt: 'desc' }, take: 20, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
    return { items: await Promise.all(items.map(async p => ({ ...await this.presentPost(p), liked: p.likes.some(l => l.userId === userId), saved: p.savedBy.length > 0, likes: undefined, savedBy: undefined }))), nextCursor: items.length === 20 ? items.at(-1)?.id : null };
  }
  async explore(query = '', videos = false, viewerId: string) {
    const search = query ? { OR: [{ caption: { contains: query, mode: 'insensitive' as const } }, { author: { username: { contains: query, mode: 'insensitive' as const } } }] } : {};
    const items = await this.db.post.findMany({ where: { ...search, ...(videos ? { mediaType: MediaType.VIDEO } : {}), author: { OR: [{ profile: { is: { visibility: Visibility.PUBLIC } } }, { followers: { some: { followerId: viewerId, accepted: true } } }] } }, include: { ...this.postInclude, savedBy: { where: { userId: viewerId }, select: { userId: true } } }, orderBy: [{ likes: { _count: 'desc' } }, { createdAt: 'desc' }], take: 40 });
    return Promise.all(items.map(async p => ({ ...await this.presentPost(p), liked: p.likes.some(l => l.userId === viewerId), saved: p.savedBy.length > 0, likes: undefined, savedBy: undefined })));
  }
  async searchUsers(q: string, viewer: string) {
    if (!q?.trim()) return [];
    const users = await this.db.user.findMany({ where: { id: { not: viewer }, OR: [{ username: { contains: q.trim(), mode: 'insensitive' } }, { profile: { displayName: { contains: q.trim(), mode: 'insensitive' } } }] }, select: { id: true, username: true, profile: { include: { avatarMedia: true } }, _count: { select: { followers: true } } }, take: 20 });
    return Promise.all(users.map(async user => ({ ...user, profile: await this.presentProfile(user.profile, user.profile?.visibility === Visibility.PUBLIC) })));
  }
  async createPost(authorId: string, input: { mediaId: string; caption?: string; location?: string }) {
    const existing = await this.db.post.findUnique({ where: { mediaAssetId: input.mediaId }, include: this.postInclude });
    if (existing) { if (existing.authorId !== authorId) throw new ForbiddenException(); return this.presentPost(existing); }
    const post = await this.db.$transaction(async tx => {
      const asset = await this.media.attach(tx, authorId, input.mediaId, MediaPurpose.POST, [MediaType.IMAGE, MediaType.VIDEO]);
      return tx.post.create({ data: { authorId, mediaUrl: '', mediaType: asset.mediaType, mediaAssetId: asset.id, caption: input.caption, location: input.location }, include: this.postInclude });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.presentPost(post);
  }
  async updateProfile(userId: string, input: { username?: string; displayName?: string; bio?: string; website?: string; visibility?: Visibility }) {
    const { username, ...fields } = input;
    try {
      const profile = await this.db.$transaction(async tx => {
        if (username) await tx.user.update({ where: { id: userId }, data: { username: username.toLowerCase() } });
        return tx.profile.update({ where: { userId }, data: { ...fields, ...(fields.website !== undefined ? { website: fields.website || null } : {}) }, include: { avatarMedia: true } });
      });
      return this.presentProfile(profile);
    } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Это имя пользователя уже занято.'); throw error; }
  }
  async post(postId: string, viewerId: string) {
    await this.assertPostVisible(postId, viewerId);
    const post = await this.db.post.findUniqueOrThrow({ where: { id: postId }, include: { ...this.postInclude, savedBy: { where: { userId: viewerId }, select: { userId: true } } } });
    return { ...await this.presentPost(post), liked: post.likes.some(l => l.userId === viewerId), saved: post.savedBy.length > 0, likes: undefined, savedBy: undefined };
  }
  async deletePost(userId: string, postId: string) {
    const mediaId = await this.db.$transaction(async tx => {
      const post = await tx.post.findUnique({ where: { id: postId }, select: { authorId: true, mediaAssetId: true } });
      if (!post) throw new NotFoundException('Публикация не найдена.');
      if (post.authorId !== userId) throw new ForbiddenException();
      await tx.like.deleteMany({ where: { postId } }); await tx.savedPost.deleteMany({ where: { postId } }); await tx.comment.deleteMany({ where: { postId } });
      await tx.notification.deleteMany({ where: { entityId: postId } });
      await tx.post.delete({ where: { id: postId } });
      if (post.mediaAssetId) await tx.mediaAsset.updateMany({ where: { id: post.mediaAssetId, ownerId: userId }, data: { status: 'READY', uploadUntil: new Date(0) } });
      return post.mediaAssetId;
    });
    if (mediaId) await this.media.remove(userId, mediaId).catch(() => {}); // Expired unbound assets are retried by the existing cleanup timer.
    return { ok: true };
  }
  async suggestions(viewerId: string) {
    const users = await this.db.user.findMany({ where: { id: { not: viewerId }, emailVerified: { not: null }, profile: { is: { visibility: Visibility.PUBLIC } }, followers: { none: { followerId: viewerId } } },
      select: { id: true, username: true, profile: { include: { avatarMedia: true } }, _count: { select: { posts: true, followers: { where: { accepted: true } } } } }, orderBy: { posts: { _count: 'desc' } }, take: 6 });
    return Promise.all(users.map(async user => ({ ...user, profile: await this.presentProfile(user.profile) })));
  }
  async followRequests(viewerId: string) {
    const requests = await this.db.follow.findMany({ where: { followingId: viewerId, accepted: false }, include: { follower: { select: { id: true, username: true, profile: { include: { avatarMedia: true } } } } }, orderBy: { createdAt: 'desc' }, take: 50 });
    return Promise.all(requests.map(async request => ({ ...request.follower, profile: await this.presentProfile(request.follower.profile) })));
  }
  async resolveFollowRequest(viewerId: string, followerId: string, accept: boolean) {
    if (!accept) { await this.db.follow.deleteMany({ where: { followingId: viewerId, followerId, accepted: false } }); return { accepted: false }; }
    await this.db.$transaction(async tx => {
      const changed = await tx.follow.updateMany({ where: { followingId: viewerId, followerId, accepted: false }, data: { accepted: true } });
      if (changed.count) await tx.notification.create({ data: { recipientId: followerId, actorId: viewerId, type: NotificationType.FOLLOW_REQUEST, entityId: 'accepted' } });
    });
    return { accepted: true };
  }
  async connections(username: string, viewerId: string, kind: 'followers' | 'following') {
    const target = await this.db.user.findUnique({ where: { username }, select: { id: true, profile: { select: { visibility: true } } } });
    if (!target) throw new NotFoundException();
    if (target.id !== viewerId && target.profile?.visibility === Visibility.PRIVATE && !await this.db.follow.findFirst({ where: { followingId: target.id, followerId: viewerId, accepted: true } })) throw new ForbiddenException();
    const rows = await this.db.follow.findMany({ where: { ...(kind === 'followers' ? { followingId: target.id } : { followerId: target.id }), accepted: true }, include: { follower: { select: { id: true, username: true, profile: { include: { avatarMedia: true } } } }, following: { select: { id: true, username: true, profile: { include: { avatarMedia: true } } } } }, take: 100 });
    return Promise.all(rows.map(async row => { const user = kind === 'followers' ? row.follower : row.following; return { ...user, profile: await this.presentProfile(user.profile) }; }));
  }
  async toggleSave(userId: string, postId: string) {
    await this.assertPostVisible(postId, userId);
    const existing = await this.db.savedPost.findUnique({ where: { userId_postId: { userId, postId } } });
    if (existing) await this.db.savedPost.delete({ where: { userId_postId: { userId, postId } } });
    else await this.db.savedPost.create({ data: { userId, postId } });
    return { saved: !existing };
  }
  async saved(userId: string) {
    const saved = await this.db.savedPost.findMany({ where: { userId, post: { author: { OR: [{ id: userId }, { profile: { is: { visibility: Visibility.PUBLIC } } }, { followers: { some: { followerId: userId, accepted: true } } }] } } }, include: { post: { include: this.postInclude } }, orderBy: { createdAt: 'desc' }, take: 100 });
    return Promise.all(saved.map(async item => ({ ...item, post: await this.presentPost(item.post) })));
  }
  async profile(username: string, viewer: string) {
    const user = await this.db.user.findUnique({ where: { username }, select: { id: true, username: true, profile: { include: { avatarMedia: true } }, _count: { select: { posts: true, followers: { where: { accepted: true } }, following: { where: { accepted: true } } } }, posts: { orderBy: { createdAt: 'desc' }, include: { ...this.postInclude, savedBy: { where: { userId: viewer }, select: { userId: true } } }, take: 60 } } });
    if (!user) throw new NotFoundException('Profile not found');
    const relation = await this.db.follow.findUnique({ where: { followerId_followingId: { followerId: viewer, followingId: user.id } } });
    if (user.profile?.visibility === Visibility.PRIVATE && user.id !== viewer && !relation?.accepted) return { id: user.id, username: user.username, profile: await this.presentProfile(user.profile, false), counts: user._count, posts: [], followed: false, requested: !!relation, isPrivate: true };
    return { ...user, profile: await this.presentProfile(user.profile, user.id === viewer || user.profile?.visibility !== Visibility.PRIVATE || !!relation?.accepted), counts: user._count, posts: await Promise.all(user.posts.map(async p => ({ ...await this.presentPost(p), liked: p.likes.some(l => l.userId === viewer), saved: p.savedBy.length > 0, likes: undefined, savedBy: undefined }))), followed: !!relation?.accepted, requested: !!relation && !relation.accepted };
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
    const authorId = await this.assertPostVisible(postId, userId);
    const existing = await this.db.like.findUnique({ where: { userId_postId: { userId, postId } } });
    if (existing) await this.db.like.delete({ where: { userId_postId: { userId, postId } } });
    else {
      await this.db.like.create({ data: { userId, postId } });
      if (authorId !== userId) await this.db.notification.create({ data: { recipientId: authorId, actorId: userId, type: NotificationType.LIKE, entityId: postId } });
    }
    return { liked: !existing, count: await this.db.like.count({ where: { postId } }) };
  }
  async comment(userId: string, postId: string, body: string) {
    const authorId = await this.assertPostVisible(postId, userId);
    const comment = await this.db.comment.create({ data: { userId, postId, body }, include: { user: { select: { username: true, profile: true } } } });
    if (authorId !== userId) await this.db.notification.create({ data: { recipientId: authorId, actorId: userId, type: NotificationType.COMMENT, entityId: postId } });
    return comment;
  }
  async comments(postId: string, viewerId: string) {
    await this.assertPostVisible(postId, viewerId);
    const comments = await this.db.comment.findMany({ where: { postId }, include: { user: { select: { id: true, username: true, profile: { include: { avatarMedia: true } } } } }, orderBy: { createdAt: 'asc' }, take: 100 });
    return Promise.all(comments.map(async comment => ({ ...comment, user: { ...comment.user, profile: await this.presentProfile(comment.user.profile, comment.user.profile?.visibility !== Visibility.PRIVATE || comment.user.id === viewerId) } })));
  }
  async stories(viewerId: string) {
    const stories = await this.db.story.findMany({ where: { expiresAt: { gt: new Date() }, user: { OR: [{ id: viewerId }, { profile: { is: { visibility: Visibility.PUBLIC } } }, { followers: { some: { followerId: viewerId, accepted: true } } }] } }, include: { mediaAsset: true, user: { select: { id: true, username: true, profile: { include: { avatarMedia: true } } } } }, orderBy: { createdAt: 'desc' }, take: 100 });
    return Promise.all(stories.map(async ({ mediaAsset, mediaAssetId: _mediaAssetId, ...story }) => ({ ...story, mediaType: mediaAsset?.mediaType || MediaType.IMAGE, mediaUrl: mediaAsset ? await this.media.readUrl(mediaAsset) : story.mediaUrl, user: { ...story.user, profile: await this.presentProfile(story.user.profile, true) } })));
  }
  async createStory(userId: string, mediaId: string, caption = '') {
    const story = await this.db.$transaction(async tx => {
      const asset = await this.media.attach(tx, userId, mediaId, MediaPurpose.STORY, [MediaType.IMAGE, MediaType.VIDEO]);
      return tx.story.create({ data: { userId, mediaUrl: '', mediaAssetId: asset.id, caption, expiresAt: new Date(Date.now() + 24 * 60 * 60_000) }, include: { mediaAsset: true } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { ...story, mediaAsset: undefined, mediaAssetId: undefined, mediaType: story.mediaAsset?.mediaType || MediaType.IMAGE, mediaUrl: await this.media.readUrl(story.mediaAsset!) };
  }
  async conversations(userId: string) {
    const conversations = await this.db.conversation.findMany({ where: { members: { some: { userId } } }, include: { members: { include: { user: { select: { id: true, username: true, profile: { include: { avatarMedia: true } } } } } }, messages: { orderBy: { createdAt: 'desc' }, take: 1, include: { sender: { select: { username: true } } } } }, orderBy: { createdAt: 'desc' } });
    return Promise.all(conversations.map(async conversation => ({ ...conversation, members: await Promise.all(conversation.members.map(async member => ({ ...member, user: { ...member.user, profile: await this.presentProfile(member.user.profile) } }))) })));
  }
  async startConversation(userId: string, peerId: string) {
    const existing = await this.db.conversation.findFirst({ where: { AND: [{ members: { some: { userId } } }, { members: { some: { userId: peerId } } }] } });
    if (existing) return existing;
    return this.db.conversation.create({ data: { members: { create: [{ userId }, { userId: peerId }] } } });
  }
  async messages(userId: string, conversationId: string) {
    const member = await this.db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId } } });
    if (!member) throw new ForbiddenException();
    const messages = await this.db.message.findMany({ where: { conversationId }, include: { sender: { select: { id: true, username: true, profile: { include: { avatarMedia: true } } } } }, orderBy: { createdAt: 'asc' }, take: 200 });
    return Promise.all(messages.map(async message => ({ ...message, sender: { ...message.sender, profile: await this.presentProfile(message.sender.profile) } })));
  }
  async sendMessage(userId: string, conversationId: string, body: string) {
    const member = await this.db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId } } });
    if (!member) throw new ForbiddenException();
    const message = await this.db.message.create({ data: { conversationId, senderId: userId, body }, include: { sender: { select: { username: true } } } });
    this.gateway?.server?.to(`conversation:${conversationId}`).emit('message:new', message);
    return message;
  }
  async notifications(userId: string) {
    const notifications = await this.db.notification.findMany({ where: { recipientId: userId }, include: { actor: { select: { username: true, profile: { include: { avatarMedia: true } } } } }, orderBy: { createdAt: 'desc' }, take: 50 });
    return Promise.all(notifications.map(async notification => ({ ...notification, type: notification.type === NotificationType.FOLLOW_REQUEST && notification.entityId === 'accepted' ? 'FOLLOW_APPROVED' : notification.type, actor: { ...notification.actor, profile: await this.presentProfile(notification.actor.profile) } })));
  }
  async readNotifications(userId: string) { await this.db.notification.updateMany({ where: { recipientId: userId, readAt: null }, data: { readAt: new Date() } }); return { ok: true }; }
  async readConversation(userId: string, conversationId: string) { const changed = await this.db.conversationMember.updateMany({ where: { userId, conversationId }, data: { lastReadAt: new Date() } }); if (!changed.count) throw new ForbiddenException(); return { ok: true }; }
}
