import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EmailOutboxKind, Prisma, VerificationPurpose } from '@prisma/client';
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../database/prisma.service';
import { encryptEmailPayload } from '../mail/mail-crypto';
import { LoginDto, RegisterDto, VerifyDto } from './dto';
import { decryptRefreshToken, encryptRefreshToken } from './session-crypto';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const CODE_TTL_MS = 10 * 60_000;
const RESEND_COOLDOWN_MS = 60_000;
const REFRESH_RACE_GRACE_MS = 15_000;

@Injectable()
export class AuthService {
  constructor(private db: PrismaService, private jwt: JwtService) {}

  createCsrfToken() {
    const nonce = randomBytes(32).toString('base64url');
    const signature = createHmac('sha256', `${process.env.JWT_ACCESS_SECRET}:csrf`).update(nonce).digest('base64url');
    return `${nonce}.${signature}`;
  }

  verifyCsrfToken(token: string) {
    const [nonce, signature] = token.split('.');
    if (!nonce || !signature) return false;
    const expected = createHmac('sha256', `${process.env.JWT_ACCESS_SECRET}:csrf`).update(nonce).digest();
    const supplied = Buffer.from(signature, 'base64url');
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }

  private verificationHash(code: string) {
    const pepper = process.env.EMAIL_CODE_PEPPER;
    if (!pepper || Buffer.byteLength(pepper) < 32) throw new Error('EMAIL_CODE_PEPPER must be at least 32 bytes');
    return createHmac('sha256', pepper).update(code).digest('hex');
  }

  async register(input: RegisterDto) {
    const email = input.email.trim().toLowerCase();
    const username = input.username.trim().toLowerCase();
    try {
      await this.db.$transaction(async tx => {
        const user = await tx.user.create({ data: { email, username, passwordHash: await bcrypt.hash(input.password, 12), profile: { create: {} } }, select: { id: true, email: true } });
        await this.createVerification(tx, user.id, user.email, VerificationPurpose.VERIFY);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Email or username is already in use');
      throw error;
    }
    return { message: 'Check your email for the verification code' };
  }

  async login(input: LoginDto) {
    const user = await this.db.user.findUnique({ where: { email: input.email.trim().toLowerCase() } });
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) throw new UnauthorizedException('Invalid email or password');
    if (!user.emailVerified) throw new UnauthorizedException('Verify your email before signing in');
    return this.createSession(user.id, user.email);
  }

  async userIdForEmail(email: string) {
    const user = await this.db.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true } });
    return user?.id;
  }

  async refreshSubject(refreshToken: string) {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; type?: string }>(refreshToken, { secret: process.env.JWT_REFRESH_SECRET });
      if (payload.type !== 'refresh') throw new Error('Wrong token type');
      return payload.sub;
    } catch { throw new UnauthorizedException('Session expired'); }
  }

  async verify(input: VerifyDto) {
    const user = await this.db.user.findUnique({ where: { email: input.email.trim().toLowerCase() } });
    if (!user) throw new BadRequestException('Invalid or expired code');
    const verified = await this.db.$transaction(async tx => {
      if (!await this.consumeVerificationWithClient(tx, user.id, input.code, VerificationPurpose.VERIFY)) return false;
      await tx.user.update({ where: { id: user.id }, data: { emailVerified: new Date() } });
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (!verified) throw new BadRequestException('Invalid or expired code');
    return this.createSession(user.id, user.email);
  }

  async resend(emailInput: string) {
    const email = emailInput.trim().toLowerCase();
    const user = await this.db.user.findUnique({ where: { email } });
    if (user && !user.emailVerified) await this.db.$transaction(tx => this.createVerification(tx, user.id, user.email, VerificationPurpose.VERIFY), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { message: 'If the account can receive a code, one has been sent' };
  }

  async requestPasswordReset(emailInput: string) {
    const user = await this.db.user.findUnique({ where: { email: emailInput.trim().toLowerCase() }, select: { id: true, email: true, emailVerified: true } });
    if (user?.emailVerified) await this.db.$transaction(tx => this.createVerification(tx, user.id, user.email, VerificationPurpose.RESET_PASSWORD), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { message: 'If the account can receive a code, one has been sent' };
  }

  async resetPassword(input: VerifyDto & { password: string }) {
    const user = await this.db.user.findUnique({ where: { email: input.email.trim().toLowerCase() }, select: { id: true } });
    if (!user) throw new BadRequestException('Invalid or expired code');
    const passwordHash = await bcrypt.hash(input.password, 12);
    const changed = await this.db.$transaction(async tx => {
      const consumed = await this.consumeVerificationWithClient(tx, user.id, input.code, VerificationPurpose.RESET_PASSWORD);
      if (!consumed) return false;
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.session.deleteMany({ where: { userId: user.id } });
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (!changed) throw new BadRequestException('Invalid or expired code');
    return { message: 'Password updated. Sign in with your new password.' };
  }

  private async createVerification(tx: Prisma.TransactionClient, userId: string, email: string, purpose: VerificationPurpose) {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`);
    const latest = await tx.verificationCode.findFirst({ where: { userId, purpose, invalidatedAt: null }, orderBy: { createdAt: 'desc' } });
    if (latest && Date.now() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) return false;
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await tx.verificationCode.updateMany({ where: { userId, purpose, invalidatedAt: null }, data: { invalidatedAt: new Date() } });
    await tx.verificationCode.create({ data: { userId, purpose, codeHash: this.verificationHash(code), expiresAt: new Date(Date.now() + CODE_TTL_MS) } });
    const outboxId = randomUUID();
    const encrypted = encryptEmailPayload({ to: email, code });
    await tx.emailOutbox.create({ data: {
      id: outboxId, userId, kind: purpose === VerificationPurpose.VERIFY ? EmailOutboxKind.VERIFY_EMAIL : EmailOutboxKind.RESET_PASSWORD,
      jobId: outboxId, payloadCiphertext: encrypted.ciphertext, payloadIv: encrypted.iv, payloadTag: encrypted.tag,
    } });
    return true;
  }

  private async consumeVerificationWithClient(tx: Prisma.TransactionClient, userId: string, value: string, purpose: VerificationPurpose) {
    const code = await tx.verificationCode.findFirst({ where: { userId, purpose, invalidatedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
    if (!code || code.attempts >= 5) return false;
    const expected = Buffer.from(code.codeHash, 'hex');
    const actual = Buffer.from(this.verificationHash(value), 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      await tx.verificationCode.updateMany({ where: { id: code.id, invalidatedAt: null, attempts: { lt: 5 }, expiresAt: { gt: new Date() } }, data: { attempts: { increment: 1 }, ...(code.attempts >= 4 ? { invalidatedAt: new Date() } : {}) } });
      return false;
    }
    const result = await tx.verificationCode.updateMany({ where: { id: code.id, codeHash: code.codeHash, invalidatedAt: null, attempts: { lt: 5 }, expiresAt: { gt: new Date() } }, data: { invalidatedAt: new Date() } });
    return result.count === 1;
  }

  private async signAccess(userId: string, email: string) {
    return this.jwt.signAsync({ sub: userId, email }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: process.env.ACCESS_TOKEN_TTL ?? '15m' });
  }

  async createSession(userId: string, email: string) {
    const sessionId = randomUUID();
    const ttlDays = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30);
    const refreshToken = await this.jwt.signAsync({ sub: userId, sid: sessionId, type: 'refresh' }, { secret: process.env.JWT_REFRESH_SECRET, expiresIn: `${ttlDays}d` });
    const encrypted = encryptRefreshToken(refreshToken);
    await this.db.session.create({ data: {
      id: sessionId, userId, refreshTokenHash: hash(refreshToken), refreshTokenCiphertext: encrypted.ciphertext, refreshTokenIv: encrypted.iv, refreshTokenTag: encrypted.tag,
      expiresAt: new Date(Date.now() + ttlDays * 86_400_000),
    } });
    return { accessToken: await this.signAccess(userId, email), refreshToken };
  }

  async refresh(refreshToken: string) {
    let payload: { sub: string; sid?: string; type?: string };
    try { payload = await this.jwt.verifyAsync(refreshToken, { secret: process.env.JWT_REFRESH_SECRET }); }
    catch { throw new UnauthorizedException('Session expired'); }
    if (payload.type !== 'refresh') throw new UnauthorizedException('Invalid refresh token');
    const tokenHash = hash(refreshToken);
    const session = payload.sid
      ? await this.db.session.findUnique({ where: { id: payload.sid } })
      : await this.db.session.findFirst({ where: { userId: payload.sub, refreshTokenHash: tokenHash } });
    if (!session || session.userId !== payload.sub || session.expiresAt <= new Date()) throw new UnauthorizedException('Session expired');

    if (session.refreshTokenHash !== tokenHash) {
      if (session.previousRefreshTokenHash === tokenHash && session.rotatedAt && Date.now() - session.rotatedAt.getTime() <= REFRESH_RACE_GRACE_MS && session.refreshTokenCiphertext && session.refreshTokenIv && session.refreshTokenTag) {
        const user = await this.db.user.findUniqueOrThrow({ where: { id: session.userId }, select: { id: true, email: true } });
        return { accessToken: await this.signAccess(user.id, user.email), refreshToken: decryptRefreshToken({ ciphertext: session.refreshTokenCiphertext, iv: session.refreshTokenIv, tag: session.refreshTokenTag }) };
      }
      await this.db.session.deleteMany({ where: { userId: payload.sub } });
      throw new UnauthorizedException('Refresh token reuse detected; sign in again');
    }

    const ttlDays = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30);
    const rotated = await this.jwt.signAsync({ sub: payload.sub, sid: session.id, type: 'refresh' }, { secret: process.env.JWT_REFRESH_SECRET, expiresIn: `${ttlDays}d` });
    const encrypted = encryptRefreshToken(rotated);
    const updated = await this.db.session.updateMany({
      where: { id: session.id, refreshTokenHash: tokenHash, expiresAt: { gt: new Date() } },
      data: {
        previousRefreshTokenHash: tokenHash, refreshTokenHash: hash(rotated), refreshTokenCiphertext: encrypted.ciphertext,
        refreshTokenIv: encrypted.iv, refreshTokenTag: encrypted.tag, rotatedAt: new Date(), expiresAt: new Date(Date.now() + ttlDays * 86_400_000),
      },
    });
    if (updated.count !== 1) {
      const latest = await this.db.session.findUnique({ where: { id: session.id } });
      if (latest?.previousRefreshTokenHash === tokenHash && latest.rotatedAt && Date.now() - latest.rotatedAt.getTime() <= REFRESH_RACE_GRACE_MS && latest.refreshTokenCiphertext && latest.refreshTokenIv && latest.refreshTokenTag) {
        const user = await this.db.user.findUniqueOrThrow({ where: { id: latest.userId }, select: { id: true, email: true } });
        return { accessToken: await this.signAccess(user.id, user.email), refreshToken: decryptRefreshToken({ ciphertext: latest.refreshTokenCiphertext, iv: latest.refreshTokenIv, tag: latest.refreshTokenTag }) };
      }
      throw new UnauthorizedException('Session expired');
    }
    const user = await this.db.user.findUniqueOrThrow({ where: { id: payload.sub }, select: { id: true, email: true } });
    return { accessToken: await this.signAccess(user.id, user.email), refreshToken: rotated };
  }

  async me(userId: string) { return this.db.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true, username: true, emailVerified: true, profile: { include: { avatarMedia: true } } } }); }
  async logout(token: string) { const tokenHash = hash(token); await this.db.session.deleteMany({ where: { OR: [{ refreshTokenHash: tokenHash }, { previousRefreshTokenHash: tokenHash }] } }); return { ok: true }; }
  async logoutAll(userId: string) { await this.db.session.deleteMany({ where: { userId } }); return { ok: true }; }
}
