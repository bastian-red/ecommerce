'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { removeFromCart, setCartQuantity } from '../app/actions';

/**
 * Quantity stepper for a cart line. Every change is a server round trip on
 * purpose: the price, the totals and the availability all live server-side, and
 * optimistically updating a total the server has not agreed to is how a cart
 * ends up showing a number the checkout then contradicts.
 */
export function CartLineControls({
  variantId,
  quantity,
  max,
}: {
  variantId: string;
  quantity: number;
  max: number;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function change(next: number) {
    startTransition(async () => {
      if (next <= 0) await removeFromCart(variantId);
      else await setCartQuantity(variantId, Math.min(next, Math.max(max, 1)));
      router.refresh();
    });
  }

  return (
    <div className="row">
      <div className="qty">
        <button
          type="button"
          onClick={() => change(quantity - 1)}
          disabled={pending}
          aria-label="Decrease quantity"
        >
          -
        </button>
        <span className="value" data-testid="line-quantity">
          {quantity}
        </span>
        <button
          type="button"
          onClick={() => change(quantity + 1)}
          disabled={pending || quantity >= max}
          aria-label="Increase quantity"
        >
          +
        </button>
      </div>
      <button
        type="button"
        className="btn"
        onClick={() => change(0)}
        disabled={pending}
        data-testid="remove-line"
      >
        Remove
      </button>
    </div>
  );
}
