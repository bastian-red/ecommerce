import { formatMoney, type Cart } from '@shop/shared';
import Link from 'next/link';
import { CartLineControls } from '../../components/cart-line-controls';
import { cartApiFetch, getCartId } from '../../lib/api';

export const dynamic = 'force-dynamic';

const EMPTY: Cart = {
  lines: [],
  currency: 'usd',
  subtotalCents: 0,
  shippingCents: 0,
  taxCents: 0,
  totalCents: 0,
  hasStockProblem: false,
};

export default async function CartPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { cancelled } = await searchParams;
  const cartId = await getCartId(false);
  const cart = cartId ? await cartApiFetch<Cart>(cartId, '/cart').catch(() => EMPTY) : EMPTY;

  return (
    <main className="container">
      <h1>Cart</h1>

      {cancelled && (
        <p className="notice" data-testid="cancelled-notice">
          Checkout was cancelled. Your items are still reserved for a few minutes.
        </p>
      )}

      {cart.hasStockProblem && (
        <p className="notice" data-testid="stock-problem">
          Someone bought stock while you were shopping. Reduce the highlighted lines to continue.
        </p>
      )}

      {cart.lines.length === 0 ? (
        <>
          <p className="empty" data-testid="empty-cart">
            Your cart is empty
          </p>
          <div className="row" style={{ marginTop: 20 }}>
            <Link href="/products" className="btn btn-primary">
              Browse the catalog
            </Link>
          </div>
        </>
      ) : (
        <>
          {cart.lines.map((line) => (
            <div className="cart-line" key={line.variantId} data-testid="cart-line" data-sku={line.sku}>
              {line.imageUrl ? (
                <img className="thumb" src={line.imageUrl} alt={line.productTitle} />
              ) : (
                <span className="thumb" aria-hidden="true" />
              )}
              <div>
                <Link href={`/products/${line.productSlug}`}>
                  <strong>{line.productTitle}</strong>
                </Link>
                <div className="product-meta">
                  {line.variantName} · {line.sku} · {formatMoney(line.unitPriceCents)} each
                </div>
                {line.exceedsStock && (
                  <div className="error" data-testid="line-stock-error">
                    Only {line.availableStock} left
                  </div>
                )}
                <div style={{ marginTop: 8 }}>
                  <CartLineControls
                    variantId={line.variantId}
                    quantity={line.quantity}
                    max={Math.max(line.availableStock, 1)}
                  />
                </div>
              </div>
              <span className="price-sm" data-testid="line-total">
                {formatMoney(line.lineTotalCents)}
              </span>
            </div>
          ))}

          <div className="summary" style={{ marginTop: 24 }}>
            <div className="summary-row">
              <span>Subtotal</span>
              <span data-testid="subtotal">{formatMoney(cart.subtotalCents)}</span>
            </div>
            <div className="summary-row">
              <span>Shipping</span>
              <span data-testid="shipping">
                {cart.shippingCents === 0 ? 'Free' : formatMoney(cart.shippingCents)}
              </span>
            </div>
            <div className="summary-row">
              <span>Tax</span>
              <span data-testid="tax">{formatMoney(cart.taxCents)}</span>
            </div>
            <div className="summary-row total">
              <span>Total</span>
              <span data-testid="total">{formatMoney(cart.totalCents)}</span>
            </div>
            <div className="row" style={{ marginTop: 20 }}>
              {cart.hasStockProblem ? (
                <button type="button" className="btn" disabled data-testid="checkout-blocked">
                  Fix your cart to continue
                </button>
              ) : (
                <Link href="/checkout" className="btn btn-primary" data-testid="go-to-checkout">
                  Checkout
                </Link>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
