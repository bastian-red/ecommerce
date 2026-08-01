import type { ReactNode } from 'react';
import { Nav } from '@/components/nav';

/**
 * The storefront shell.
 *
 * `<Nav>` used to live in the root layout, which meant the warm editorial bar
 * was also painted across the top of the cool, dense admin console — the two
 * surfaces disagreeing in the first 60 pixels of every page. Each route group
 * now owns its own chrome.
 *
 * Route groups do not appear in the URL, so every existing route, link and test
 * selector is unaffected by the split.
 */
export default function ShopLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Nav />
      <div id="main">{children}</div>
    </>
  );
}
