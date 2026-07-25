'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { adminChangeStock } from '../app/actions';

/**
 * Restock and correct a variant's stock.
 *
 * The input is a delta, never an absolute count. Two admins setting "12" from
 * two tabs silently lose one edit; two admins adding "+5" and "+3" both land.
 * The API enforces the same thing, so this is the UI agreeing with the contract
 * rather than the UI being the rule.
 */
export function StockControls({ variantId }: { variantId: string }) {
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function apply(kind: 'RESTOCK' | 'ADJUST') {
    setError(null);
    const delta = kind === 'RESTOCK' ? Math.abs(quantity) : quantity;
    if (delta === 0) {
      setError('A change of zero does nothing.');
      return;
    }
    startTransition(async () => {
      const result = await adminChangeStock(variantId, kind, delta, reason);
      if (result.error) setError(result.error);
      else {
        setReason('');
        router.refresh();
      }
    });
  }

  return (
    <div>
      <div className="row">
        <input
          type="number"
          value={quantity}
          onChange={(event) => setQuantity(Number(event.target.value))}
          style={{ width: 80 }}
          aria-label="Quantity"
          data-testid={`stock-qty-${variantId}`}
        />
        <input
          type="text"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Reason"
          style={{ width: 160 }}
          aria-label="Reason"
          data-testid={`stock-reason-${variantId}`}
        />
        <button
          type="button"
          className="btn"
          onClick={() => apply('RESTOCK')}
          disabled={pending}
          data-testid={`restock-${variantId}`}
        >
          Restock
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => apply('ADJUST')}
          disabled={pending}
          data-testid={`adjust-${variantId}`}
        >
          Adjust
        </button>
      </div>
      {error && (
        <p className="error" data-testid={`stock-error-${variantId}`}>
          {error}
        </p>
      )}
    </div>
  );
}
