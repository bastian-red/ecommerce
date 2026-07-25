/**
 * The mock gateway: a real gateway in every respect except that it never moves
 * money.
 *
 * It issues session ids, hosts a checkout page (in apps/web), and posts signed
 * webhooks back to the API. Because the E2E suite drives it directly, it can do
 * things Stripe will not do on demand: deliver the same event twenty times at
 * once, deliver `payment_intent.succeeded` before `checkout.session.completed`,
 * deliver an event for an order that no longer exists. Those are precisely the
 * cases the idempotency work exists to survive, so they have to be reachable in
 * CI rather than hoped about in production.
 *
 * Session state deliberately lives nowhere. Everything the checkout page and the
 * webhook need is encoded in the session id and the URL, so the mock needs no
 * store of its own and cannot drift out of sync with the order table.
 */
import { randomUUID } from 'node:crypto';
import { signPayload } from './signature';
import { verifySignature } from './signature';
import {
  PaymentsConfigError,
  WebhookSignatureError,
  type CheckoutParams,
  type CheckoutResult,
  type PaymentGateway,
  type ParsedWebhook,
} from './types';

/** Event types the mock emits. Names mirror Stripe's so the handler is shared. */
export const MOCK_EVENT_TYPES = [
  'checkout.session.completed',
  'checkout.session.expired',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
] as const;
export type MockEventType = (typeof MOCK_EVENT_TYPES)[number];

export interface MockEvent {
  id: string;
  type: MockEventType;
  created: number;
  data: {
    sessionId: string;
    orderId: string;
    paymentIntentId?: string;
    amountCents?: number;
    currency?: string;
  };
}

export function isMockEventType(value: string): value is MockEventType {
  return (MOCK_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Pure normalization, split from verification so idempotency can be unit-tested
 * without producing valid signatures.
 */
export function parseMockEvent(event: MockEvent): ParsedWebhook {
  return {
    eventId: event.id,
    type: event.type,
    orderId: event.data.orderId,
    sessionId: event.data.sessionId,
    paymentIntentId: event.data.paymentIntentId,
    amountCents: event.data.amountCents,
    currency: event.data.currency,
    isPaymentComplete: event.type === 'checkout.session.completed',
    isPaymentFailed: event.type === 'payment_intent.payment_failed',
    isSessionExpired: event.type === 'checkout.session.expired',
  };
}

function decodeMockEvent(raw: string): MockEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new WebhookSignatureError('Webhook body is not valid JSON');
  }
  const event = parsed as Partial<MockEvent>;
  if (
    typeof event?.id !== 'string' ||
    typeof event?.type !== 'string' ||
    !isMockEventType(event.type) ||
    typeof event?.data?.orderId !== 'string' ||
    typeof event?.data?.sessionId !== 'string'
  ) {
    throw new WebhookSignatureError('Webhook body is not a recognised mock event');
  }
  return event as MockEvent;
}

/**
 * Build a signed request for a mock event. Used by the mock checkout page and by
 * the E2E suite; exported so neither has to re-derive the header format.
 */
export function buildMockWebhookRequest(
  event: MockEvent,
  secret: string,
): { body: string; signature: string } {
  const body = JSON.stringify(event);
  return { body, signature: signPayload(body, secret) };
}

export interface MockDriverOptions {
  secret: string;
  appBaseUrl: string;
}

export function createMockGateway(options: MockDriverOptions): PaymentGateway {
  if (!options.secret) {
    throw new PaymentsConfigError('MOCK_WEBHOOK_SECRET is required when PAYMENTS_DRIVER=mock');
  }

  return {
    name: 'mock',

    async createCheckoutSession(params: CheckoutParams): Promise<CheckoutResult> {
      const sessionId = `cs_mock_${randomUUID().replace(/-/g, '')}`;
      const url = new URL(`/mock-checkout/${sessionId}`, options.appBaseUrl);
      // The page needs the order to render and to sign its callback; putting it
      // in the URL is what keeps the mock stateless.
      url.searchParams.set('order', params.orderId);
      url.searchParams.set('amount', String(totalOf(params)));
      url.searchParams.set('currency', params.currency);
      url.searchParams.set('success', params.successUrl);
      url.searchParams.set('cancel', params.cancelUrl);
      return { sessionId, url: url.toString() };
    },

    verifyWebhook(rawBody: Buffer | string, signature: string): ParsedWebhook {
      verifySignature(rawBody, signature, options.secret);
      const raw = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
      return parseMockEvent(decodeMockEvent(raw));
    },
  };
}

/** Gateway-side total: lines plus shipping plus tax, in cents. */
export function totalOf(params: CheckoutParams): number {
  const lines = params.lineItems.reduce(
    (sum, item) => sum + item.unitPriceCents * item.quantity,
    0,
  );
  return lines + params.shippingCents + params.taxCents;
}
