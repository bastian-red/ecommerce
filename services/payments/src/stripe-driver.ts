/**
 * The Stripe driver. The only file in the repo that imports `stripe`.
 *
 * Everything specific to Stripe stops here: the SDK, the API version pin, the
 * session shape, the signature scheme. Upstream sees `PaymentGateway` and
 * `ParsedWebhook`, which is why the mock can stand in for it in CI without the
 * handler noticing.
 */
import Stripe from 'stripe';
import {
  PaymentsConfigError,
  WebhookSignatureError,
  type CheckoutParams,
  type CheckoutResult,
  type PaymentGateway,
  type ParsedWebhook,
} from './types';

/** Pinned deliberately: an unpinned API version changes payload shapes silently. */
export const STRIPE_API_VERSION = '2025-02-24.acacia';

/**
 * Pure mapping from a Stripe event to the normalized shape. No SDK calls, no
 * network, no signature: that is what lets the webhook handler's decision table
 * be unit-tested exhaustively.
 */
export function parseStripeEvent(event: Stripe.Event): ParsedWebhook {
  const base: ParsedWebhook = {
    eventId: event.id,
    type: event.type,
    isPaymentComplete: false,
    isPaymentFailed: false,
    isSessionExpired: false,
  };

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    return {
      ...base,
      orderId: session.metadata?.orderId ?? undefined,
      sessionId: session.id,
      paymentIntentId: idOf(session.payment_intent),
      amountCents: session.amount_total ?? undefined,
      currency: session.currency ?? undefined,
      // 'paid' covers one-time payments; 'no_payment_required' covers a fully
      // discounted order, which is still a completed sale and must ship.
      isPaymentComplete:
        session.payment_status === 'paid' || session.payment_status === 'no_payment_required',
    };
  }

  if (event.type === 'checkout.session.expired') {
    const session = event.data.object as Stripe.Checkout.Session;
    return {
      ...base,
      orderId: session.metadata?.orderId ?? undefined,
      sessionId: session.id,
      isSessionExpired: true,
    };
  }

  if (event.type === 'payment_intent.payment_failed') {
    const intent = event.data.object as Stripe.PaymentIntent;
    return {
      ...base,
      orderId: intent.metadata?.orderId ?? undefined,
      paymentIntentId: intent.id,
      amountCents: intent.amount ?? undefined,
      currency: intent.currency ?? undefined,
      isPaymentFailed: true,
    };
  }

  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object as Stripe.PaymentIntent;
    // Deliberately NOT treated as payment completion. For Checkout Sessions the
    // authoritative event is checkout.session.completed; payment_intent.succeeded
    // can arrive first and carries no session id, so acting on it would race the
    // session bookkeeping for no benefit. It is normalized so the handler can log
    // and acknowledge it rather than 500 on an unknown type.
    return {
      ...base,
      orderId: intent.metadata?.orderId ?? undefined,
      paymentIntentId: intent.id,
      amountCents: intent.amount ?? undefined,
      currency: intent.currency ?? undefined,
    };
  }

  return base;
}

function idOf(value: string | { id: string } | null | undefined): string | undefined {
  if (!value) return undefined;
  return typeof value === 'string' ? value : value.id;
}

export interface StripeDriverOptions {
  secretKey: string;
  webhookSecret: string;
  currency: string;
  /** Injectable for tests; production leaves it undefined. */
  client?: Stripe;
}

export function createStripeGateway(options: StripeDriverOptions): PaymentGateway {
  if (!options.secretKey) {
    throw new PaymentsConfigError('STRIPE_SECRET_KEY is required when PAYMENTS_DRIVER=stripe');
  }
  if (!options.webhookSecret) {
    throw new PaymentsConfigError('STRIPE_WEBHOOK_SECRET is required when PAYMENTS_DRIVER=stripe');
  }

  const stripe =
    options.client ?? new Stripe(options.secretKey, { apiVersion: STRIPE_API_VERSION });

  return {
    name: 'stripe',

    async createCheckoutSession(params: CheckoutParams): Promise<CheckoutResult> {
      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = params.lineItems.map(
        (item) => ({
          quantity: item.quantity,
          price_data: {
            currency: params.currency,
            unit_amount: item.unitPriceCents,
            product_data: {
              name: item.name,
              ...(item.description ? { description: item.description } : {}),
            },
          },
        }),
      );

      // Tax and shipping ride as their own lines so the Stripe receipt totals
      // match the order row cent for cent. Anything else and support tickets
      // start with "your email says a different number".
      if (params.shippingCents > 0) {
        lineItems.push({
          quantity: 1,
          price_data: {
            currency: params.currency,
            unit_amount: params.shippingCents,
            product_data: { name: 'Shipping' },
          },
        });
      }
      if (params.taxCents > 0) {
        lineItems.push({
          quantity: 1,
          price_data: {
            currency: params.currency,
            unit_amount: params.taxCents,
            product_data: { name: 'Tax' },
          },
        });
      }

      const session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          customer_email: params.email,
          success_url: params.successUrl,
          cancel_url: params.cancelUrl,
          line_items: lineItems,
          // The order id must survive into every downstream event, so it goes on
          // both the session and the payment intent.
          metadata: { orderId: params.orderId, orderNumber: params.orderNumber },
          payment_intent_data: {
            metadata: { orderId: params.orderId, orderNumber: params.orderNumber },
          },
          expires_at: Math.floor(params.expiresAt.getTime() / 1000),
        },
        // Retrying checkout for the same order must not create a second session
        // and a second hold on the customer's card.
        { idempotencyKey: `checkout:${params.orderId}:${params.expiresAt.getTime()}` },
      );

      if (!session.url) {
        throw new Error('Stripe did not return a checkout URL');
      }
      return { sessionId: session.id, url: session.url };
    },

    verifyWebhook(rawBody: Buffer | string, signature: string): ParsedWebhook {
      try {
        const event = stripe.webhooks.constructEvent(rawBody, signature, options.webhookSecret);
        return parseStripeEvent(event);
      } catch (error) {
        // Normalized so the controller has one error type to map to 400,
        // whichever driver is active.
        throw new WebhookSignatureError(
          error instanceof Error ? error.message : 'Stripe signature verification failed',
        );
      }
    },
  };
}
