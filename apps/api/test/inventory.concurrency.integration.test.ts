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
 * Proof one: inventory consistency under concurrency.
 *
 * This is the test the project exists for. Everything runs against a real
 * Postgres because the guarantee is a Postgres guarantee: a conditional UPDATE
 * evaluates its predicate against the committed row while holding a row lock,
 * and reports how many rows it changed. No mock can demonstrate that.
 */

const created: string[] = [];

beforeAll(async () => {
  await waitForApi();
});

afterAll(async () => {
  for (const productId of created) await cleanupProduct(productId);
  await prisma.$disconnect();
});

describe('concurrent purchases of the last units', () => {
  it('lets exactly three of twenty buyers win when three units exist', async () => {
    const variant = await createTestVariant(3);
    created.push(variant.productId);

    // Twenty independent carts, each asking for one unit, all checking out at
    // the same instant. This is the oversell scenario in its purest form.
    const carts = Array.from({ length: 20 }, () => newCartId());
    await Promise.all(carts.map((cartId) => addToCart(cartId, variant.variantId, 1)));

    const results = await Promise.all(carts.map((cartId) => checkout(cartId)));

    const won = results.filter((result) => result.status === 201 || result.status === 200);
    const lost = results.filter((result) => result.status === 409);

    expect(won).toHaveLength(3);
    expect(lost).toHaveLength(17);
    // Nothing may fail for any other reason. A 500 here would mean the race was
    // "handled" by crashing, which is not handling it.
    expect(results.filter((r) => r.status >= 500)).toHaveLength(0);

    const stock = await stockOf(variant.variantId);
    expect(stock.onHand).toBe(3); // nothing shipped yet
    expect(stock.reserved).toBe(3); // all three units are spoken for
    expect(stock.onHand - stock.reserved).toBe(0); // nothing left to sell

    // The ledger must reconstruct the counters exactly. A mismatch means a write
    // bypassed InventoryService, which is how a lost update would surface.
    const ledger = await ledgerTotals(variant.variantId);
    expect(ledger.reserved).toBe(3);
    expect(ledger.onHand).toBe(0);
  });

  it('never lets reserved exceed on hand, whatever the interleaving', async () => {
    const variant = await createTestVariant(5);
    created.push(variant.productId);

    const carts = Array.from({ length: 15 }, () => newCartId());
    await Promise.all(carts.map((cartId) => addToCart(cartId, variant.variantId, 2)));
    await Promise.all(carts.map((cartId) => checkout(cartId)));

    const stock = await stockOf(variant.variantId);
    // The CHECK constraint's invariant, asserted from the outside.
    expect(stock.reserved).toBeLessThanOrEqual(stock.onHand);
    expect(stock.reserved).toBeGreaterThanOrEqual(0);
    // Two units per order against five in stock means at most two orders win.
    expect(stock.reserved).toBe(4);
  });

  it('refuses the whole order when only one of two lines can be satisfied', async () => {
    const plenty = await createTestVariant(10);
    const scarce = await createTestVariant(0);
    created.push(plenty.productId, scarce.productId);

    const cartId = newCartId();
    await addToCart(cartId, plenty.variantId, 1);
    await addToCart(cartId, scarce.variantId, 1);

    const result = await checkout(cartId);
    expect(result.status).toBe(409);

    // The satisfiable line must not stay reserved. A partial reservation would
    // hold stock for an order that does not exist.
    const stock = await stockOf(plenty.variantId);
    expect(stock.reserved).toBe(0);
    expect(await prisma.stockLedger.count({ where: { variantId: plenty.variantId } })).toBe(0);
  });

  it('reports which item ran out, and how many are left', async () => {
    const variant = await createTestVariant(1);
    created.push(variant.productId);

    const first = newCartId();
    const second = newCartId();
    await addToCart(first, variant.variantId, 1);
    await addToCart(second, variant.variantId, 1);

    await checkout(first);
    const loser = await checkout(second);

    expect(loser.status).toBe(409);
    // The CheckoutError contract is the response body itself, not nested under
    // a `message` key, which is what the storefront's error handler expects.
    const body = loser.body as {
      code: string;
      message: string;
      details: Array<{ sku: string; requested: number; available: number }>;
    };
    expect(body.code).toBe('INSUFFICIENT_STOCK');
    expect(body.details[0]).toMatchObject({
      sku: variant.sku,
      requested: 1,
      available: 0,
    });
  });

  it('does not deadlock when two orders hold the same two variants in opposite order', async () => {
    // Without deterministic lock ordering, A locks v1 and waits for v2 while B
    // locks v2 and waits for v1. Postgres would break one of them with a
    // deadlock error, which would surface here as a 500.
    const a = await createTestVariant(50);
    const b = await createTestVariant(50);
    created.push(a.productId, b.productId);

    const carts = Array.from({ length: 12 }, () => newCartId());
    await Promise.all(
      carts.map(async (cartId, index) => {
        // Half add A then B, half add B then A.
        const order = index % 2 === 0 ? [a, b] : [b, a];
        await addToCart(cartId, order[0]!.variantId, 1);
        await addToCart(cartId, order[1]!.variantId, 1);
      }),
    );

    const results = await Promise.all(carts.map((cartId) => checkout(cartId)));
    expect(results.filter((result) => result.status >= 500)).toHaveLength(0);
    expect(results.filter((result) => result.status < 400)).toHaveLength(12);

    expect((await stockOf(a.variantId)).reserved).toBe(12);
    expect((await stockOf(b.variantId)).reserved).toBe(12);
  });

  it('rejects a cart whose quantity exceeds availability before any reservation', async () => {
    const variant = await createTestVariant(2);
    created.push(variant.productId);

    const cartId = newCartId();
    await addToCart(cartId, variant.variantId, 5);

    const result = await checkout(cartId);
    expect(result.status).toBe(409);
    expect((await stockOf(variant.variantId)).reserved).toBe(0);
  });
});

describe('the database refuses an oversell even when asked directly', () => {
  it('rejects a raw UPDATE that would push reserved past on hand', async () => {
    const variant = await createTestVariant(2);
    created.push(variant.productId);

    // This bypasses InventoryService entirely. The CHECK constraint is the layer
    // that does not depend on application code being correct, and this is what
    // proves it is doing its job.
    await expect(
      prisma.$executeRaw`UPDATE "product_variants" SET "stock_reserved" = 3 WHERE "id" = ${variant.variantId}`,
    ).rejects.toThrow(/variant_stock_non_negative/);

    expect((await stockOf(variant.variantId)).reserved).toBe(0);
  });

  it('rejects negative on-hand stock', async () => {
    const variant = await createTestVariant(1);
    created.push(variant.productId);

    await expect(
      prisma.$executeRaw`UPDATE "product_variants" SET "stock_on_hand" = -1 WHERE "id" = ${variant.variantId}`,
    ).rejects.toThrow(/variant_stock_non_negative/);
  });
});

describe('order numbers under concurrency', () => {
  it('gives every concurrent order a distinct number', async () => {
    const variant = await createTestVariant(30);
    created.push(variant.productId);

    const carts = Array.from({ length: 10 }, () => newCartId());
    await Promise.all(carts.map((cartId) => addToCart(cartId, variant.variantId, 1)));
    const results = await Promise.all(carts.map((cartId) => checkout(cartId)));

    const numbers = results
      .filter((result) => result.status < 400)
      .map((result) => (result.body as CheckoutResponse).orderNumber);

    expect(numbers).toHaveLength(10);
    // A sequence cannot hand the same value to two transactions. MAX()+1 would.
    expect(new Set(numbers).size).toBe(10);
  });
});
