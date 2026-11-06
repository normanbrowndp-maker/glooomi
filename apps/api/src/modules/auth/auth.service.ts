import { ConflictException, Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomInt } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../database/prisma.service';
import { MailService } from '../mail/mail.service';
import { LoginDto, RegisterDto, VerifyDto } from './dto';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
@Injectable()
export class AuthService {
  constructor(private db: PrismaService, private jwt: JwtService, private mail: MailService) {}
  async register(input: RegisterDto) {
    const email = input.email.toLowerCase();
    if (await this.db.user.findFirst({ where: { OR: [{ email }, { username: input.username.toLowerCase() }] } })) throw new ConflictException('Email or username is already in use');
    const user = await this.db.user.create({ data: { email, username: input.username.toLowerCase(), passwordHash: await bcrypt.hash(input.password, 12), profile: { create: {} } }, select: { id: true, email: true } });
    await this.issueCode(user.id, user.email);
    return { message: 'Check your email for the verification code' };
  }
  async login(input: LoginDto) {
    const user = await this.db.user.findUnique({ where: { email: input.email.toLowerCase() } });
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) throw new UnauthorizedException('Invalid email or password');
    if (!user.emailVerified) throw new UnauthorizedException('Verify your email before signing in');
    return this.createSession(user.id, user.email);
  }
  async verify(input: VerifyDto) {
    const user = await this.db.user.findUnique({ where: { email: input.email.toLowerCase() } });
    if (!user) throw new BadRequestException('Invalid or expired code');
    const code = await this.db.verificationCode.findFirst({ where: { userId: user.id, purpose: 'VERIFY', expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
    if (!code || code.codeHash !== hash(input.code)) throw new BadRequestException('Invalid or expired code');
    await this.db.$transaction([this.db.user.update({ where: { id: user.id }, data: { emailVerified: new Date() } }), this.db.verificationCode.deleteMany({ where: { userId: user.id, purpose: 'VERIFY' } })]);
    return this.createSession(user.id, user.email);
  }
  async resend(email: string) {
    const user = await this.db.user.findUnique({ where: { email: email.toLowerCase() } });
    if (user && !user.emailVerified) await this.issueCode(user.id, user.email);
    return { message: 'If the account can receive a code, one has been sent' };
  }
  private async issueCode(userId: string, email: string) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.db.verificationCode.deleteMany({ where: { userId, purpose: 'VERIFY' } });
    await this.db.verificationCode.create({ data: { userId, purpose: 'VERIFY', codeHash: hash(code), expiresAt: new Date(Date.now() + 15 * 60_000) } });
    await this.mail.sendVerification(email, code);
  }
  async createSession(userId: string, email: string) {
    const accessToken = await this.jwt.signAsync({ sub: userId, email }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: process.env.ACCESS_TOKEN_TTL ?? '15m' });
    const refreshToken = await this.jwt.signAsync({ sub: userId, type: 'refresh' }, { secret: process.env.JWT_REFRESH_SECRET, expiresIn: `${Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30)}d` });
    await this.db.session.create({ data: { userId, refreshTokenHash: hash(refreshToken), expiresAt: new Date(Date.now() + Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30) * 86_400_000) } });
    return { accessToken, refreshToken };
  }
  async refresh(refreshToken: string) {
    let payload: { sub: string; type?: string };
    try { payload = await this.jwt.verifyAsync(refreshToken, { secret: process.env.JWT_REFRESH_SECRET }); }
    catch { throw new UnauthorizedException('Session expired'); }
    if (payload.type !== 'refresh') throw new UnauthorizedException('Invalid refresh token');
    const removed = await this.db.session.deleteMany({ where: { userId: payload.sub, refreshTokenHash: hash(refreshToken), expiresAt: { gt: new Date() } } });
    if (removed.count !== 1) throw new UnauthorizedException('Session expired');
    const user = await this.db.user.findUnique({ where: { id: payload.sub }, select: { id: true, email: true } });
    if (!user) throw new UnauthorizedException('Account not found');
    return this.createSession(user.id, user.email);
  }
  async me(userId: string) { return this.db.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true, username: true, emailVerified: true, profile: true } }); }
  async logout(token: string) { await this.db.session.deleteMany({ where: { refreshTokenHash: hash(token) } }); return { ok: true }; }
}
