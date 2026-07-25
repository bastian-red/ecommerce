/**
 * The payment gateway contract. Everything upstream of this file talks to a
 * `PaymentGateway`; nothing upstream of it imports `stripe`.
 *
 * Two drivers implement it. `stripe` is what production runs. `mock` is a
 * self-hosted fake that speaks the same webhook dialect (HMAC-signed body,
 * `t=<unix>,v1=<hex>` header, replayable event ids) so CI and the E2E suite can
 * force duplicates, replays, out-of-order delivery and declines without a Stripe
 * account, without network, and without a tunnel.
 *
 * The point of the seam is not portability for its own sake. It is that the
 * idempotency guarantee this project exists to demonstrate has to be provable in
 * CI, and it cannot be if proving it requires a third party's retry scheduler.
 */

export type PaymentDriverName = 'stripe' | 'mock';

export interface PaymentsConfig {
  driver: PaymentDriverName;
  /** Required when driver is 'stripe'. */
  secretKey?: string;
  /** Required when driver is 'stripe'. */
  webhookSecret?: string;
  /** Required when driver is 'mock'. Signs and verifies the fake webhooks. */
  mockSecret?: string;
  /** Base URL of the web app, where the mock checkout page lives. */
  appBaseUrl: string;
  currency: string;
}

export interface CheckoutLineItem {
  name: string;
  /** Variant name, shown under the product on the gateway's page. */
  description?: string;
  unitPriceCents: number;
  quantity: number;
}

export interface CheckoutParams {
  orderId: string;
  orderNumber: string;
  email: string;
  currency: string;
  lineItems: CheckoutLineItem[];
  /**
   * Shipping and tax are passed as their own amounts rather than folded into a
   * line price, so the gateway's receipt matches the order's breakdown exactly.
   */
  shippingCents: number;
  taxCents: number;
  successUrl: string;
  cancelUrl: string;
  /** The gateway abandons the session at this instant, matching the reservation TTL. */
  expiresAt: Date;
}

export interface CheckoutResult {
  sessionId: string;
  url: string;
}

/**
 * Normalized webhook, driver-independent. The API's handler only ever sees this
 * shape, so the Stripe and mock paths exercise identical code after verification.
 */
export interface ParsedWebhook {
  /** Provider's event id. This is the idempotency key. */
  eventId: string;
  type: string;
  /** Our order id, carried in session metadata. */
  orderId?: string;
  sessionId?: string;
  paymentIntentId?: string;
  amountCents?: number;
  currency?: string;
  /** True when this event means the money is captured and the order can be PAID. */
  isPaymentComplete: boolean;
  /** True when the payment definitively failed and the reservation can be released. */
  isPaymentFailed: boolean;
  /** True when the gateway session lapsed without payment. */
  isSessionExpired: boolean;
}

export interface PaymentGateway {
  readonly name: PaymentDriverName;
  createCheckoutSession(params: CheckoutParams): Promise<CheckoutResult>;
  /**
   * Verify the provider's signature over the raw body and return the normalized
   * event. Throws `WebhookSignatureError` when the signature does not check out;
   * the caller turns that into a 400, never a retryable 5xx, because a bad
   * signature will never become good on retry.
   */
  verifyWebhook(rawBody: Buffer | string, signature: string): ParsedWebhook;
}

export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

export class PaymentsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentsConfigError';
  }
}
