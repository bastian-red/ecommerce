import { buildMockWebhookRequest, SIGNATURE_HEADER } from '@shop/payments/mock';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addToCart,
  API_BASE_URL,
  checkout,
  cleanupProduct,
  createTestVariant,
  deliverWebhook,
  ledgerTotals,
  MOCK_SECRET,
  newCartId,
  paymentEvent,
  prisma,
  stockOf,
  waitForApi,
  type CheckoutResponse,
} from './helpers';

/**
 * Proof two: exactly-once order transitions under duplicated, replayed and
 * out-of-order webhook delivery.
 *
 * Real gateways retry. They retry on a timeout they caused, on a 500 they got,
 * and sometimes on nothing at all. They do not guarantee ordering. Every case
 * below is one a production store meets in its first month.
 */

const created: string[] = [];

beforeAll(async () => {
  await waitForApi();
});

afterAll(async () => {
  for (const productId of created) await cleanupProduct(productId);
  await prisma.$disconnect();
});

async function placeOrder(stock = 5, quantity = 2): Promise<CheckoutResponse> {
  const variant = await createTestVariant(stock);
  created.push(variant.productId);
  const cartId = newCartId();
  await addToCart(cartId, variant.variantId, quantity);
  const result = await checkout(cartId);
  expect(result.status).toBeLessThan(400);
  return { ...(result.body as CheckoutResponse), variantId: variant.variantId } as CheckoutResponse & {
    variantId: string;
  };
}

describe('duplicate delivery', () => {
  it('processes one of ten concurrent deliveries and acknowledges the rest', async () => {
    const order = (await placeOrder(5, 2)) as CheckoutResponse & { variantId: string };
    const event = paymentEvent(order);

    const results = await deliverWebhook(event, 10);

    // Every delivery is answered 200. A 500 to any of them would make the
    // gateway retry a payment it already delivered.
    expect(results.every((result) => result.status === 200)).toBe(true);
    expect(results.filter((result) => result.detail.includes('Duplicate'))).toHaveLength(9);
    expect(results.filter((result) => result.detail.includes('paid'))).toHaveLength(1);

    // Stock moved exactly once.
    const stock = await stockOf(order.variantId);
    expect(stock.onHand).toBe(3);
    expect(stock.reserved).toBe(0);

    // One RESERVE, one FULFILL. Two FULFILL rows would be a double decrement.
    const ledger = await prisma.stockLedger.findMany({
      where: { variantId: order.variantId },
      select: { kind: true },
    });
    expect(ledger.filter((row) => row.kind === 'FULFILL')).toHaveLength(1);

    const totals = await ledgerTotals(order.variantId);
    expect(totals.onHand).toBe(-2);
    expect(totals.reserved).toBe(0);

    const orderRow = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } });
    expect(orderRow.status).toBe('PAID');
    expect(orderRow.paidAt).not.toBeNull();

    const payments = await prisma.payment.findMany({ where: { orderId: order.orderId } });
    expect(payments).toHaveLength(1);
    expect(payments[0]!.status).toBe('SUCCEEDED');

    // Exactly one dedupe row for one event id.
    expect(await prisma.webhookEvent.count({ where: { eventId: event.id } })).toBe(1);
  });

  it('ignores a replay of the same event id after the first has committed', async () => {
    const order = (await placeOrder(4, 1)) as CheckoutResponse & { variantId: string };
    const event = paymentEvent(order);

    await deliverWebhook(event, 1);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const replay = await deliverWebhook(event, 1);

    expect(replay[0]!.status).toBe(200);
    expect(replay[0]!.detail).toContain('Duplicate');
    expect((await stockOf(order.variantId)).onHand).toBe(3);
  });

  it('ignores a fresh event id for an order that is already paid', async () => {
    // Layer 2, in isolation: the dedupe table cannot help here because the event
    // id is genuinely new. The guarded UPDATE is what refuses.
    const order = (await placeOrder(4, 1)) as CheckoutResponse & { variantId: string };

    await deliverWebhook(paymentEvent(order), 1);
    const second = await deliverWebhook(paymentEvent(order), 1);

    expect(second[0]!.status).toBe(200);
    expect(second[0]!.detail).toContain('already transitioned');

    const ledger = await prisma.stockLedger.findMany({
      where: { variantId: order.variantId, kind: 'FULFILL' },
    });
    expect(ledger).toHaveLength(1);
  });
});

describe('out-of-order and unknown events', () => {
  it('asks for a retry when the order does not exist, instead of acknowledging it', async () => {
    // Acknowledging would drop a real payment on the floor: the gateway would
    // never send it again and the customer would be charged for nothing.
    const order = (await placeOrder(3, 1)) as CheckoutResponse & { variantId: string };
    const orphan = paymentEvent({
      ...order,
      orderId: 'cl00000000000000000000000',
      sessionId: 'cs_mock_does_not_exist',
    } as CheckoutResponse);

    const results = await deliverWebhook(orphan, 1);
    expect(results[0]!.status).toBe(503);

    // The dedupe row must have rolled back with the transaction, or the retry
    // would be swallowed as a duplicate and the payment lost for good.
    expect(await prisma.webhookEvent.count({ where: { eventId: orphan.id } })).toBe(0);
  });

  it('acknowledges payment_intent.succeeded without paying the order', async () => {
    // For Checkout Sessions the session event is authoritative. Acting on the
    // intent would race the session bookkeeping for no benefit.
    const order = (await placeOrder(3, 1)) as CheckoutResponse & { variantId: string };
    const results = await deliverWebhook(paymentEvent(order, { type: 'payment_intent.succeeded' }), 1);

    expect(results[0]!.status).toBe(200);
    expect(results[0]!.detail).toContain('No action');

    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } });
    expect(row.status).toBe('PENDING');
    expect((await stockOf(order.variantId)).reserved).toBe(1);
  });

  it('resolves the order from the session id when metadata carries none', async () => {
    const order = (await placeOrder(3, 1)) as CheckoutResponse & { variantId: string };
    const event = paymentEvent(order);
    // A provider event that lost the metadata. The Payment row's session id is
    // the fallback route, which is why it is stored at all.
    event.data.orderId = 'cl00000000000000000000000';

    const results = await deliverWebhook(event, 1);
    expect(results[0]!.status).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } })).status).toBe('PAID');
  });

  it('releases the reservation on an expired session', async () => {
    const order = (await placeOrder(3, 2)) as CheckoutResponse & { variantId: string };
    expect((await stockOf(order.variantId)).reserved).toBe(2);

    const results = await deliverWebhook(paymentEvent(order, { type: 'checkout.session.expired' }), 1);
    expect(results[0]!.status).toBe(200);

    const stock = await stockOf(order.variantId);
    expect(stock.reserved).toBe(0);
    expect(stock.onHand).toBe(3); // nothing shipped
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } })).status).toBe('EXPIRED');
  });

  it('leaves the order PENDING on a failed payment so the customer can retry', async () => {
    const order = (await placeOrder(3, 1)) as CheckoutResponse & { variantId: string };
    const results = await deliverWebhook(
      paymentEvent(order, { type: 'payment_intent.payment_failed' }),
      1,
    );

    expect(results[0]!.status).toBe(200);
    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } });
    expect(row.status).toBe('PENDING');
    // The reservation stays: cancelling it would drop the stock the customer is
    // about to pay for with another card. The TTL handles it if they do not.
    expect((await stockOf(order.variantId)).reserved).toBe(1);

    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.orderId } });
    expect(payment.status).toBe('FAILED');
  });

  it('ignores a late payment event against a terminal order', async () => {
    const order = (await placeOrder(3, 1)) as CheckoutResponse & { variantId: string };
    await deliverWebhook(paymentEvent(order, { type: 'checkout.session.expired' }), 1);

    const late = await deliverWebhook(paymentEvent(order), 1);
    expect(late[0]!.status).toBe(200);
    expect(late[0]!.detail).toContain('EXPIRED');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } })).status).toBe('EXPIRED');
  });
});

describe('signature verification', () => {
  it('rejects an unsigned request with 400, not a retryable status', async () => {
    const order = (await placeOrder(3, 1)) as CheckoutResponse & { variantId: string };
    const { body } = buildMockWebhookRequest(paymentEvent(order), MOCK_SECRET);

    const response = await fetch(`${API_BASE_URL}/webhooks/mock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    // 400 because a missing signature will still be missing on the retry.
    expect(response.status).toBe(400);
  });

  it('rejects a body tampered with after signing', async () => {
    const order = (await placeOrder(3, 1)) as CheckoutResponse & { variantId: string };
    const { body, signature } = buildMockWebhookRequest(paymentEvent(order), MOCK_SECRET);

    const response = await fetch(`${API_BASE_URL}/webhooks/mock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: signature },
      body: body.replace(/"amountCents":\d+/, '"amountCents":1'),
    });
    expect(response.status).toBe(400);
    expect((await stockOf(order.variantId)).reserved).toBe(1);
  });

  it('rejects a signature made with the wrong secret', async () => {
    const order = (await placeOrder(3, 1)) as CheckoutResponse & { variantId: string };
    const { body } = buildMockWebhookRequest(paymentEvent(order), MOCK_SECRET);
    const { signature } = buildMockWebhookRequest(
      paymentEvent(order),
      'a-completely-different-secret-value-32',
    );

    const response = await fetch(`${API_BASE_URL}/webhooks/mock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: signature },
      body,
    });
    expect(response.status).toBe(400);
  });

  it('refuses the stripe endpoint while the mock driver is active', async () => {
    // The endpoint for the inactive driver must accept nothing. Otherwise a
    // Stripe deploy would still honour mock webhooks signed with a secret that
    // has leaked into a repo somewhere.
    const response = await fetch(`${API_BASE_URL}/webhooks/stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=abc' },
      body: '{}',
    });
    expect(response.status).toBe(400);
  });
});

describe('the database refuses a second successful payment', () => {
  it('rejects a second SUCCEEDED payment row for one order', async () => {
    const order = (await placeOrder(3, 1)) as CheckoutResponse & { variantId: string };
    await deliverWebhook(paymentEvent(order), 1);

    // The partial unique index is the backstop behind the application logic.
    // Prisma reports the offending column rather than the index name, so the
    // assertion is on the error code and the field, which is what identifies it.
    const second = prisma.payment.create({
      data: {
        orderId: order.orderId,
        provider: 'mock',
        sessionId: `cs_mock_${randomUUID().replace(/-/g, '')}`,
        status: 'SUCCEEDED',
        amountCents: order.totalCents,
        currency: order.currency,
      },
    });

    await expect(second).rejects.toMatchObject({ code: 'P2002' });
    await expect(second).rejects.toThrow(/order_id/);

    // A second PENDING payment is fine: a customer retrying checkout creates a
    // new session, and the index only forbids a second *successful* one.
    const pending = await prisma.payment.create({
      data: {
        orderId: order.orderId,
        provider: 'mock',
        sessionId: `cs_mock_${randomUUID().replace(/-/g, '')}`,
        status: 'PENDING',
        amountCents: order.totalCents,
        currency: order.currency,
      },
    });
    expect(pending.status).toBe('PENDING');
  });
});
