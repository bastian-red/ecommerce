'use client';

import { formatMoney, type Product, type ProductVariant } from '@shop/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { addToCart } from '../app/actions';
import { PUBLIC_API_BASE_URL } from '../lib/config';

/**
 * Variant picker and add-to-cart.
 *
 * ## Why stock is re-fetched here
 *
 * The product page is ISR: its content is cached for up to a minute, which is
 * right for a title and a description and wrong for availability. A page that
 * says "1 left" about a variant that sold out forty seconds ago is exactly the
 * lie this project exists not to tell, and the reservation would fail at
 * checkout after the customer had filled in an address.
 *
 * So the cached render provides the initial numbers and this component replaces
 * them with live ones on mount. Content stays cacheable, stock stays true.
 *
 * The button is also disabled while the action is in flight. A double click
 * would post twice; the API and database would both survive it, but the customer
 * would find two of something in their cart and blame the shop.
 */
export function AddToCart({ variants: initial, slug }: { variants: ProductVariant[]; slug: string }) {
  const [variants, setVariants] = useState(initial);
  const purchasable = initial.filter((variant) => variant.availableStock > 0);
  const [selected, setSelected] = useState(purchasable[0]?.id ?? initial[0]?.id ?? '');
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    fetch(`${PUBLIC_API_BASE_URL}/products/${slug}`, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((product: Product | null) => {
        if (!cancelled && product) setVariants(product.variants);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const variant = variants.find((candidate) => candidate.id === selected);
  const max = Math.min(variant?.availableStock ?? 0, 99);
  const soldOut = !variant || variant.availableStock === 0;

  function submit() {
    if (!variant) return;
    setError(null);
    startTransition(async () => {
      const result = await addToCart(variant.id, Math.min(quantity, max));
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div>
      <div className="variant-list" role="radiogroup" aria-label="Variant">
        {variants.map((candidate) => {
          const out = candidate.availableStock === 0;
          return (
            <label
              key={candidate.id}
              className={`variant${out ? ' out' : ''}`}
              data-testid="variant-option"
              data-sku={candidate.sku}
            >
              <span className="row">
                <input
                  type="radio"
                  name="variant"
                  value={candidate.id}
                  checked={selected === candidate.id}
                  disabled={out}
                  onChange={() => {
                    setSelected(candidate.id);
                    setQuantity(1);
                  }}
                  style={{ width: 'auto' }}
                />
                <span>{candidate.name}</span>
              </span>
              <span className="row">
                <span className="price-sm">{formatMoney(candidate.priceCents)}</span>
                <span className="product-meta" data-testid="variant-stock">
                  {out ? 'Sold out' : `${candidate.availableStock} left`}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      <div className="row">
        <div className="qty">
          <button type="button" onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="Decrease quantity">
            -
          </button>
          <span className="value" data-testid="quantity">
            {quantity}
          </span>
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.min(max || 1, q + 1))}
            aria-label="Increase quantity"
          >
            +
          </button>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={submit}
          disabled={soldOut || pending}
          data-testid="add-to-cart"
        >
          {soldOut ? 'Sold out' : pending ? 'Adding…' : 'Add to cart'}
        </button>
      </div>

      {error && (
        <p className="error" role="alert" data-testid="add-error">
          {error}
        </p>
      )}
    </div>
  );
}
