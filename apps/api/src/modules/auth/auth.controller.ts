import { Body, Controller, ForbiddenException, Get, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LoginDto, PasswordResetConfirmDto, PasswordResetDto, RegisterDto, ResendDto, VerifyDto } from './dto';
import { RateLimitService } from './rate-limit.service';
import { MediaService } from '../media/media.service';

const HOUR = 60 * 60_000;

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService, private limits: RateLimitService, private media: MediaService) {}

  private cookieOptions() {
    const sameSite = (process.env.COOKIE_SAME_SITE || 'lax') as 'lax' | 'strict' | 'none';
    const secure = process.env.NODE_ENV === 'production';
    if (sameSite === 'none' && !secure) throw new Error('COOKIE_SAME_SITE=none requires secure cookies');
    return { httpOnly: true, secure, sameSite, path: '/api/auth' as const, ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}) };
  }

  private assertOrigin(request: Request) {
    const origin = request.headers.origin;
    if (!origin) return;
    const allowed = process.env.WEB_ORIGIN?.split(',').map(value => value.trim()).filter(Boolean) ?? ['http://localhost:5173'];
    if (!allowed.includes(origin)) throw new ForbiddenException('Origin is not allowed');
  }

  private refreshFromRequest(request: Request) {
    return request.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('gloomi.refresh='))?.slice('gloomi.refresh='.length);
  }

  private csrfFromRequest(request: Request) {
    return request.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('gloomi.csrf='))?.slice('gloomi.csrf='.length);
  }

  private assertCsrf(request: Request) {
    this.assertOrigin(request);
    const token = this.csrfFromRequest(request) || '';
    if (!token || request.headers['x-csrf-token'] !== token || !this.auth.verifyCsrfToken(token)) throw new UnauthorizedException('CSRF validation failed');
  }

  private async applySession(response: Response, session: { accessToken: string; refreshToken: string }) {
    const options = this.cookieOptions();
    const maxAge = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30) * 86_400_000;
    const csrfToken = this.auth.createCsrfToken();
    response.cookie('gloomi.refresh', session.refreshToken, { ...options, maxAge });
    response.cookie('gloomi.csrf', csrfToken, { ...options, path: '/', httpOnly: false, maxAge });
    response.setHeader('Cache-Control', 'no-store');
    return { accessToken: session.accessToken, csrfToken };
  }

  private clearCookies(response: Response) {
    const options = this.cookieOptions();
    response.clearCookie('gloomi.refresh', options);
    response.clearCookie('gloomi.csrf', { ...options, path: '/', httpOnly: false });
  }

  @Get('csrf') csrf(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    this.assertOrigin(request);
    const token = this.csrfFromRequest(request) || null;
    return { csrfToken: token && this.auth.verifyCsrfToken(token) ? token : null };
  }

  @Post('register') async register(@Body() dto: RegisterDto, @Req() request: Request) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.auth.userIdForEmail(email);
    await this.limits.consume('register', { ip: request.ip, email, user }, { ip: { max: 20, windowMs: HOUR }, email: { max: 5, windowMs: HOUR }, user: { max: 5, windowMs: HOUR } });
    return this.auth.register(dto);
  }

  @Post('login') async login(@Body() dto: LoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.assertOrigin(request);
    const user = await this.auth.userIdForEmail(dto.email);
    await this.limits.consume('login', { ip: request.ip, email: dto.email.trim().toLowerCase(), user }, { ip: { max: 60, windowMs: HOUR }, email: { max: 20, windowMs: HOUR }, user: { max: 20, windowMs: HOUR } });
    return this.applySession(response, await this.auth.login(dto));
  }

  @Post('verify-email') async verify(@Body() dto: VerifyDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.assertOrigin(request);
    const user = await this.auth.userIdForEmail(dto.email);
    await this.limits.consume('verify-email', { ip: request.ip, email: dto.email.trim().toLowerCase(), user }, { ip: { max: 30, windowMs: HOUR }, email: { max: 10, windowMs: HOUR }, user: { max: 10, windowMs: HOUR } });
    return this.applySession(response, await this.auth.verify(dto));
  }

  @Post('refresh') async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.assertCsrf(request);
    const token = this.refreshFromRequest(request);
    if (!token) throw new UnauthorizedException('Session expired');
    const user = await this.auth.refreshSubject(token);
    await this.limits.consume('refresh', { ip: request.ip, user }, { ip: { max: 120, windowMs: HOUR }, user: { max: 120, windowMs: HOUR } });
    return this.applySession(response, await this.auth.refresh(token));
  }

  @Post('resend-code') async resend(@Body() dto: ResendDto, @Req() request: Request) {
    const user = await this.auth.userIdForEmail(dto.email);
    await this.limits.consume('resend-code', { ip: request.ip, email: dto.email.trim().toLowerCase(), user }, { ip: { max: 20, windowMs: HOUR }, email: { max: 5, windowMs: HOUR }, user: { max: 5, windowMs: HOUR } });
    return this.auth.resend(dto.email);
  }

  @Post('password-reset/request') async requestPasswordReset(@Body() dto: PasswordResetDto, @Req() request: Request) {
    const user = await this.auth.userIdForEmail(dto.email);
    await this.limits.consume('password-reset', { ip: request.ip, email: dto.email.trim().toLowerCase(), user }, { ip: { max: 15, windowMs: HOUR }, email: { max: 5, windowMs: HOUR }, user: { max: 5, windowMs: HOUR } });
    return this.auth.requestPasswordReset(dto.email);
  }

  @Post('password-reset/confirm') async resetPassword(@Body() dto: PasswordResetConfirmDto, @Req() request: Request) {
    const user = await this.auth.userIdForEmail(dto.email);
    await this.limits.consume('password-reset-confirm', { ip: request.ip, email: dto.email.trim().toLowerCase(), user }, { ip: { max: 20, windowMs: HOUR }, email: { max: 8, windowMs: HOUR }, user: { max: 8, windowMs: HOUR } });
    return this.auth.resetPassword(dto);
  }

  @Post('logout') async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.assertCsrf(request);
    const token = this.refreshFromRequest(request);
    if (token) await this.auth.logout(token);
    this.clearCookies(response);
    return { ok: true };
  }

  @Post('logout-all') @UseGuards(JwtAuthGuard) async logoutAll(@Req() request: Request & { user: { sub: string } }, @Res({ passthrough: true }) response: Response) {
    await this.limits.consume('logout-all', { ip: request.ip, user: request.user.sub }, { ip: { max: 20, windowMs: HOUR }, user: { max: 10, windowMs: HOUR } });
    await this.auth.logoutAll(request.user.sub);
    this.clearCookies(response);
    return { ok: true };
  }

  @Get('me') @UseGuards(JwtAuthGuard) async me(@Req() request: Request & { user: { sub: string } }) {
    const user = await this.auth.me(request.user.sub);
    return { ...user, profile: await this.media.presentProfile(user.profile, true) };
  }
}
