/**
 * Delivery channels. Rendering is somewhere else on purpose: a template is a
 * pure function of order data and can be tested exhaustively, while delivery is
 * I/O and gets mocked.
 */
import nodemailer, { type Transporter } from 'nodemailer';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface NotificationChannel {
  readonly name: 'smtp' | 'log';
  send(message: EmailMessage): Promise<void>;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

export function smtpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SmtpConfig {
  return {
    host: env.SMTP_HOST ?? '',
    port: Number(env.SMTP_PORT ?? '1025'),
    secure: env.SMTP_SECURE === 'true',
    user: env.SMTP_USER || undefined,
    pass: env.SMTP_PASSWORD || undefined,
    from: env.MAIL_FROM ?? 'Shop <orders@shop.local>',
  };
}

export function createSmtpChannel(
  config: SmtpConfig,
  transporter: Transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.pass } : undefined,
  }),
): NotificationChannel {
  return {
    name: 'smtp',
    async send(message: EmailMessage): Promise<void> {
      await transporter.sendMail({
        from: config.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
    },
  };
}

/**
 * Logs instead of delivering, and never throws. This is what runs when no SMTP
 * host is configured, so a missing mail server degrades a demo deploy rather
 * than failing the order-confirmation job and burying it in the dead-letter
 * queue behind a paid order.
 */
export function createLogChannel(
  log: (message: EmailMessage) => void = (message) =>
    console.log(`[mail:log] to=${message.to} subject=${JSON.stringify(message.subject)}`),
): NotificationChannel {
  return {
    name: 'log',
    async send(message: EmailMessage): Promise<void> {
      log(message);
    },
  };
}

/** SMTP when a host is configured, log channel otherwise. */
export function createChannelFromEnv(env: NodeJS.ProcessEnv = process.env): NotificationChannel {
  const host = env.SMTP_HOST?.trim();
  return host ? createSmtpChannel(smtpConfigFromEnv(env)) : createLogChannel();
}
