import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { addFirstVariantToCart, ADMIN, signIn } from './helpers';

/**
 * Accessibility, measured rather than asserted by eye.
 *
 * A design change is otherwise unfalsifiable: "it looks better" is not a
 * result. axe-core turns most of it into a number — contrast, names, roles,
 * landmarks, label association — and this spec drives that number to zero and
 * keeps it there.
 *
 * Both colour schemes run because the palette is defined twice
 * (`prefers-color-scheme: dark` overrides `:root`), so a token that passes in
 * light can fail in dark and nothing would catch it. Both surfaces run too: the
 * storefront and the admin console have different palettes and different
 * densities, so passing on one says nothing about the other.
 *
 * Scope note: `wcag2a`/`wcag2aa`/`wcag21a`/`wcag21aa` only. Best-practice rules
 * are deliberately excluded — they flag stylistic preferences that are not
 * conformance failures, and a gate that fails on opinion gets disabled.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Set with BASELINE=1 to record findings instead of failing on them. */
const RECORDING = process.env.BASELINE === '1';
const BASELINE_DIR = process.env.BASELINE_DIR ?? '/tmp/shop-a11y';

type Scheme = 'light' | 'dark';
const SCHEMES: Scheme[] = ['light', 'dark'];

/** A seeded product with several variants and an image. See packages/db/prisma/seed.ts. */
const PRODUCT = 'ear-one';

interface RouteCase {
  name: string;
  path: string;
  /** Runs after navigation, for states that need a click to reach. */
  prepare?: (page: Page) => Promise<void>;
}

/**
 * Storefront routes. Anonymous, which is how almost every visit starts.
 */
const SHOP_ROUTES: RouteCase[] = [
  { name: 'home', path: '/' },
  { name: 'catalog', path: '/products' },
  {
    name: 'catalog filtered by search',
    path: '/products?q=ear',
    prepare: async (page) => {
      await expect(page.getByTestId('product-card').first()).toBeVisible();
    },
  },
  { name: 'product detail', path: `/products/${PRODUCT}` },
  { name: 'empty cart', path: '/cart' },
  { name: 'login', path: '/login' },
  { name: 'signup', path: '/signup' },
];

/** Storefront routes that need something in the cart first. */
const CART_ROUTES: RouteCase[] = [
  { name: 'cart with a line', path: '/cart' },
  { name: 'checkout', path: '/checkout' },
];

/** The admin console — a different surface with its own palette and density. */
const ADMIN_ROUTES: RouteCase[] = [
  { name: 'admin overview', path: '/admin' },
  { name: 'admin products', path: '/admin/products' },
  { name: 'admin orders', path: '/admin/orders' },
  { name: 'admin stock', path: '/admin/stock' },
  { name: 'admin ledger', path: '/admin/ledger' },
];

const findings: Record<string, unknown> = {};

async function audit(page: Page, route: RouteCase, scheme: Scheme): Promise<void> {
  await page.goto(route.path);
  if (route.prepare) await route.prepare(page);

  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();

  const summary = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.length,
    // One example is enough to find it; dumping every node makes the baseline
    // unreadable.
    example: violation.nodes[0]?.html?.slice(0, 200),
  }));

  if (RECORDING) {
    findings[`${scheme} :: ${route.name}`] = summary;
    test.info().annotations.push({
      type: 'baseline',
      description: `${summary.length} violation types`,
    });
    return;
  }

  expect(summary, `axe violations on ${route.name} (${scheme})`).toEqual([]);
}

test.describe('accessibility', () => {
  for (const scheme of SCHEMES) {
    test.describe(`${scheme} scheme`, () => {
      test.use({ colorScheme: scheme });

      for (const route of SHOP_ROUTES) {
        test(`${route.name} has no WCAG violations`, async ({ page }) => {
          await audit(page, route, scheme);
        });
      }

      for (const route of CART_ROUTES) {
        test(`${route.name} has no WCAG violations`, async ({ page }) => {
          await addFirstVariantToCart(page, PRODUCT);
          await audit(page, route, scheme);
        });
      }

      for (const route of ADMIN_ROUTES) {
        test(`${route.name} has no WCAG violations`, async ({ page }) => {
          await signIn(page, ADMIN.email, ADMIN.password);
          await audit(page, route, scheme);
        });
      }
    });
  }

  test.afterAll(async () => {
    if (!RECORDING) return;
    await mkdir(BASELINE_DIR, { recursive: true });
    await writeFile(
      join(BASELINE_DIR, 'baseline.json'),
      `${JSON.stringify(findings, null, 2)}\n`,
      'utf8',
    );
  });
});
