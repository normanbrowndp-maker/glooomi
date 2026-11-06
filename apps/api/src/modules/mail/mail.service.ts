import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  async sendVerification(to: string, code: string) {
    const { SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, SMTP_FROM_NAME } = process.env;
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD || !SMTP_FROM) throw new ServiceUnavailableException('Email delivery is not configured. Set Gmail SMTP credentials.');
    const transporter = nodemailer.createTransport({ host: SMTP_HOST, port: Number(process.env.SMTP_PORT || 465), secure: process.env.SMTP_SECURE !== 'false', auth: { user: SMTP_USER, pass: SMTP_PASSWORD } });
    await transporter.sendMail({ from: { address: SMTP_FROM, name: SMTP_FROM_NAME || 'gloomi' }, to, subject: 'Your gloomi verification code', text: `Your gloomi code is ${code}. It expires in 15 minutes.`, html: `<p>Your gloomi verification code:</p><strong style="font-size:28px;letter-spacing:8px">${code}</strong><p>It expires in 15 minutes.</p>` });
  }
}
