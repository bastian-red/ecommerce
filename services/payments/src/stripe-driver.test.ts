import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { createStripeGateway, parseStripeEvent } from './stripe-driver';
import { PaymentsConfigError, WebhookSignatureError, type CheckoutParams } from './types';

/**
 * These tests never touch the network. `parseStripeEvent` is pure, and the
 * client is injected for the session-creation cases, which is the whole reason
 * the mapping was split out from `verifyWebhook` in the first place.
 */

 
const stripeEvent = (type: string, object: any): Stripe.Event =>
  ({ id: 'evt_test_1', type, data: { object } }) as unknown as Stripe.Event;

describe('parseStripeEvent', () => {
  it('maps a paid checkout session to payment complete', () => {
    const parsed = parseStripeEvent(
      stripeEvent('checkout.session.completed', {
        id: 'cs_test_1',
        payment_status: 'paid',
        payment_intent: 'pi_test_1',
        amount_total: 35_561,
        currency: 'usd',
        metadata: { orderId: 'order_1' },
      }),
    );
    expect(parsed).toEqual({
      eventId: 'evt_test_1',
      type: 'checkout.session.completed',
      orderId: 'order_1',
      sessionId: 'cs_test_1',
      paymentIntentId: 'pi_test_1',
      amountCents: 35_561,
      currency: 'usd',
      isPaymentComplete: true,
      isPaymentFailed: false,
      isSessionExpired: false,
    });
  });

  it('treats no_payment_required as complete, because a free order still ships', () => {
    const parsed = parseStripeEvent(
      stripeEvent('checkout.session.completed', {
        id: 'cs_test_1',
        payment_status: 'no_payment_required',
        metadata: { orderId: 'order_1' },
      }),
    );
    expect(parsed.isPaymentComplete).toBe(true);
  });

  it('refuses to complete an unpaid session', () => {
    const parsed = parseStripeEvent(
      stripeEvent('checkout.session.completed', {
        id: 'cs_test_1',
        payment_status: 'unpaid',
        metadata: { orderId: 'order_1' },
      }),
    );
    expect(parsed.isPaymentComplete).toBe(false);
  });

  it('unwraps an expanded payment intent object', () => {
    const parsed = parseStripeEvent(
      stripeEvent('checkout.session.completed', {
        id: 'cs_test_1',
        payment_status: 'paid',
        payment_intent: { id: 'pi_expanded' },
        metadata: { orderId: 'order_1' },
      }),
    );
    expect(parsed.paymentIntentId).toBe('pi_expanded');
  });

  it('survives a session with no metadata rather than throwing', () => {
    const parsed = parseStripeEvent(
      stripeEvent('checkout.session.completed', { id: 'cs_test_1', payment_status: 'paid' }),
    );
    expect(parsed.orderId).toBeUndefined();
    expect(parsed.isPaymentComplete).toBe(true);
  });

  it('maps an expired session', () => {
    const parsed = parseStripeEvent(
      stripeEvent('checkout.session.expired', {
        id: 'cs_test_1',
        metadata: { orderId: 'order_1' },
      }),
    );
    expect(parsed.isSessionExpired).toBe(true);
    expect(parsed.isPaymentComplete).toBe(false);
  });

  it('maps a failed payment intent', () => {
    const parsed = parseStripeEvent(
      stripeEvent('payment_intent.payment_failed', {
        id: 'pi_test_1',
        amount: 1_000,
        currency: 'usd',
        metadata: { orderId: 'order_1' },
      }),
    );
    expect(parsed.isPaymentFailed).toBe(true);
    expect(parsed.paymentIntentId).toBe('pi_test_1');
  });

  it('does not complete an order on payment_intent.succeeded', () => {
    // The authoritative event for Checkout Sessions is the session one. Acting
    // on the intent would race the session bookkeeping and gains nothing.
    const parsed = parseStripeEvent(
      stripeEvent('payment_intent.succeeded', {
        id: 'pi_test_1',
        amount: 1_000,
        currency: 'usd',
        metadata: { orderId: 'order_1' },
      }),
    );
    expect(parsed.isPaymentComplete).toBe(false);
    expect(parsed.orderId).toBe('order_1');
  });

  it('normalizes an unrelated event to an inert result instead of throwing', () => {
    const parsed = parseStripeEvent(stripeEvent('customer.created', { id: 'cus_1' }));
    expect(parsed).toMatchObject({
      eventId: 'evt_test_1',
      type: 'customer.created',
      isPaymentComplete: false,
      isPaymentFailed: false,
      isSessionExpired: false,
    });
  });
});

describe('createStripeGateway', () => {
  const params: CheckoutParams = {
    orderId: 'order_1',
    orderNumber: 'SHOP-1001',
    email: 'buyer@example.com',
    currency: 'usd',
    lineItems: [{ name: 'Ear One', description: 'White', unitPriceCents: 14_900, quantity: 2 }],
    shippingCents: 599,
    taxCents: 2_643,
    successUrl: 'http://localhost:3000/orders/order_1',
    cancelUrl: 'http://localhost:3000/cart',
    expiresAt: new Date('2026-07-25T12:15:00.000Z'),
  };

  function fakeStripe(sessionOverrides: Record<string, unknown> = {}) {
    const create = vi.fn().mockResolvedValue({
      id: 'cs_test_1',
      url: 'https://checkout.stripe.com/c/pay/cs_test_1',
      ...sessionOverrides,
    });
    const constructEvent = vi.fn();
    return {
      client: { checkout: { sessions: { create } }, webhooks: { constructEvent } } as unknown as Stripe,
      create,
      constructEvent,
    };
  }

  it('refuses to start without a secret key', () => {
    expect(() =>
      createStripeGateway({ secretKey: '', webhookSecret: 'whsec', currency: 'usd' }),
    ).toThrow(PaymentsConfigError);
  });

  it('refuses to start without a webhook secret', () => {
    expect(() =>
      createStripeGateway({ secretKey: 'sk', webhookSecret: '', currency: 'usd' }),
    ).toThrow(PaymentsConfigError);
  });

  it('sends shipping and tax as their own lines so the receipt matches the order', async () => {
    const { client, create } = fakeStripe();
    const gateway = createStripeGateway({
      secretKey: 'sk_test',
      webhookSecret: 'whsec_test',
      currency: 'usd',
      client,
    });
    await gateway.createCheckoutSession(params);

    const [body] = create.mock.calls[0] as [Record<string, any>];
    const names = body.line_items.map((item: any) => item.price_data.product_data.name);
    expect(names).toEqual(['Ear One', 'Shipping', 'Tax']);
    const total = body.line_items.reduce(
      (sum: number, item: any) => sum + item.price_data.unit_amount * item.quantity,
      0,
    );
    expect(total).toBe(14_900 * 2 + 599 + 2_643);
  });

  it('omits zero shipping and zero tax lines', async () => {
    const { client, create } = fakeStripe();
    const gateway = createStripeGateway({
      secretKey: 'sk_test',
      webhookSecret: 'whsec_test',
      currency: 'usd',
      client,
    });
    await gateway.createCheckoutSession({ ...params, shippingCents: 0, taxCents: 0 });
    const [body] = create.mock.calls[0] as [Record<string, any>];
    expect(body.line_items).toHaveLength(1);
  });

  it('carries the order id on both the session and the payment intent', async () => {
    const { client, create } = fakeStripe();
    const gateway = createStripeGateway({
      secretKey: 'sk_test',
      webhookSecret: 'whsec_test',
      currency: 'usd',
      client,
    });
    await gateway.createCheckoutSession(params);
    const [body] = create.mock.calls[0] as [Record<string, any>];
    expect(body.metadata.orderId).toBe('order_1');
    expect(body.payment_intent_data.metadata.orderId).toBe('order_1');
  });

  it('passes an idempotency key so a retried checkout cannot double-hold the card', async () => {
    const { client, create } = fakeStripe();
    const gateway = createStripeGateway({
      secretKey: 'sk_test',
      webhookSecret: 'whsec_test',
      currency: 'usd',
      client,
    });
    await gateway.createCheckoutSession(params);
    const [, options] = create.mock.calls[0] as [unknown, Record<string, any>];
    expect(options.idempotencyKey).toBe(`checkout:order_1:${params.expiresAt.getTime()}`);
  });

  it('expires the session at the reservation deadline', async () => {
    const { client, create } = fakeStripe();
    const gateway = createStripeGateway({
      secretKey: 'sk_test',
      webhookSecret: 'whsec_test',
      currency: 'usd',
      client,
    });
    await gateway.createCheckoutSession(params);
    const [body] = create.mock.calls[0] as [Record<string, any>];
    expect(body.expires_at).toBe(Math.floor(params.expiresAt.getTime() / 1000));
  });

  it('throws when Stripe returns a session with no URL', async () => {
    const { client } = fakeStripe({ url: null });
    const gateway = createStripeGateway({
      secretKey: 'sk_test',
      webhookSecret: 'whsec_test',
      currency: 'usd',
      client,
    });
    await expect(gateway.createCheckoutSession(params)).rejects.toThrow(/checkout URL/);
  });

  it('normalizes a signature failure to WebhookSignatureError', () => {
    const { client, constructEvent } = fakeStripe();
    constructEvent.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature for payload');
    });
    const gateway = createStripeGateway({
      secretKey: 'sk_test',
      webhookSecret: 'whsec_test',
      currency: 'usd',
      client,
    });
    expect(() => gateway.verifyWebhook('{}', 'bad')).toThrow(WebhookSignatureError);
  });

  it('returns the parsed event when the signature checks out', () => {
    const { client, constructEvent } = fakeStripe();
    constructEvent.mockReturnValue(
      stripeEvent('checkout.session.completed', {
        id: 'cs_test_1',
        payment_status: 'paid',
        metadata: { orderId: 'order_1' },
      }),
    );
    const gateway = createStripeGateway({
      secretKey: 'sk_test',
      webhookSecret: 'whsec_test',
      currency: 'usd',
      client,
    });
    expect(gateway.verifyWebhook('{}', 'good').orderId).toBe('order_1');
  });
});
