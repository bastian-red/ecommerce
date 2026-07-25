import type { Transporter } from 'nodemailer';
import { describe, expect, it, vi } from 'vitest';
import {
  createChannelFromEnv,
  createLogChannel,
  createSmtpChannel,
  smtpConfigFromEnv,
  type EmailMessage,
} from './channel';
import { NotificationService } from './index';
import type { OrderEmailData } from './templates';

const message: EmailMessage = {
  to: 'buyer@example.com',
  subject: 'Order SHOP-1001 confirmed',
  html: '<h1>ok</h1>',
  text: 'ok',
};

describe('smtpConfigFromEnv', () => {
  it('reads the documented variables', () => {
    const config = smtpConfigFromEnv({
      SMTP_HOST: 'localhost',
      SMTP_PORT: '1026',
      SMTP_USER: 'u',
      SMTP_PASSWORD: 'p',
      MAIL_FROM: 'Shop <orders@shop.local>',
    });
    expect(config).toEqual({
      host: 'localhost',
      port: 1026,
      secure: false,
      user: 'u',
      pass: 'p',
      from: 'Shop <orders@shop.local>',
    });
  });

  it('treats an empty user as absent, so no auth block is built', () => {
    expect(smtpConfigFromEnv({ SMTP_USER: '' }).user).toBeUndefined();
  });
});

describe('createSmtpChannel', () => {
  it('hands the message to the transporter with the configured from address', async () => {
    const sendMail = vi.fn().mockResolvedValue({});
    const channel = createSmtpChannel(
      { host: 'localhost', port: 1026, secure: false, from: 'Shop <orders@shop.local>' },
      { sendMail } as unknown as Transporter,
    );
    await channel.send(message);
    expect(sendMail).toHaveBeenCalledWith({
      from: 'Shop <orders@shop.local>',
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  });

  it('propagates a transport failure, so the queue can retry it', async () => {
    const sendMail = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const channel = createSmtpChannel(
      { host: 'localhost', port: 1026, secure: false, from: 'x@y' },
      { sendMail } as unknown as Transporter,
    );
    await expect(channel.send(message)).rejects.toThrow('ECONNREFUSED');
  });
});

describe('createLogChannel', () => {
  it('records the message instead of sending it', async () => {
    const seen: EmailMessage[] = [];
    await createLogChannel((m) => seen.push(m)).send(message);
    expect(seen).toEqual([message]);
  });

  it('never throws, so a demo deploy with no mail server still completes orders', async () => {
    await expect(createLogChannel(() => {}).send(message)).resolves.toBeUndefined();
  });
});

describe('createChannelFromEnv', () => {
  it('picks the log channel when no SMTP host is set', () => {
    expect(createChannelFromEnv({}).name).toBe('log');
    expect(createChannelFromEnv({ SMTP_HOST: '   ' }).name).toBe('log');
  });

  it('picks SMTP when a host is set', () => {
    expect(createChannelFromEnv({ SMTP_HOST: 'localhost', SMTP_PORT: '1026' }).name).toBe('smtp');
  });
});

describe('NotificationService', () => {
  const data: OrderEmailData = {
    orderNumber: 'SHOP-1001',
    email: 'buyer@example.com',
    customerName: 'Ada',
    currency: 'usd',
    items: [{ productTitle: 'Ear One', variantName: 'White', quantity: 1, lineTotalCents: 14_900 }],
    subtotalCents: 14_900,
    shippingCents: 0,
    taxCents: 1_304,
    totalCents: 16_204,
    orderUrl: 'http://localhost:3000/orders/order_1',
  };

  it('renders and sends through the injected channel', async () => {
    const seen: EmailMessage[] = [];
    const service = new NotificationService(createLogChannel((m) => seen.push(m)));
    await service.send('ORDER_CONFIRMED', data);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.subject).toBe('Order SHOP-1001 confirmed');
    expect(seen[0]?.to).toBe('buyer@example.com');
  });

  it('exposes the active channel name for the health endpoint', () => {
    expect(new NotificationService(createLogChannel(() => {})).channelName).toBe('log');
  });
});
