import Link from 'next/link';

/**
 * The console's top bar.
 *
 * Deliberately not `<Nav>`. The storefront nav is warm, serif and sticky; this
 * one is a flat slate strip with an "Admin" tag rendered by
 * `[data-surface="admin"] .nav .brand::after`. An operator glancing at the top
 * of the window has to know which surface they are on before they click
 * anything, and a subtle tint is not enough.
 *
 * The one link back to the storefront is deliberate too: it is the only way out
 * of the console that does not go through the browser's back button.
 */
export function AdminBar() {
  return (
    <nav className="nav" aria-label="Admin">
      <Link href="/admin" className="brand">
        Shop
      </Link>
      <div className="links">
        <Link href="/">Back to the store</Link>
      </div>
    </nav>
  );
}
