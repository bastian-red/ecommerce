import { expect, test, type BrowserContext } from '@playwright/test';
import { API_BASE_URL, ADMIN, availableStock, fillCheckout, signIn } from './helpers';

/**
 * The oversell race, run through two real browsers.
 *
 * The integration suite proves this at the API level with twenty concurrent
 * requests. This spec proves the same guarantee reaches the customer: the loser
 * sees a specific, actionable message rather than a stack trace or, worse, a
 * successful order for stock that does not exist.
 */

/** Drive a variant down to exactly one available unit, through the admin API. */
async function setAvailableToOne(context: BrowserContext, slug: string, sku: string): Promise<void> {
  const page = await context.newPage();
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/admin/stock');

  const current = await availableStock(slug, sku);
  const delta = 1 - current;
  if (delta !== 0) {
    const row = page.locator(`[data-testid="stock-row"][data-sku="${sku}"]`);
    const variantId = await row.locator('[data-testid^="stock-qty-"]').getAttribute('data-testid');
    const id = variantId!.replace('stock-qty-', '');
    await page.getByTestId(`stock-qty-${id}`).fill(String(delta));
    await page.getByTestId(`stock-reason-${id}`).fill('e2e: force a single unit');
    await page.getByTestId(`adjust-${id}`).click();
    await expect(page.getByTestId(`available-${sku}`)).toHaveText('1', { timeout: 15_000 });
  }
  await page.close();
}

test.describe('two buyers race the last unit', () => {
  test('exactly one wins and the other is told what ran out', async ({ browser }) => {
    const admin = await browser.newContext();
    await setAvailableToOne(admin, 'ear-open', 'EARO-WHT');
    await admin.close();

    expect(await availableStock('ear-open', 'EARO-WHT')).toBe(1);

    // Two independent browser contexts: separate cookie jars, so separate carts.
    const first = await browser.newContext();
    const second = await browser.newContext();
    const pageA = await first.newPage();
    const pageB = await second.newPage();

    // Both put the same last unit in their cart. Both are told it is available,
    // because at that moment it is: a cart holds nothing.
    for (const page of [pageA, pageB]) {
      await page.goto('/products/ear-open');
      await page.getByTestId('add-to-cart').click();
      await page.waitForTimeout(600);
    }

    // Both fill the form and submit at the same time. Exactly one reservation
    // can commit, because the reserving UPDATE's WHERE clause is the check.
    const results = await Promise.allSettled([
      fillCheckout(pageA, 'racer-a@example.com'),
      fillCheckout(pageB, 'racer-b@example.com'),
    ]);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(0);

    await pageA.waitForTimeout(3_000);
    await pageB.waitForTimeout(3_000);

    const onGateway = [pageA, pageB].filter((page) => page.url().includes('/mock-checkout/'));
    const stillOnCheckout = [pageA, pageB].filter((page) => page.url().includes('/checkout'));

    expect(onGateway).toHaveLength(1);
    expect(stillOnCheckout).toHaveLength(1);

    // The loser gets the contract's structured detail, not a generic failure.
    const loser = stillOnCheckout[0]!;
    await expect(loser.getByTestId('checkout-error')).toBeVisible();
    await expect(loser.getByTestId('stock-details')).toContainText('0 left');

    // The winner holds the unit; nothing was oversold.
    expect(await availableStock('ear-open', 'EARO-WHT')).toBe(0);

    await first.close();
    await second.close();
  });

  test('the product page shows sold out once the last unit is reserved', async ({ page }) => {
    expect(await availableStock('ear-open', 'EARO-WHT')).toBe(0);
    await page.goto('/products/ear-open');
    await expect(page.getByTestId('variant-stock').first()).toHaveText('Sold out');
    await expect(page.getByTestId('add-to-cart')).toBeDisabled();
  });

  test('the API refuses a direct checkout for stock that is gone', async ({ request }) => {
    // Belt and braces: the UI disabling a button is not the guarantee. Anyone
    // can post to the API, and it must refuse there too.
    const cartId = 'e2edirect'.padEnd(32, '0');
    const product = await (await fetch(`${API_BASE_URL}/products/ear-open`)).json();
    const variantId = product.variants[0].id;

    const add = await request.post(`${API_BASE_URL}/cart/lines`, {
      headers: { 'x-cart-id': cartId },
      data: { variantId, quantity: 1 },
    });
    expect(add.ok()).toBe(true);

    const checkout = await request.post(`${API_BASE_URL}/checkout`, {
      headers: { 'x-cart-id': cartId },
      data: {
        email: 'direct@example.com',
        shippingAddress: {
          name: 'Direct',
          line1: '1 Street',
          city: 'Town',
          postalCode: '0000',
          country: 'GB',
        },
      },
    });
    expect(checkout.status()).toBe(409);
    expect((await checkout.json()).code).toBe('INSUFFICIENT_STOCK');
  });
});
