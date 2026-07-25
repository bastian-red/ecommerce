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
      <div className="grid">
        <div className="card">
          <h3>Awaiting fulfilment</h3>
          <p className="price" data-testid="stat-awaiting">{paid.length}</p>
        </div>
        <div className="card">
          <h3>Revenue (paid + fulfilled)</h3>
          <p className="price" data-testid="stat-revenue">{formatMoney(revenueCents)}</p>
        </div>
        <div className="card">
          <h3>Units held by open orders</h3>
          <p className="price" data-testid="stat-held">{held}</p>
        </div>
        <div className="card">
          <h3>Variants out of stock</h3>
          <p className="price" data-testid="stat-oos">{outOfStock.length}</p>
        </div>
      </div>

      <h2 style={{ marginTop: 32 }}>Needs attention</h2>
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
