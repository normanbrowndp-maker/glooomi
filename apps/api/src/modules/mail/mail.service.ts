import { Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { EmailOutboxKind } from '@prisma/client';
import type { EmailPayload } from './mail-crypto';

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

@Injectable()
export class MailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  private transporter?: Transporter;
  private lastVerifiedAt?: Date;
  private lastFailure?: string;

  async onModuleInit() {
    const { SMTP_HOST, SMTP_USER, SMTP_PASSWORD } = process.env;
    const port = Number(process.env.SMTP_PORT || 465);
    const localMailpit = ['localhost', '127.0.0.1', 'mailpit'].includes(SMTP_HOST || '') && port === 1025;
    if (!SMTP_HOST || (!localMailpit && (!SMTP_USER || !SMTP_PASSWORD))) {
      this.lastFailure = 'SMTP_NOT_CONFIGURED';
      this.logger.warn('SMTP is not configured; email delivery is unavailable');
      return;
    }
    this.transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE !== 'false',
      ...(SMTP_USER && SMTP_PASSWORD ? { auth: { user: SMTP_USER, pass: SMTP_PASSWORD } } : {}),
      connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT || 10_000),
      greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT || 10_000),
      socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT || 20_000),
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
    });
    await this.verifyConnection();
  }

  async onModuleDestroy() { this.transporter?.close(); }

  async verifyConnection() {
    if (!this.transporter) return { status: 'unavailable' as const };
    try {
      await this.transporter.verify();
      this.lastVerifiedAt = new Date();
      this.lastFailure = undefined;
      return { status: 'ok' as const, verifiedAt: this.lastVerifiedAt };
    } catch (error) {
      this.lastFailure = error instanceof Error ? error.name : 'SMTP_ERROR';
      this.logger.error(`SMTP health check failed (${this.lastFailure})`);
      return { status: 'unavailable' as const };
    }
  }

  health() {
    return { status: this.lastFailure ? 'unavailable' : this.lastVerifiedAt ? 'ok' : 'unknown', lastVerifiedAt: this.lastVerifiedAt };
  }

  async send(kind: EmailOutboxKind, payload: EmailPayload, messageId: string) {
    const { SMTP_USER, SMTP_FROM, SMTP_FROM_NAME } = process.env;
    if (!this.transporter || !SMTP_FROM) throw new ServiceUnavailableException('Email delivery is not configured.');
    const isReset = kind === EmailOutboxKind.RESET_PASSWORD;
    const code = escapeHtml(payload.code);
    const product = 'gloomi';
    await this.transporter.sendMail({
      from: { address: SMTP_FROM, name: SMTP_FROM_NAME || product },
      to: payload.to,
      messageId: `<${messageId}@gloomi.local>`,
      subject: isReset ? 'Reset your gloomi password' : 'Your gloomi verification code',
      text: isReset ? `Your password reset code is ${payload.code}. It expires in 10 minutes.` : `Your gloomi code is ${payload.code}. It expires in 10 minutes.`,
      html: isReset
        ? `<p>Use this code to reset your password:</p><strong style="font-size:28px;letter-spacing:8px">${code}</strong><p>It expires in 10 minutes.</p>`
        : `<p>Your gloomi verification code:</p><strong style="font-size:28px;letter-spacing:8px">${code}</strong><p>It expires in 10 minutes.</p>`,
    });
  }
}
