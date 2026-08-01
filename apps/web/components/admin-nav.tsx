'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/products', label: 'Products' },
  { href: '/admin/stock', label: 'Stock' },
  { href: '/admin/orders', label: 'Orders' },
  { href: '/admin/ledger', label: 'Stock ledger' },
] as const;

/**
 * The console's section tabs.
 *
 * `aria-current="page"` carries the selected state, which is what lets the CSS
 * underline the active tab without inventing a colour-only signal. A client
 * component only because the current path is needed; nothing else is
 * interactive.
 */
export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="admin-nav" aria-label="Admin sections">
      {TABS.map((tab) => {
        // Exact match for the index tab, prefix match for the rest, so
        // /admin/products/<id> still highlights "Products".
        const active = tab.href === '/admin' ? pathname === '/admin' : pathname.startsWith(tab.href);
        return (
          <Link key={tab.href} href={tab.href} aria-current={active ? 'page' : undefined}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
