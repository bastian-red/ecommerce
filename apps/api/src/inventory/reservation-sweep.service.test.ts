import { describe, expect, it, vi } from 'vitest';
import type { InventoryService } from './inventory.service';
import type { PrismaService } from '../prisma/prisma.service';
import { ReservationSweepService } from './reservation-sweep.service';

/**
 * The SQL guards are proven against a real Postgres in the integration lane.
 * What is unit-testable here is the control flow around them: that a
 * zero-rowcount short-circuits before touching stock, that the sweep counts only
 * what it actually released, and that a failure in the lazy path can never take
 * a checkout down with it.
 */

function serviceWith(prisma: Partial<PrismaService>, inventory?: Partial<InventoryService>) {
  return new ReservationSweepService(
    prisma as PrismaService,
    (inventory ?? { release: vi.fn().mockResolvedValue(0) }) as unknown as InventoryService,
  );
}

describe('releaseExpiredOrder', () => {
  it('does nothing when the guarded UPDATE matches no row', async () => {
    const executeRaw = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn();
    const release = vi.fn();
    const service = serviceWith(
      {
        $transaction: (fn: (tx: unknown) => unknown) =>
          Promise.resolve(fn({ $executeRaw: executeRaw, orderItem: { findMany } })),
      } as unknown as Partial<PrismaService>,
      { release } as unknown as Partial<InventoryService>,
    );

    expect(await service.releaseExpiredOrder('order_1')).toEqual({
      released: false,
      reason: 'not a past-due PENDING order',
    });
    // Critically, it never looked at the items: a paid order is left alone.
    expect(findMany).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it('releases through InventoryService so expiry and checkout agree on stock', async () => {
    const items = [
      { variantId: 'v1', quantity: 2 },
      { variantId: 'v2', quantity: 1 },
    ];
    const release = vi.fn().mockResolvedValue(2);
    const service = serviceWith(
      {
        $transaction: (fn: (tx: unknown) => unknown) =>
          Promise.resolve(
            fn({
              $executeRaw: vi.fn().mockResolvedValue(1),
              orderItem: { findMany: vi.fn().mockResolvedValue(items) },
            }),
          ),
      } as unknown as Partial<PrismaService>,
      { release } as unknown as Partial<InventoryService>,
    );

    const result = await service.releaseExpiredOrder('order_1');
    expect(result.released).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.calls[0]?.[1]).toBe('order_1');
    expect(release.mock.calls[0]?.[2]).toEqual(items);
    expect(release.mock.calls[0]?.[3]).toBe('reservation-expired');
  });
});

describe('sweep', () => {
  it('reports nothing to do on an empty result', async () => {
    const service = serviceWith({
      order: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as Partial<PrismaService>);
    expect(await service.sweep()).toEqual({ scanned: 0, released: 0 });
  });

  it('counts only the orders it actually released', async () => {
    // Two due, one already handled by a concurrent sweep between the scan and
    // the release. With the lazy trigger many requests sweep at once, so scanned
    // and released genuinely differ and must not be assumed equal.
    let call = 0;
    const service = serviceWith({
      order: { findMany: vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]) },
      $transaction: (fn: (tx: unknown) => unknown) => {
        call += 1;
        return Promise.resolve(
          fn({
            $executeRaw: vi.fn().mockResolvedValue(call === 1 ? 1 : 0),
            orderItem: { findMany: vi.fn().mockResolvedValue([]) },
          }),
        );
      },
    } as unknown as Partial<PrismaService>);

    expect(await service.sweep()).toEqual({ scanned: 2, released: 1 });
  });

  it('stays bounded, because it runs inside a customer checkout', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = serviceWith({ order: { findMany } } as unknown as Partial<PrismaService>);

    await service.sweep();
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({ take: 20 });

    await service.sweep(5);
    expect(findMany.mock.calls[1]?.[0]).toMatchObject({ take: 5 });
  });

  it('takes the oldest expiries first', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = serviceWith({ order: { findMany } } as unknown as Partial<PrismaService>);
    await service.sweep();
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      orderBy: { reservationExpiresAt: 'asc' },
    });
  });
});

describe('sweepQuietly', () => {
  it('swallows a failure rather than failing the checkout that called it', async () => {
    // The worst case of a failed sweep is that the customer is told the stock is
    // unavailable, which is the same answer they would have got a second
    // earlier. Failing their checkout instead would be strictly worse.
    const service = serviceWith({
      order: { findMany: vi.fn().mockRejectedValue(new Error('connection lost')) },
    } as unknown as Partial<PrismaService>);

    expect(await service.sweepQuietly()).toEqual({ scanned: 0, released: 0 });
  });

  it('returns the real result when nothing goes wrong', async () => {
    const service = serviceWith({
      order: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as Partial<PrismaService>);
    expect(await service.sweepQuietly()).toEqual({ scanned: 0, released: 0 });
  });
});
