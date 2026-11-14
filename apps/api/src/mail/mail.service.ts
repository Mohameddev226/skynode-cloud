import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly isDev: boolean;

  constructor(private readonly config: ConfigService) {
    this.isDev = config.get('NODE_ENV', 'development') !== 'production';
  }

  async send(options: SendMailOptions): Promise<void> {
    if (this.isDev) {
      this.logger.log(`[DEV MAIL] To: ${options.to}`);
      this.logger.log(`[DEV MAIL] Subject: ${options.subject}`);
      this.logger.debug(`[DEV MAIL] Body:\n${options.text ?? options.html}`);
      return;
    }

    // Production: integrate with SMTP/SendGrid/SES here
    // const smtpHost = this.config.get('SMTP_HOST');
    // const smtpPort = this.config.get('SMTP_PORT');
    this.logger.warn('Production mail transport not configured — email not sent');
  }

  async sendVerificationEmail(email: string, token: string): Promise<void> {
    const baseUrl = this.config.get('DASHBOARD_URL', 'http://localhost:3000');
    const verifyUrl = `${baseUrl}/verify-email?token=${token}`;

    await this.send({
      to: email,
      subject: 'Verify your SkyNode Cloud email',
      html: `
        <h2>Welcome to SkyNode Cloud</h2>
        <p>Click the link below to verify your email address:</p>
        <p><a href="${verifyUrl}">${verifyUrl}</a></p>
        <p>This link expires in 24 hours.</p>
      `,
      text: `Verify your email: ${verifyUrl}`,
    });
  }

  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    const baseUrl = this.config.get('DASHBOARD_URL', 'http://localhost:3000');
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;

    await this.send({
      to: email,
      subject: 'Reset your SkyNode Cloud password',
      html: `
        <h2>Password Reset</h2>
        <p>Click the link below to reset your password:</p>
        <p><a href="${resetUrl}">${resetUrl}</a></p>
        <p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>
      `,
      text: `Reset your password: ${resetUrl}`,
    });
  }
}
