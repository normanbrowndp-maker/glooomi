import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EmailOutboxKind, Prisma, VerificationPurpose } from '@prisma/client';
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../database/prisma.service';
import { encryptEmailPayload } from '../mail/mail-crypto';
import { LoginDto, RegisterDto, VerifyDto } from './dto';
import { decryptRefreshToken, encryptRefreshToken } from './session-crypto';
import { MailService } from '../mail/mail.service';
import { emailDeliveryMode } from '../mail/email-delivery-mode';

type VerificationDelivery = { mode: 'queue'; expiresAt: Date } | { mode: 'direct'; email: string; code: string; messageId: string; purpose: VerificationPurpose; expiresAt: Date };

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const CODE_TTL_MS = 10 * 60_000;
const RESEND_COOLDOWN_MS = 60_000;
const REFRESH_RACE_GRACE_MS = 15_000;
const verificationNextStep = () => ({ verificationRequired: true, delivery: 'not_requested', message: 'Продолжите подтверждение электронной почты или войдите в аккаунт.' });
const resendMessage = 'Запрос принят. Если этот адрес ожидает подтверждения, проверьте почту и папку «Спам». Приём запроса не гарантирует доставку письма.';
const invalidVerificationCode = () => new BadRequestException({ code: 'INVALID_VERIFICATION_CODE', message: 'Код неверен или срок его действия истёк. Используйте последний код подтверждения почты или запросите новый. Код восстановления пароля здесь не подходит.' });

@Injectable()
export class AuthService {
  constructor(private db: PrismaService, private jwt: JwtService, private mail: MailService) {}

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
    const existing = await this.db.user.findUnique({ where: { email }, select: { emailVerified: true } });
    if (existing) return verificationNextStep();
    try {
      await this.db.$transaction(async tx => {
        await tx.user.create({ data: { email, username, passwordHash: await bcrypt.hash(input.password, 12), profile: { create: {} } }, select: { id: true } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        if (await this.db.user.findUnique({ where: { email }, select: { id: true } })) return verificationNextStep();
        throw new ConflictException('Не удалось завершить регистрацию. Проверьте данные или перейдите ко входу.');
      }
      throw error;
    }
    return verificationNextStep();
  }

  async login(input: LoginDto) {
    const user = await this.db.user.findUnique({ where: { email: input.email.trim().toLowerCase() } });
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) throw new UnauthorizedException('Invalid email or password');
    if (!user.emailVerified) throw new UnauthorizedException({ code: 'EMAIL_VERIFICATION_REQUIRED', verificationRequired: true, message: 'Подтвердите email: введите код из письма или запросите новый.' });
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
    if (!user || user.emailVerified) throw invalidVerificationCode();
    const verified = await this.db.$transaction(async tx => {
      if (!await this.consumeVerificationWithClient(tx, user.id, input.code, VerificationPurpose.VERIFY)) return false;
      await tx.user.update({ where: { id: user.id }, data: { emailVerified: new Date() } });
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (!verified) throw invalidVerificationCode();
    return this.createSession(user.id, user.email);
  }

  async resend(emailInput: string) {
    const email = emailInput.trim().toLowerCase();
    const user = await this.db.user.findUnique({ where: { email } });
    let expiresAt = new Date(Date.now() + CODE_TTL_MS);
    if (user && !user.emailVerified) {
      const delivery = await this.db.$transaction(tx => this.createVerification(tx, user.id, user.email, VerificationPurpose.VERIFY), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      await this.deliverVerification(delivery);
      expiresAt = delivery.expiresAt;
    }
    // Same response shape for unknown, verified and unverified addresses.
    return { message: resendMessage, retryAfterSeconds: RESEND_COOLDOWN_MS / 1000, expiresAt };
  }

  async requestPasswordReset(emailInput: string) {
    const user = await this.db.user.findUnique({ where: { email: emailInput.trim().toLowerCase() }, select: { id: true, email: true, emailVerified: true } });
    if (user?.emailVerified) {
      const delivery = await this.db.$transaction(tx => this.createVerification(tx, user.id, user.email, VerificationPurpose.RESET_PASSWORD), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      await this.deliverVerification(delivery);
    }
    return { message: 'Запрос обработан. Если аккаунт может получить код, проверьте почту и папку «Спам».' };
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

  private async createVerification(tx: Prisma.TransactionClient, userId: string, email: string, purpose: VerificationPurpose): Promise<VerificationDelivery> {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`);
    const latest = await tx.verificationCode.findFirst({ where: { userId, purpose }, orderBy: { createdAt: 'desc' } });
    if (latest && Date.now() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      throw new HttpException({ code: 'EMAIL_CODE_COOLDOWN', retryAfterSeconds: Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - latest.createdAt.getTime())) / 1000), message: 'Подождите минуту перед повторной отправкой кода.' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await tx.verificationCode.updateMany({ where: { userId, purpose, invalidatedAt: null }, data: { invalidatedAt: new Date() } });
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    await tx.verificationCode.create({ data: { userId, purpose, codeHash: this.verificationHash(code), expiresAt } });
    const outboxId = randomUUID();
    if (emailDeliveryMode() === 'direct') return { mode: 'direct', email, code, messageId: outboxId, purpose, expiresAt };
    const encrypted = encryptEmailPayload({ to: email, code });
    await tx.emailOutbox.create({ data: {
      id: outboxId, userId, kind: purpose === VerificationPurpose.VERIFY ? EmailOutboxKind.VERIFY_EMAIL : EmailOutboxKind.RESET_PASSWORD,
      jobId: outboxId, payloadCiphertext: encrypted.ciphertext, payloadIv: encrypted.iv, payloadTag: encrypted.tag,
    } });
    return { mode: 'queue', expiresAt };
  }

  private async deliverVerification(delivery: VerificationDelivery) {
    if (delivery.mode === 'queue') return { delivery: 'queued', message: 'Запрос письма поставлен в очередь. Для отправки должны работать Redis и email worker.' };
    try {
      await this.mail.send(delivery.purpose === VerificationPurpose.VERIFY ? EmailOutboxKind.VERIFY_EMAIL : EmailOutboxKind.RESET_PASSWORD,
        { to: delivery.email, code: delivery.code }, delivery.messageId);
    } catch {
      // Keep the account and code: a network timeout may happen after SMTP accepts
      // the message. A retry after cooldown supersedes it without a duplicate user.
      throw new ServiceUnavailableException({ code: 'EMAIL_DELIVERY_FAILED', verificationRequired: delivery.purpose === VerificationPurpose.VERIFY,
        retryAfterSeconds: 60, message: 'Не удалось подтвердить приём письма сервером SMTP. Повторите запрос после указанной паузы. Если письмо всё же придёт, используйте код из него.' });
    }
    return { delivery: 'accepted', retryAfterSeconds: 60, message: 'SMTP принял письмо. Проверьте почту и папку «Спам»: приём сервером не гарантирует доставку во «Входящие».' };
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
