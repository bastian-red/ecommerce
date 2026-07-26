import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addToCart,
  checkout,
  cleanupProduct,
  createTestVariant,
  ledgerTotals,
  newCartId,
  prisma,
  stockOf,
  waitForApi,
  type CheckoutResponse,
} from './helpers';

/**
 * Reservation expiry, both triggers.
 *
 * The always-on worker that used to do this is gone. Two things replaced it and
 * both are proven here against a real Postgres:
 *
 *  1. The API sweeps lazily at the start of every checkout.
 *  2. `release_expired_reservations()` does the same work inside the database,
 *     scheduled by pg_cron in production.
 *
 * They must agree exactly, because in production they run concurrently.
 */

const created: string[] = [];

beforeAll(async () => {
  await waitForApi();
});

afterAll(async () => {
  for (const productId of created) await cleanupProduct(productId);
  await prisma.$disconnect();
});

/** Force an order's reservation into the past, as if its TTL had elapsed. */
async function expireReservation(orderId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "orders"
       SET "reservation_expires_at" = NOW() - INTERVAL '1 hour'
     WHERE "id" = ${orderId}`;
}

describe('the SQL backstop', () => {
  it('expires a past-due order and returns its stock', async () => {
    const variant = await createTestVariant(5);
    created.push(variant.productId);

    const cartId = newCartId();
    await addToCart(cartId, variant.variantId, 2);
    const result = await checkout(cartId);
    const order = result.body as CheckoutResponse;
    expect((await stockOf(variant.variantId)).reserved).toBe(2);

    await expireReservation(order.orderId);

    const [swept] = await prisma.$queryRaw<Array<{ expired_orders: number; released_lines: number }>>`
      SELECT * FROM release_expired_reservations(100)`;
    expect(swept!.expired_orders).toBeGreaterThanOrEqual(1);

    const stock = await stockOf(variant.variantId);
    expect(stock.reserved).toBe(0);
    // On-hand is untouched: nothing shipped, the goods went back on the shelf.
    expect(stock.onHand).toBe(5);

    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } });
    expect(row.status).toBe('EXPIRED');

    // The release is in the ledger, so replaying it still reconstructs the
    // counters. A sweep that skipped the ledger would break reconciliation.
    const totals = await ledgerTotals(variant.variantId);
    expect(totals.reserved).toBe(0);
    expect(totals.onHand).toBe(0);
  });

  it('is idempotent: a second run releases nothing', async () => {
    const variant = await createTestVariant(3);
    created.push(variant.productId);

    const cartId = newCartId();
    await addToCart(cartId, variant.variantId, 1);
    const order = (await checkout(cartId)).body as CheckoutResponse;
    await expireReservation(order.orderId);

    await prisma.$queryRaw`SELECT * FROM release_expired_reservations(100)`;
    const before = await stockOf(variant.variantId);

    await prisma.$queryRaw`SELECT * FROM release_expired_reservations(100)`;
    expect(await stockOf(variant.variantId)).toEqual(before);

    // And no second ledger row for the same release.
    const releases = await prisma.stockLedger.count({
      where: { variantId: variant.variantId, kind: 'RELEASE' },
    });
    expect(releases).toBe(1);
  });

  it('leaves a paid order alone even when its deadline has passed', async () => {
    // The dangerous case: a customer paid, and the sweep must not cancel their
    // order out from under them because the clock says the hold lapsed.
    const variant = await createTestVariant(3);
    created.push(variant.productId);

    const cartId = newCartId();
    await addToCart(cartId, variant.variantId, 1);
    const order = (await checkout(cartId)).body as CheckoutResponse;

    await prisma.$executeRaw`
      UPDATE "orders"
         SET "status" = 'PAID'::"OrderStatus",
             "reservation_expires_at" = NOW() - INTERVAL '1 hour'
       WHERE "id" = ${order.orderId}`;

    await prisma.$queryRaw`SELECT * FROM release_expired_reservations(100)`;

    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } });
    expect(row.status).toBe('PAID');
    expect((await stockOf(variant.variantId)).reserved).toBe(1);
  });

  it('survives concurrent invocations without double-releasing', async () => {
    // SKIP LOCKED means overlapping sweeps divide the work rather than blocking
    // or double-counting. In production the lazy path and pg_cron overlap
    // constantly.
    const variant = await createTestVariant(10);
    created.push(variant.productId);

    // All three reservations are taken first and expired together. Expiring one
    // inside the loop would not work: the next checkout's own lazy sweep would
    // reclaim it before this test got to the concurrent part, which is the lazy
    // path doing exactly its job.
    const orders: CheckoutResponse[] = [];
    for (let i = 0; i < 3; i++) {
      const cartId = newCartId();
      await addToCart(cartId, variant.variantId, 1);
      orders.push((await checkout(cartId)).body as CheckoutResponse);
    }
    expect((await stockOf(variant.variantId)).reserved).toBe(3);

    for (const order of orders) await expireReservation(order.orderId);

    await Promise.all(
      Array.from({ length: 5 }, () =>
        prisma.$queryRaw`SELECT * FROM release_expired_reservations(100)`,
      ),
    );

    const stock = await stockOf(variant.variantId);
    expect(stock.reserved).toBe(0);
    expect(stock.onHand).toBe(10);
    expect(
      await prisma.stockLedger.count({ where: { variantId: variant.variantId, kind: 'RELEASE' } }),
    ).toBe(3);
  });
});

describe('the lazy sweep in the checkout path', () => {
  it('reclaims expired stock so the next customer can buy it', async () => {
    // This is the whole point of sweeping lazily. One unit exists, an abandoned
    // checkout is holding it, and its TTL has passed. The next buyer must get it
    // without waiting for any scheduler to notice.
    const variant = await createTestVariant(1);
    created.push(variant.productId);

    const abandoned = newCartId();
    await addToCart(abandoned, variant.variantId, 1);
    const stale = (await checkout(abandoned)).body as CheckoutResponse;
    expect((await stockOf(variant.variantId)).reserved).toBe(1);

    await expireReservation(stale.orderId);

    // No sweep is triggered by hand. The checkout does it itself.
    const buyer = newCartId();
    await addToCart(buyer, variant.variantId, 1);
    const result = await checkout(buyer);

    expect(result.status).toBeLessThan(400);
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: stale.orderId } })).status,
    ).toBe('EXPIRED');
    expect((await stockOf(variant.variantId)).reserved).toBe(1);
  });

  it('still refuses when the holding reservation has not expired', async () => {
    // The counterpart: the sweep must not become a way to steal stock from a
    // checkout that is still live.
    const variant = await createTestVariant(1);
    created.push(variant.productId);

    const first = newCartId();
    await addToCart(first, variant.variantId, 1);
    expect((await checkout(first)).status).toBeLessThan(400);

    const second = newCartId();
    await addToCart(second, variant.variantId, 1);
    expect((await checkout(second)).status).toBe(409);
  });
});
