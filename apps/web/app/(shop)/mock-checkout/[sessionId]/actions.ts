'use server';

import { buildMockWebhookRequest, SIGNATURE_HEADER, type MockEvent } from '@shop/payments/mock';
import { randomUUID } from 'node:crypto';
import { API_BASE_URL } from '@/lib/config';

/**
 * The mock gateway's callback. This is what a real provider's webhook sender
 * does, run from our own server.
 *
 * `deliveries` and `eventId` are parameters, not constants, because the whole
 * reason the mock exists is to let the E2E suite reproduce what Stripe will not
 * do on demand: the same event delivered twenty times at once, an event replayed
 * an hour later, an event arriving for an order that no longer exists.
 */
export async function deliverMockWebhook(input: {
  sessionId: string;
  orderId: string;
  amountCents: number;
  currency: string;
  approve: boolean;
  /** How many times to POST the same event. Defaults to one, like a real gateway. */
  deliveries?: number;
  /** Reuse an event id to force a replay. Defaults to a fresh one. */
  eventId?: string;
}): Promise<{ statuses: number[] }> {
  const secret = process.env.MOCK_WEBHOOK_SECRET;
  if (!secret) throw new Error('MOCK_WEBHOOK_SECRET is not set');

  const event: MockEvent = {
    id: input.eventId ?? `evt_mock_${randomUUID().replace(/-/g, '')}`,
    type: input.approve ? 'checkout.session.completed' : 'payment_intent.payment_failed',
    created: Math.floor(Date.now() / 1000),
    data: {
      sessionId: input.sessionId,
      orderId: input.orderId,
      paymentIntentId: `pi_mock_${input.sessionId.slice(-16)}`,
      amountCents: input.amountCents,
      currency: input.currency,
    },
  };

  const { body, signature } = buildMockWebhookRequest(event, secret);
  const deliveries = Math.max(1, Math.min(input.deliveries ?? 1, 50));

  // Fired concurrently on purpose: sequential duplicates would only exercise the
  // easy path where the first delivery has already committed.
  const responses = await Promise.all(
    Array.from({ length: deliveries }, () =>
      fetch(`${API_BASE_URL}/webhooks/mock`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: signature },
        body,
        cache: 'no-store',
      }),
    ),
  );

  return { statuses: responses.map((response) => response.status) };
}
