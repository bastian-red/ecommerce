import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config/config';
import type { PrismaService } from '../prisma/prisma.service';
import { OrderEmailService } from './order-email.service';

const config = { appBaseUrl: 'http://localhost:3000' } as AppConfig;

const order = {
  id: 'order_1',
  number: 'SHOP-1001',
  email: 'buyer@example.com',
  currency: 'usd',
  subtotalCents: 14_900,
  shippingCents: 0,
  taxCents: 1_304,
  totalCents: 16_204,
  shippingName: 'Ada Lovelace',
  user: null,
  items: [{ productTitle: 'Ear One', variantName: 'White', quantity: 1, lineTotalCents: 14_900 }],
};

/**
 * The channel resolves from the environment, and with no SMTP_HOST set it is the
 * log channel, which never throws. That is exactly the production default for a
 * demo deploy, so these tests exercise the real path rather than a mock.
 */
function serviceWith(prisma: Partial<PrismaService>): OrderEmailService {
  return new OrderEmailService(prisma as PrismaService, config);
}

describe('OrderEmailService', () => {
  it('sends for an existing order', async () => {
    const service = serviceWith({
      order: { findUnique: vi.fn().mockResolvedValue(order) },
    } as unknown as Partial<PrismaService>);

    expect(await service.send({ orderId: 'order_1', kind: 'ORDER_CONFIRMED' })).toEqual({
      sent: true,
    });
  });

  it('skips a missing order instead of throwing', async () => {
    const service = serviceWith({
      order: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as Partial<PrismaService>);

    expect(await service.send({ orderId: 'gone', kind: 'ORDER_CONFIRMED' })).toEqual({
      sent: false,
      reason: 'order not found',
    });
  });

  it('never throws when the database is unreachable', async () => {
    // This runs immediately after a webhook committed a paid order. Throwing
    // here would turn a completed payment into a retryable webhook, and the
    // provider would redeliver an event that was already handled correctly.
    const service = serviceWith({
      order: { findUnique: vi.fn().mockRejectedValue(new Error('connection lost')) },
    } as unknown as Partial<PrismaService>);

    expect(await service.send({ orderId: 'order_1', kind: 'ORDER_CONFIRMED' })).toEqual({
      sent: false,
      reason: 'send failed',
    });
  });

  it('loads the order with the items and the account name the template needs', async () => {
    const findUnique = vi.fn().mockResolvedValue(order);
    const service = serviceWith({
      order: { findUnique },
    } as unknown as Partial<PrismaService>);

    await service.send({ orderId: 'order_1', kind: 'ORDER_FULFILLED' });
    expect(findUnique.mock.calls[0]?.[0]).toMatchObject({
      where: { id: 'order_1' },
      include: { items: true, user: { select: { name: true } } },
    });
  });

  it('handles every email kind', async () => {
    const service = serviceWith({
      order: { findUnique: vi.fn().mockResolvedValue(order) },
    } as unknown as Partial<PrismaService>);

    for (const kind of ['ORDER_CONFIRMED', 'ORDER_FULFILLED', 'ORDER_CANCELLED'] as const) {
      expect(await service.send({ orderId: 'order_1', kind })).toEqual({ sent: true });
    }
  });
});
