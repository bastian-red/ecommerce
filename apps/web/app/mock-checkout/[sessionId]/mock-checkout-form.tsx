'use client';

import { formatMoney } from '@shop/shared';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deliverMockWebhook } from './actions';

/**
 * The fake gateway's payment page.
 *
 * The controls beyond "pay" and "decline" exist because they are the test
 * surface: delivering the same event N times at once, and replaying a previous
 * event id, are exactly the two things a real provider does under retry and that
 * the idempotency work has to survive. Making them clickable means they are
 * demonstrable in a browser, not just asserted in a test file.
 */
export function MockCheckoutForm({
  sessionId,
  orderId,
  amountCents,
  currency,
  successUrl,
  cancelUrl,
}: {
  sessionId: string;
  orderId: string;
  amountCents: number;
  currency: string;
  successUrl: string;
  cancelUrl: string;
}) {
  const [deliveries, setDeliveries] = useState(1);
  const [lastEventId, setLastEventId] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<number[] | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function pay(approve: boolean, replay: boolean) {
    startTransition(async () => {
      const eventId = replay && lastEventId ? lastEventId : `evt_mock_${crypto.randomUUID().replace(/-/g, '')}`;
      const result = await deliverMockWebhook({
        sessionId,
        orderId,
        amountCents,
        currency,
        approve,
        deliveries,
        eventId,
      });
      setLastEventId(eventId);
      setStatuses(result.statuses);
      if (approve && result.statuses.some((status) => status === 200)) {
        router.push(successUrl);
      }
    });
  }

  return (
    <div className="card">
      <h3>Mock gateway</h3>
      <p className="muted">
        No money moves here. This page signs a webhook exactly like the real provider and posts it
        to the API, so the whole payment path runs with no account and no tunnel.
      </p>

      <div className="summary-row total">
        <span>Amount due</span>
        <span data-testid="mock-amount">{formatMoney(amountCents, currency)}</span>
      </div>

      <div className="row" style={{ marginTop: 20 }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => pay(true, false)}
          disabled={pending}
          data-testid="mock-approve"
        >
          {pending ? 'Sending…' : 'Approve payment'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => pay(false, false)}
          disabled={pending}
          data-testid="mock-decline"
        >
          Decline
        </button>
        <a className="btn" href={cancelUrl} data-testid="mock-cancel">
          Cancel
        </a>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '24px 0' }} />

      <label htmlFor="deliveries">Deliveries per click (duplicate delivery test)</label>
      <input
        id="deliveries"
        type="number"
        min={1}
        max={50}
        value={deliveries}
        onChange={(event) => setDeliveries(Number(event.target.value))}
        data-testid="mock-deliveries"
      />
      <div className="row" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn"
          onClick={() => pay(true, true)}
          disabled={pending || !lastEventId}
          data-testid="mock-replay"
        >
          Replay last event id
        </button>
      </div>

      {statuses && (
        <p className="notice" style={{ marginTop: 16 }} data-testid="mock-statuses">
          {statuses.length} delivery/deliveries -&gt; {statuses.join(', ')}
        </p>
      )}
    </div>
  );
}
