import { formatMoney, type Cart } from '@shop/shared';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { CheckoutForm } from '@/components/checkout-form';
import { cartApiFetch, getCartId } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function CheckoutPage() {
  const cartId = await getCartId(false);
  if (!cartId) redirect('/cart');

  const cart = await cartApiFetch<Cart>(cartId, '/cart');
  // An empty or unbuyable cart is bounced back rather than shown a form that is
  // guaranteed to fail on submit.
  if (cart.lines.length === 0 || cart.hasStockProblem) redirect('/cart');

  const session = await auth();

  return (
    <main className="container">
      <h1>Checkout</h1>
      <div className="shop-layout" style={{ gridTemplateColumns: '1fr 320px' }}>
        <section>
          <CheckoutForm defaultEmail={session?.user?.email ?? ''} />
        </section>

        <aside className="summary">
          <h3 style={{ marginTop: 0 }}>Order</h3>
          {cart.lines.map((line) => (
            <div className="summary-row" key={line.variantId}>
              <span>
                {line.quantity} x {line.productTitle}
              </span>
              <span>{formatMoney(line.lineTotalCents)}</span>
            </div>
          ))}
          <div className="summary-row">
            <span>Subtotal</span>
            <span>{formatMoney(cart.subtotalCents)}</span>
          </div>
          <div className="summary-row">
            <span>Shipping</span>
            <span>{cart.shippingCents === 0 ? 'Free' : formatMoney(cart.shippingCents)}</span>
          </div>
          <div className="summary-row">
            <span>Tax</span>
            <span>{formatMoney(cart.taxCents)}</span>
          </div>
          <div className="summary-row total">
            <span>Total</span>
            <span data-testid="checkout-total">{formatMoney(cart.totalCents)}</span>
          </div>
        </aside>
      </div>
    </main>
  );
}
