'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { adminFulfillOrder } from '../app/actions';

export function FulfillButton({ orderId, number }: { orderId: string; number: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <>
      <button
        type="button"
        className="btn"
        disabled={pending}
        data-testid={`fulfill-${number}`}
        onClick={() =>
          startTransition(async () => {
            const result = await adminFulfillOrder(orderId);
            if (result.error) setError(result.error);
            else router.refresh();
          })
        }
      >
        {pending ? 'Working…' : 'Mark fulfilled'}
      </button>
      {error && <span className="error">{error}</span>}
    </>
  );
}
