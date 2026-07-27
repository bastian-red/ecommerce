import { test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ADMIN, addFirstVariantToCart, availableStock, fillCheckout, signIn } from './helpers';

/**
 * Records the README's demo GIF.
 *
 * It is a test rather than a script on purpose: it drives the app through the
 * same helpers and selectors the real suite uses, so a demo cannot show a flow
 * the tests do not cover, and it cannot silently rot when a selector changes.
 * If the product breaks, this fails alongside everything else.
 *
 * Excluded from the normal run by `grepInvert` in playwright.config.ts, because
 * it writes files and is slowed down deliberately. Record with:
 *
 *   ./scripts/demo-gif.sh
 */

const SHOTS = join(__dirname, '..', 'demo-shots');
let frame = 0;

async function shot(page: Page, label: string): Promise<void> {
  // The number prefix is what orders the frames for ImageMagick, which globs
  // lexicographically rather than by creation time.
  const name = `${String(frame++).padStart(2, '0')}-${label}.png`;
  await page.screenshot({ path: join(SHOTS, name) });
}

test.describe('@demo', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('records the guest purchase flow', async ({ page }) => {
    await mkdir(SHOTS, { recursive: true });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await shot(page, 'home');

    await page.goto('/products');
    await page.waitForLoadState('networkidle');
    await shot(page, 'catalog');

    // Full-text search over the GIN index.
    await page.getByTestId('search-input').fill('noise cancellation');
    await page.getByRole('button', { name: /apply/i }).click();
    await page.getByTestId('product-card').first().waitFor();
    await shot(page, 'search');

    await page.goto('/products/ear-one');
    await page.waitForLoadState('networkidle');
    await shot(page, 'product');

    const before = await availableStock('ear-one', 'EAR1-WHT');
    await addFirstVariantToCart(page, 'ear-one');

    await page.goto('/cart');
    await page.waitForLoadState('networkidle');
    await shot(page, 'cart');

    await fillCheckout(page, 'demo@example.com');
    await page.waitForURL(/\/mock-checkout\//, { timeout: 20_000 });
    await shot(page, 'gateway');

    // Twenty concurrent deliveries of one payment. The order is still charged,
    // shipped and emailed exactly once, which is the whole point of the repo.
    await page.getByTestId('mock-deliveries').fill('20');
    await shot(page, 'duplicate-deliveries');

    await page.getByTestId('mock-approve').click();
    await page.waitForURL(/\/orders\//, { timeout: 25_000 });
    await page.waitForLoadState('networkidle');
    await shot(page, 'order-confirmed');

    // One decrement, not twenty.
    const after = await availableStock('ear-one', 'EAR1-WHT');
    if (after !== before - 1) {
      throw new Error(`demo: expected stock ${before - 1} after one purchase, got ${after}`);
    }

    // Close on the ledger rather than on the product page. A stock count going
    // from 42 to 41 is invisible at GIF scale; the RESERVE and FULFILL rows show
    // the whole mechanism, and that twenty deliveries produced exactly one of
    // each is the claim the repo is making.
    await signIn(page, ADMIN.email, ADMIN.password);
    await page.goto('/admin/stock');
    await page.waitForLoadState('networkidle');
    await shot(page, 'admin-stock');

    await page.goto('/admin/ledger');
    await page.waitForLoadState('networkidle');
    await shot(page, 'admin-ledger');
  });
});
