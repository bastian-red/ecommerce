import { formatMoney, type AdminStockView, type OrderList } from '@shop/shared';
import Link from 'next/link';
import { apiFetch } from '../../lib/api';

export const dynamic = 'force-dynamic';

export default async function AdminOverviewPage() {
  const [orders, stock] = await Promise.all([
    apiFetch<OrderList>('/admin/orders?perPage=100'),
    apiFetch<AdminStockView[]>('/admin/stock'),
  ]);

  const paid = orders.items.filter((order) => order.status === 'PAID');
  const revenueCents = orders.items
    .filter((order) => order.status === 'PAID' || order.status === 'FULFILLED')
    .reduce((sum, order) => sum + order.totalCents, 0);
  // "Held" is stock promised to PENDING orders. It is the number that explains
  // why available is lower than on-hand, and the first thing to look at when a
  // customer reports an item as unavailable that the shelf says is in stock.
  const held = stock.reduce((sum, row) => sum + row.stockReserved, 0);
  const outOfStock = stock.filter((row) => row.availableStock === 0);

  return (
    <>
      <h1>Overview</h1>

      {/* A description list, not four cards with headings in them. These are
          label/value pairs, which is what <dl> is for, and it means a screen
          reader reads "Awaiting fulfilment, 3" instead of announcing four
          same-level headings with orphaned numbers under them. */}
      <dl className="stats">
        <div className="stat">
          <dt>Awaiting fulfilment</dt>
          <dd data-testid="stat-awaiting">{paid.length}</dd>
        </div>
        <div className="stat">
          <dt>Revenue (paid + fulfilled)</dt>
          <dd data-testid="stat-revenue">{formatMoney(revenueCents)}</dd>
        </div>
        <div className="stat">
          <dt>Units held by open orders</dt>
          <dd data-testid="stat-held">{held}</dd>
        </div>
        <div className="stat">
          <dt>Variants out of stock</dt>
          <dd data-testid="stat-oos">{outOfStock.length}</dd>
        </div>
      </dl>

      <h2>Needs attention</h2>
      {outOfStock.length === 0 ? (
        <p className="empty">Everything is in stock</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>SKU</th>
              <th className="num">On hand</th>
              <th className="num">Reserved</th>
            </tr>
          </thead>
          <tbody>
            {outOfStock.map((row) => (
              <tr key={row.variantId}>
                <td>
                  {row.productTitle} <span className="muted">{row.variantName}</span>
                </td>
                <td className="mono">{row.sku}</td>
                <td className="num">{row.stockOnHand}</td>
                <td className="num">{row.stockReserved}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="row" style={{ marginTop: 24 }}>
        <Link href="/admin/stock" className="btn btn-primary">
          Manage stock
        </Link>
      </div>
    </>
  );
}
