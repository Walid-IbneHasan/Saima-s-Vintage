import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

/**
 * SMTP email via Nodemailer. If SMTP isn't configured (e.g. local/dev), emails
 * are logged instead of sent — so flows never break on a missing mail server.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private transporter: nodemailer.Transporter | null = null;
  private resolved = false;

  private getTransporter(): nodemailer.Transporter | null {
    if (this.resolved) return this.transporter;
    this.resolved = true;
    const host = process.env.SMTP_HOST;
    if (!host) {
      this.transporter = null;
      return null;
    }
    const port = Number(process.env.SMTP_PORT ?? 587);
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
    });
    return this.transporter;
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    const transporter = this.getTransporter();
    if (!transporter) {
      this.logger.warn(`[email suppressed — no SMTP] to=${to} subject="${subject}"`);
      return;
    }
    await transporter.sendMail({
      from: process.env.SMTP_FROM ?? 'no-reply@saimasvintage.local',
      to,
      subject,
      html,
    });
  }
}
