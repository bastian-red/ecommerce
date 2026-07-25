import { describe, expect, it } from 'vitest';
import {
  buildMockWebhookRequest,
  createMockGateway,
  isMockEventType,
  parseMockEvent,
  totalOf,
  type MockEvent,
} from './mock-driver';
import { signPayload } from './signature';
import { PaymentsConfigError, WebhookSignatureError, type CheckoutParams } from './types';

const SECRET = 'mock-webhook-secret-at-least-32-chars';
const gateway = createMockGateway({ secret: SECRET, appBaseUrl: 'http://localhost:3000' });

const params: CheckoutParams = {
  orderId: 'order_1',
  orderNumber: 'SHOP-1001',
  email: 'buyer@example.com',
  currency: 'usd',
  lineItems: [
    { name: 'Ear One', description: 'White', unitPriceCents: 14_900, quantity: 2 },
    { name: 'USB-C Cable', unitPriceCents: 2_900, quantity: 1 },
  ],
  shippingCents: 0,
  taxCents: 2_861,
  successUrl: 'http://localhost:3000/orders/order_1',
  cancelUrl: 'http://localhost:3000/cart',
  expiresAt: new Date('2026-07-25T12:15:00.000Z'),
};

const event = (over: Partial<MockEvent> = {}): MockEvent => ({
  id: 'evt_mock_1',
  type: 'checkout.session.completed',
  created: 1_800_000_000,
  data: {
    sessionId: 'cs_mock_abc',
    orderId: 'order_1',
    paymentIntentId: 'pi_mock_abc',
    amountCents: 35_561,
    currency: 'usd',
  },
  ...over,
});

describe('createMockGateway', () => {
  it('refuses to start without a signing secret', () => {
    expect(() => createMockGateway({ secret: '', appBaseUrl: 'http://x' })).toThrow(
      PaymentsConfigError,
    );
  });

  it('names itself so the API can branch on the active driver', () => {
    expect(gateway.name).toBe('mock');
  });
});

describe('createCheckoutSession', () => {
  it('returns a mock session id and a URL onto the mock checkout page', async () => {
    const result = await gateway.createCheckoutSession(params);
    expect(result.sessionId).toMatch(/^cs_mock_[0-9a-f]{32}$/);
    const url = new URL(result.url);
    expect(url.origin).toBe('http://localhost:3000');
    expect(url.pathname).toBe(`/mock-checkout/${result.sessionId}`);
    expect(url.searchParams.get('order')).toBe('order_1');
    expect(url.searchParams.get('currency')).toBe('usd');
  });

  it('encodes the total so the page needs no state of its own', async () => {
    const result = await gateway.createCheckoutSession(params);
    const amount = new URL(result.url).searchParams.get('amount');
    // 14900*2 + 2900 + 0 shipping + 2861 tax
    expect(amount).toBe('35561');
  });

  it('issues a fresh session id per call, like a real gateway', async () => {
    const [a, b] = await Promise.all([
      gateway.createCheckoutSession(params),
      gateway.createCheckoutSession(params),
    ]);
    expect(a.sessionId).not.toBe(b.sessionId);
  });
});

describe('totalOf', () => {
  it('sums lines, shipping and tax', () => {
    expect(totalOf({ ...params, shippingCents: 599 })).toBe(36_160);
  });
});

describe('parseMockEvent', () => {
  it('maps a completed session to payment complete', () => {
    expect(parseMockEvent(event())).toMatchObject({
      eventId: 'evt_mock_1',
      orderId: 'order_1',
      sessionId: 'cs_mock_abc',
      paymentIntentId: 'pi_mock_abc',
      amountCents: 35_561,
      isPaymentComplete: true,
      isPaymentFailed: false,
      isSessionExpired: false,
    });
  });

  it('maps a failed intent to payment failed and nothing else', () => {
    const parsed = parseMockEvent(event({ type: 'payment_intent.payment_failed' }));
    expect(parsed.isPaymentFailed).toBe(true);
    expect(parsed.isPaymentComplete).toBe(false);
  });

  it('maps an expired session to session expired', () => {
    const parsed = parseMockEvent(event({ type: 'checkout.session.expired' }));
    expect(parsed.isSessionExpired).toBe(true);
    expect(parsed.isPaymentComplete).toBe(false);
  });

  it('does not treat a succeeded intent as completion, matching the Stripe driver', () => {
    const parsed = parseMockEvent(event({ type: 'payment_intent.succeeded' }));
    expect(parsed.isPaymentComplete).toBe(false);
    expect(parsed.isPaymentFailed).toBe(false);
  });

  it('is pure: the same event maps identically every time', () => {
    expect(parseMockEvent(event())).toEqual(parseMockEvent(event()));
  });
});

describe('verifyWebhook', () => {
  it('accepts a request built by buildMockWebhookRequest', () => {
    const { body, signature } = buildMockWebhookRequest(event(), SECRET);
    expect(gateway.verifyWebhook(body, signature).eventId).toBe('evt_mock_1');
  });

  it('rejects a valid body signed with the wrong secret', () => {
    const { body } = buildMockWebhookRequest(event(), SECRET);
    const signature = signPayload(body, 'a-different-secret-at-least-32-chars');
    expect(() => gateway.verifyWebhook(body, signature)).toThrow(WebhookSignatureError);
  });

  it('rejects a body edited after signing', () => {
    const { body, signature } = buildMockWebhookRequest(event(), SECRET);
    const tampered = body.replace('order_1', 'order_2');
    expect(() => gateway.verifyWebhook(tampered, signature)).toThrow(WebhookSignatureError);
  });

  it('rejects a correctly signed body that is not JSON', () => {
    const body = 'not json';
    expect(() => gateway.verifyWebhook(body, signPayload(body, SECRET))).toThrow(/not valid JSON/);
  });

  it('rejects a correctly signed event of an unknown type', () => {
    const body = JSON.stringify({ ...event(), type: 'invoice.paid' });
    expect(() => gateway.verifyWebhook(body, signPayload(body, SECRET))).toThrow(
      /not a recognised mock event/,
    );
  });

  it('rejects a correctly signed event missing the order id', () => {
    const body = JSON.stringify({ ...event(), data: { sessionId: 'cs_mock_abc' } });
    expect(() => gateway.verifyWebhook(body, signPayload(body, SECRET))).toThrow(
      /not a recognised mock event/,
    );
  });

  it('accepts the identical request repeatedly, leaving de-duplication to the database', () => {
    // Verification is stateless on purpose. Replay protection is the webhook
    // events table's primary key, not the signature check.
    const { body, signature } = buildMockWebhookRequest(event(), SECRET);
    for (let i = 0; i < 5; i++) {
      expect(gateway.verifyWebhook(body, signature).eventId).toBe('evt_mock_1');
    }
  });

  it('accepts a Buffer body, which is what Nest hands the controller', () => {
    const { body, signature } = buildMockWebhookRequest(event(), SECRET);
    expect(gateway.verifyWebhook(Buffer.from(body, 'utf8'), signature).orderId).toBe('order_1');
  });
});

describe('isMockEventType', () => {
  it('recognises exactly the four emitted types', () => {
    expect(isMockEventType('checkout.session.completed')).toBe(true);
    expect(isMockEventType('payment_intent.succeeded')).toBe(true);
    expect(isMockEventType('charge.refunded')).toBe(false);
  });
});
