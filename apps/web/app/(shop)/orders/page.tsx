import { formatMoney, type OrderList, type OrderStatus } from '@shop/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

const BADGE: Record<OrderStatus, string> = {
  PENDING: 'badge-pending',
  PAID: 'badge-paid',
  FULFILLED: 'badge-fulfilled',
  CANCELLED: 'badge-cancelled',
  EXPIRED: 'badge-expired',
};

export default async function OrdersPage() {
  const session = await auth();
  // Guarded in the layout of the page rather than in middleware: middleware runs
  // on the edge without the session's database context, and one guard in one
  // place is easier to prove correct than two that must agree.
  if (!session?.user) redirect('/login?next=/orders');

  const orders = await apiFetch<OrderList>('/orders?perPage=50');

  return (
    <main className="container">
      <h1>Your orders</h1>
      {orders.items.length === 0 ? (
        <p className="empty">No orders yet</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Placed</th>
              <th>Status</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {orders.items.map((order) => (
              <tr key={order.id} data-testid="order-row">
                <td>
                  <Link href={`/orders/${order.id}`}>{order.number}</Link>
                </td>
                <td className="mono">{new Date(order.createdAt).toISOString().slice(0, 10)}</td>
                <td>
                  <span className={`badge ${BADGE[order.status]}`}>{order.status}</span>
                </td>
                <td className="num">{formatMoney(order.totalCents, order.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
