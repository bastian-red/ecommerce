import { PrismaClient } from '@shop/db';
import { buildMockWebhookRequest, SIGNATURE_HEADER, type MockEvent } from '@shop/payments/mock';
import { randomUUID } from 'node:crypto';

/**
 * Shared fixtures for the integration suite.
 *
 * These tests run against a real Postgres and a real Redis, because the
 * properties under test are properties of Postgres: a conditional UPDATE's
 * rowcount, a primary key's behaviour under concurrent insert, a CHECK
 * constraint's refusal to commit. Mocking the database would mean testing the
 * mock's opinion of those, which is worth nothing.
 */

export const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000';
export const MOCK_SECRET = process.env.MOCK_WEBHOOK_SECRET ?? 'mock-webhook-secret-at-least-32-chars';

export const prisma = new PrismaClient();

/** A cart id matching the pattern the API enforces. */
export function newCartId(): string {
  return randomUUID().replace(/-/g, '') + 'aa';
}

export interface TestVariant {
  productId: string;
  variantId: string;
  sku: string;
  priceCents: number;
}

/**
 * Create an isolated product with a known stock level.
 *
 * Every test makes its own product rather than sharing the seed data. Two tests
 * racing the same variant would make failures depend on execution order, which
 * is precisely the class of bug this suite exists to catch.
 */
export async function createTestVariant(stockOnHand: number, priceCents = 1_000): Promise<TestVariant> {
  const suffix = randomUUID().slice(0, 8);
  const product = await prisma.product.create({
    data: {
      slug: `test-${suffix}`,
      title: `Test Product ${suffix}`,
      description: 'Created by the integration suite.',
      status: 'ACTIVE',
      variants: {
        create: {
          sku: `TEST-${suffix.toUpperCase()}`,
          name: 'Default',
          priceCents,
          stockOnHand,
          stockReserved: 0,
        },
      },
    },
    include: { variants: true },
  });
  const variant = product.variants[0]!;
  return { productId: product.id, variantId: variant.id, sku: variant.sku, priceCents };
}

export async function stockOf(variantId: string): Promise<{ onHand: number; reserved: number }> {
  const variant = await prisma.productVariant.findUniqueOrThrow({
    where: { id: variantId },
    select: { stockOnHand: true, stockReserved: true },
  });
  return { onHand: variant.stockOnHand, reserved: variant.stockReserved };
}

/**
 * Replay the ledger from zero. It must reconstruct the stored counters exactly;
 * a mismatch means a write bypassed the ledger, which is how a lost update would
 * show up.
 */
export async function ledgerTotals(variantId: string): Promise<{ onHand: number; reserved: number }> {
  const rows = await prisma.stockLedger.findMany({
    where: { variantId },
    select: { onHandDelta: true, reservedDelta: true },
  });
  return rows.reduce(
    (total, row) => ({
      onHand: total.onHand + row.onHandDelta,
      reserved: total.reserved + row.reservedDelta,
    }),
    { onHand: 0, reserved: 0 },
  );
}

export async function addToCart(cartId: string, variantId: string, quantity: number): Promise<Response> {
  return fetch(`${API_BASE_URL}/cart/lines`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cart-id': cartId },
    body: JSON.stringify({ variantId, quantity }),
  });
}

export interface CheckoutResponse {
  orderId: string;
  orderNumber: string;
  sessionId: string;
  totalCents: number;
  currency: string;
}

export async function checkout(
  cartId: string,
  email = 'buyer@example.com',
): Promise<{ status: number; body: CheckoutResponse | { message?: unknown } }> {
  const response = await fetch(`${API_BASE_URL}/checkout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cart-id': cartId },
    body: JSON.stringify({
      email,
      shippingAddress: {
        name: 'Ada Lovelace',
        line1: '1 Analytical Way',
        city: 'London',
        postalCode: 'E1 6AN',
        country: 'GB',
      },
    }),
  });
  return { status: response.status, body: await response.json() };
}

export function paymentEvent(order: CheckoutResponse, overrides: Partial<MockEvent> = {}): MockEvent {
  return {
    id: `evt_test_${randomUUID().replace(/-/g, '')}`,
    type: 'checkout.session.completed',
    created: Math.floor(Date.now() / 1000),
    data: {
      sessionId: order.sessionId,
      orderId: order.orderId,
      paymentIntentId: `pi_test_${randomUUID().slice(0, 12)}`,
      amountCents: order.totalCents,
      currency: order.currency,
    },
    ...overrides,
  };
}

export async function deliverWebhook(
  event: MockEvent,
  times = 1,
): Promise<Array<{ status: number; detail: string }>> {
  const { body, signature } = buildMockWebhookRequest(event, MOCK_SECRET);
  const responses = await Promise.all(
    Array.from({ length: times }, () =>
      fetch(`${API_BASE_URL}/webhooks/mock`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: signature },
        body,
      }),
    ),
  );
  return Promise.all(
    responses.map(async (response) => {
      const parsed = (await response.json()) as { detail?: string; message?: string };
      return { status: response.status, detail: parsed.detail ?? parsed.message ?? '' };
    }),
  );
}

/** Delete everything a test created, in foreign-key order. */
export async function cleanupProduct(productId: string): Promise<void> {
  const variants = await prisma.productVariant.findMany({
    where: { productId },
    select: { id: true },
  });
  const variantIds = variants.map((variant) => variant.id);
  const orderIds = (
    await prisma.orderItem.findMany({
      where: { variantId: { in: variantIds } },
      select: { orderId: true },
    })
  ).map((item) => item.orderId);

  await prisma.stockLedger.deleteMany({ where: { variantId: { in: variantIds } } });
  await prisma.webhookEvent.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.productVariant.deleteMany({ where: { productId } });
  await prisma.product.delete({ where: { id: productId } }).catch(() => undefined);
}

/** Wait until the API answers /health, so a suite never races a cold start. */
export async function waitForApi(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${API_BASE_URL}/health`);
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`API did not become healthy at ${API_BASE_URL} within ${timeoutMs}ms`);
}
