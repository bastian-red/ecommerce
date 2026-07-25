'use client';

import type { CheckoutError } from '@shop/shared';
import { useState, useTransition } from 'react';
import { startCheckout } from '../app/actions';

/**
 * The checkout form.
 *
 * `INSUFFICIENT_STOCK` comes back as structured detail rather than a string, so
 * the customer is told exactly which item ran out and how many are left. "An
 * error occurred" on a checkout page is a customer who leaves.
 */
export function CheckoutForm({ defaultEmail }: { defaultEmail: string }) {
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<CheckoutError['details']>([]);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    setError(null);
    setDetails([]);
    startTransition(async () => {
      // On success this never returns: the action redirects to the gateway.
      const result = await startCheckout(formData);
      if (result?.checkoutError) {
        setError(result.checkoutError.message);
        setDetails(result.checkoutError.details);
      } else if (result?.error) {
        setError(result.error);
      }
    });
  }

  return (
    <form action={submit}>
      <label htmlFor="email">Email</label>
      <input
        id="email"
        name="email"
        type="email"
        required
        defaultValue={defaultEmail}
        data-testid="checkout-email"
      />

      <label htmlFor="name">Full name</label>
      <input id="name" name="name" required data-testid="checkout-name" />

      <label htmlFor="line1">Address</label>
      <input id="line1" name="line1" required data-testid="checkout-line1" />

      <div className="row">
        <div style={{ flex: 1 }}>
          <label htmlFor="city">City</label>
          <input id="city" name="city" required data-testid="checkout-city" />
        </div>
        <div style={{ flex: 1 }}>
          <label htmlFor="postalCode">Postal code</label>
          <input id="postalCode" name="postalCode" required data-testid="checkout-postal" />
        </div>
      </div>

      <label htmlFor="country">Country (ISO 2)</label>
      <input
        id="country"
        name="country"
        required
        maxLength={2}
        minLength={2}
        defaultValue="CL"
        data-testid="checkout-country"
      />

      <button
        type="submit"
        className="btn btn-primary"
        style={{ marginTop: 24, width: '100%' }}
        disabled={pending}
        data-testid="place-order"
      >
        {pending ? 'Starting checkout…' : 'Pay now'}
      </button>

      {error && (
        <p className="error" role="alert" data-testid="checkout-error">
          {error}
        </p>
      )}
      {details.length > 0 && (
        <ul className="error" data-testid="stock-details">
          {details.map((detail) => (
            <li key={detail.variantId}>
              {detail.productTitle} ({detail.variantName}): asked for {detail.requested}, {detail.available} left
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
