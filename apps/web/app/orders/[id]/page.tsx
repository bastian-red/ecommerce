import { formatMoney, type Order, type OrderStatus } from '@shop/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '../../../auth';
import { ClearCartOnPaid } from '../../../components/clear-cart-on-paid';
import { ApiError, apiFetch, publicApiFetch } from '../../../lib/api';

export const dynamic = 'force-dynamic';

const BADGE: Record<OrderStatus, string> = {
  PENDING: 'badge-pending',
  PAID: 'badge-paid',
  FULFILLED: 'badge-fulfilled',
  CANCELLED: 'badge-cancelled',
  EXPIRED: 'badge-expired',
};

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const session = await auth();

  // A guest proves access with the signed token the gateway's success URL
  // carries, or with the email the order was placed with. Both are forwarded so
  // a signed-in customer opening someone else's confirmation link still gets
  // whatever the token entitles them to and nothing more.
  const access = new URLSearchParams();
  if (typeof query.t === 'string') access.set('t', query.t);
  if (typeof query.email === 'string') access.set('email', query.email);
  const suffix = access.toString() ? `?${access.toString()}` : '';

  let order: Order;
  try {
    order = session?.user
      ? await apiFetch<Order>(`/orders/${id}${suffix}`)
      : await publicApiFetch<Order>(`/orders/${id}${suffix}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 401)) notFound();
    throw error;
  }

  const justPaid = query.paid === '1';

  return (
    <main className="container">
      <div className="row between">
        <h1 data-testid="order-number">Order {order.number}</h1>
        <span className={`badge ${BADGE[order.status]}`} data-testid="order-status">
          {order.status}
        </span>
      </div>

      {justPaid && order.status === 'PENDING' && (
        <p className="notice" data-testid="awaiting-webhook">
          Payment sent. This page updates once the gateway confirms it. Refresh in a moment.
        </p>
      )}
      {order.status === 'PAID' && (
        <>
          <ClearCartOnPaid />
          <p className="notice" data-testid="paid-notice">
            Payment confirmed. Your order is being prepared.
          </p>
        </>
      )}
      {order.status === 'EXPIRED' && (
        <p className="notice" data-testid="expired-notice">
          This order expired before payment landed, and the stock went back on the shelf.
        </p>
      )}

      <table style={{ marginTop: 24 }}>
        <thead>
          <tr>
            <th>Item</th>
            <th className="num">Qty</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item) => (
            <tr key={item.id} data-testid="order-item" data-sku={item.sku}>
              <td>
                {item.productTitle}
                <div className="product-meta">
                  {item.variantName} · {item.sku}
                </div>
              </td>
              <td className="num">{item.quantity}</td>
              <td className="num">{formatMoney(item.lineTotalCents, order.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="summary" style={{ marginTop: 24 }}>
        <div className="summary-row">
          <span>Subtotal</span>
          <span>{formatMoney(order.subtotalCents, order.currency)}</span>
        </div>
        <div className="summary-row">
          <span>Shipping</span>
          <span>{formatMoney(order.shippingCents, order.currency)}</span>
        </div>
        <div className="summary-row">
          <span>Tax</span>
          <span>{formatMoney(order.taxCents, order.currency)}</span>
        </div>
        <div className="summary-row total">
          <span>Total</span>
          <span data-testid="order-total">{formatMoney(order.totalCents, order.currency)}</span>
        </div>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <h3>Shipping to</h3>
        <p className="mono" style={{ margin: 0 }}>
          {order.shippingAddress.name}
          <br />
          {order.shippingAddress.line1}
          <br />
          {order.shippingAddress.city} {order.shippingAddress.postalCode}
          <br />
          {order.shippingAddress.country}
        </p>
      </div>

      <div className="row" style={{ marginTop: 24 }}>
        <Link href="/products" className="btn">
          Keep shopping
        </Link>
      </div>
    </main>
  );
}
