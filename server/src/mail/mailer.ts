import nodemailer, { type Transporter } from 'nodemailer';
import type { Config } from '../config.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Sends email. No provider is hard-coded: SMTP settings come from the environment. */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/**
 * Development and test transport: keeps every message in memory, where tests read them.
 * In development the message is also logged, so sign-in links can be followed locally.
 */
export class OutboxMailer implements Mailer {
  readonly messages: Array<MailMessage & { sentAt: Date }> = [];
  constructor(private readonly log?: (line: string) => void) {}

  async send(message: MailMessage): Promise<void> {
    this.messages.push({ ...message, sentAt: new Date() });
    this.log?.(`[outbox] to ${message.to}: ${message.subject}\n${message.text}`);
  }

  /** The last message sent to an address, if any. */
  lastTo(to: string): (MailMessage & { sentAt: Date }) | undefined {
    return this.messages.filter((m) => m.to === to).at(-1);
  }

  clear(): void {
    this.messages.length = 0;
  }
}

export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(
    private readonly from: string,
    smtp: NonNullable<Config['mail']['smtp']>,
  ) {
    this.transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      // Without implicit TLS, insist on STARTTLS: sign-in links must not travel in clear text.
      requireTLS: !smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.password ?? '' } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, to: message.to, subject: message.subject, text: message.text, html: message.html });
  }
}

export function createMailer(config: Config, log?: (line: string) => void): Mailer {
  if (config.mail.transport === 'smtp') {
    if (!config.mail.smtp) throw new Error('MAIL_TRANSPORT=smtp needs SMTP_HOST');
    return new SmtpMailer(config.mail.from, config.mail.smtp);
  }
  return new OutboxMailer(config.env === 'development' ? log : undefined);
}
