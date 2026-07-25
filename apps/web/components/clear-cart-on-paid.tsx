'use client';

import { useEffect } from 'react';
import { clearCart } from '../app/actions';

/**
 * Empty the cart once an order is confirmed paid.
 *
 * The cart cannot be cleared when checkout starts: the customer may cancel at
 * the gateway, and losing their basket at that point loses the sale. It cannot
 * be cleared by the webhook either, because a webhook knows about an order, not
 * about the browser's cart cookie.
 *
 * The confirmation page is the one moment both facts are in the same place: the
 * order is PAID and the caller holds the cart cookie. So it happens here, once,
 * on mount.
 */
export function ClearCartOnPaid() {
  useEffect(() => {
    void clearCart();
  }, []);
  return null;
}
