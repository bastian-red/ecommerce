import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { auth } from '../../auth';

/**
 * The admin gate.
 *
 * One check, in the layout, so every page under /admin inherits it and none can
 * be added later that forgets it. It is not the only check: the API's RolesGuard
 * refuses non-admin tokens independently, so this layout is a redirect for the
 * user's benefit, not the security boundary. A UI-only guard is a suggestion.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login?next=/admin');
  if (session.user.role !== 'ADMIN') redirect('/');

  return (
    <main className="container-wide">
      <h1>Admin</h1>
      <nav className="admin-nav">
        <Link href="/admin">Overview</Link>
        <Link href="/admin/products">Products</Link>
        <Link href="/admin/stock">Stock</Link>
        <Link href="/admin/orders">Orders</Link>
        <Link href="/admin/ledger">Stock ledger</Link>
      </nav>
      {children}
    </main>
  );
}
