import type { PrismaClient } from '@shop/db';
import { NotificationService, createLogChannel, type EmailMessage } from '@shop/notifications';
import { describe, expect, it, vi } from 'vitest';
import { releaseExpiredOrder, sendOrderEmail, sweepExpiredReservations, type WorkerDeps } from './handlers';

/**
 * The SQL guards are proven against a real Postgres in the integration suite.
 * What these gate tests pin down is the control flow around them: that a
 * zero-rowcount short-circuits, that the sweep counts correctly, and that a
 * missing order does not throw.
 */

function depsWith(prisma: Partial<PrismaClient>, seen: EmailMessage[] = []): WorkerDeps {
  return {
    prisma: prisma as PrismaClient,
    notifications: new NotificationService(createLogChannel((message) => seen.push(message))),
    appBaseUrl: 'http://localhost:3000',
  };
}

describe('releaseExpiredOrder', () => {
  it('does nothing when the guarded UPDATE matches no row', async () => {
    const executeRaw = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn();
    const deps = depsWith({
      $transaction: (fn: (tx: unknown) => unknown) =>
        Promise.resolve(fn({ $executeRaw: executeRaw, orderItem: { findMany } })),
    } as unknown as Partial<PrismaClient>);

    const result = await releaseExpiredOrder(deps, 'order_1');
    expect(result).toEqual({ released: false, reason: 'not a past-due PENDING order' });
    // Critically, it never looked at the items: a paid order is untouched.
    expect(findMany).not.toHaveBeenCalled();
  });

  it('releases each line and writes one ledger row per successful release', async () => {
    const executeRaw = vi
      .fn()
      .mockResolvedValueOnce(1) // the order UPDATE
      .mockResolvedValue(1); // each variant UPDATE
    const create = vi.fn().mockResolvedValue({});
    const deps = depsWith({
      $transaction: (fn: (tx: unknown) => unknown) =>
        Promise.resolve(
          fn({
            $executeRaw: executeRaw,
            orderItem: {
              findMany: vi.fn().mockResolvedValue([
                { variantId: 'v1', quantity: 2 },
                { variantId: 'v2', quantity: 1 },
              ]),
            },
            stockLedger: { create },
          }),
        ),
    } as unknown as Partial<PrismaClient>);

    const result = await releaseExpiredOrder(deps, 'order_1');
    expect(result.released).toBe(true);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]?.[0].data).toMatchObject({
      kind: 'RELEASE',
      onHandDelta: 0,
      reservedDelta: -2,
      reason: 'reservation-expired',
    });
  });

  it('writes no ledger row for a line whose guarded release matched nothing', async () => {
    // Already released by a concurrent sweep: the counter must not move and the
    // ledger must not gain a row that never happened.
    const executeRaw = vi.fn().mockResolvedValueOnce(1).mockResolvedValue(0);
    const create = vi.fn();
    const deps = depsWith({
      $transaction: (fn: (tx: unknown) => unknown) =>
        Promise.resolve(
          fn({
            $executeRaw: executeRaw,
            orderItem: { findMany: vi.fn().mockResolvedValue([{ variantId: 'v1', quantity: 2 }]) },
            stockLedger: { create },
          }),
        ),
    } as unknown as Partial<PrismaClient>);

    await releaseExpiredOrder(deps, 'order_1');
    expect(create).not.toHaveBeenCalled();
  });
});

describe('sweepExpiredReservations', () => {
  it('reports nothing to do on an empty result', async () => {
    const deps = depsWith({
      order: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as Partial<PrismaClient>);
    expect(await sweepExpiredReservations(deps)).toEqual({ scanned: 0, released: 0 });
  });

  it('counts only the orders it actually released', async () => {
    // Two due, one already handled by a concurrent worker between the scan and
    // the release. Scanned and released must differ, not be assumed equal.
    let call = 0;
    const deps = depsWith({
      order: { findMany: vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]) },
      $transaction: (fn: (tx: unknown) => unknown) => {
        call += 1;
        return Promise.resolve(
          fn({
            $executeRaw: vi.fn().mockResolvedValue(call === 1 ? 1 : 0),
            orderItem: { findMany: vi.fn().mockResolvedValue([]) },
            stockLedger: { create: vi.fn() },
          }),
        );
      },
    } as unknown as Partial<PrismaClient>);

    expect(await sweepExpiredReservations(deps)).toEqual({ scanned: 2, released: 1 });
  });

  it('passes the limit through so one sweep cannot run unbounded', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const deps = depsWith({ order: { findMany } } as unknown as Partial<PrismaClient>);
    await sweepExpiredReservations(deps, 25);
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({ take: 25 });
  });
});

describe('sendOrderEmail', () => {
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
    items: [
      {
        productTitle: 'Ear One',
        variantName: 'White',
        quantity: 1,
        lineTotalCents: 14_900,
      },
    ],
  };

  it('renders and sends the confirmation', async () => {
    const seen: EmailMessage[] = [];
    const deps = depsWith(
      { order: { findUnique: vi.fn().mockResolvedValue(order) } } as unknown as Partial<PrismaClient>,
      seen,
    );
    expect(await sendOrderEmail(deps, { orderId: 'order_1', kind: 'ORDER_CONFIRMED' })).toEqual({
      sent: true,
    });
    expect(seen[0]?.subject).toBe('Order SHOP-1001 confirmed');
    expect(seen[0]?.to).toBe('buyer@example.com');
  });

  it('falls back to the shipping name for a guest order', async () => {
    const seen: EmailMessage[] = [];
    const deps = depsWith(
      { order: { findUnique: vi.fn().mockResolvedValue(order) } } as unknown as Partial<PrismaClient>,
      seen,
    );
    await sendOrderEmail(deps, { orderId: 'order_1', kind: 'ORDER_CONFIRMED' });
    expect(seen[0]?.text).toContain('Hi Ada Lovelace,');
  });

  it('prefers the account name when there is one', async () => {
    const seen: EmailMessage[] = [];
    const deps = depsWith(
      {
        order: { findUnique: vi.fn().mockResolvedValue({ ...order, user: { name: 'Grace' } }) },
      } as unknown as Partial<PrismaClient>,
      seen,
    );
    await sendOrderEmail(deps, { orderId: 'order_1', kind: 'ORDER_CONFIRMED' });
    expect(seen[0]?.text).toContain('Hi Grace,');
  });

  it('skips a missing order instead of throwing it back onto the retry queue', async () => {
    const deps = depsWith({
      order: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as Partial<PrismaClient>);
    expect(await sendOrderEmail(deps, { orderId: 'gone', kind: 'ORDER_CONFIRMED' })).toEqual({
      sent: false,
      reason: 'order not found',
    });
  });

  it('links to the order on the configured app base URL', async () => {
    const seen: EmailMessage[] = [];
    const deps = depsWith(
      { order: { findUnique: vi.fn().mockResolvedValue(order) } } as unknown as Partial<PrismaClient>,
      seen,
    );
    await sendOrderEmail(deps, { orderId: 'order_1', kind: 'ORDER_FULFILLED' });
    expect(seen[0]?.text).toContain('http://localhost:3000/orders/order_1');
  });
});
