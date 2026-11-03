import { expect, test } from '@playwright/test';
import { addFirstVariantToCart, availableStock, fillCheckout } from './helpers';

/**
 * The whole purchase, as a customer with no account does it: browse, filter,
 * search, add to cart, check out as a guest, pay at the gateway, land on a
 * confirmed order, and see the stock go down.
 *
 * This is the spec that proves the pieces are wired together. The unit and
 * integration lanes prove each piece is correct on its own.
 */
test.describe('guest shopping flow', () => {
  test('browse, filter and search the catalog', async ({ page }) => {
    await page.goto('/products');
    const all = await page.getByTestId('product-card').count();
    expect(all).toBeGreaterThan(2);

    // Full-text search, served by the GIN index through websearch_to_tsquery.
    await page.getByTestId('search-input').fill('thumb rest');
    await page.getByRole('button', { name: /apply/i }).click();
    await expect(page.getByTestId('product-card')).toHaveCount(1);
    await expect(page.getByTestId('product-card').first()).toHaveAttribute('data-slug', 'kiln-mug');

    // The category links are separate, legible targets. With no CSS rule they
    // ran together inline as "AllDrinkwareObjectsTableware".
    const links = page.locator('.filter-links a');
    const boxes = await links.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
    expect(boxes.length).toBeGreaterThan(2);
    for (let i = 1; i < boxes.length; i += 1) {
      expect(boxes[i].top, 'category links overlap or share a line').toBeGreaterThanOrEqual(boxes[i - 1].bottom);
    }
    await expect(links.first()).toHaveAttribute('aria-current', 'page');
    // Exactly the studio's three categories. A reseed over an older catalog once
    // left its categories behind as filters that led to empty pages.
    await expect(links).toHaveText(['All', 'Drinkware', 'Objects', 'Tableware']);

    // A category filter narrows without erroring.
    await page.goto('/products?category=drinkware');
    await expect(page.locator('.filter-links a[aria-current="page"]')).toHaveText('Drinkware');
    const drinkware = await page.getByTestId('product-card').count();
    expect(drinkware).toBeGreaterThan(0);
    expect(drinkware).toBeLessThan(all);
  });

  test('every seeded product is shown as a loaded photograph, not initials', async ({ page }) => {
    // Without photos each card fell back to two letters of its title ("Ki" for
    // Kiln Mug), the first thing a visitor saw. Checked on the seeded slugs only:
    // the admin spec creates photo-less `e2e-widget-*` products in parallel.
    const seeded = [
      'kiln-mug',
      'tea-bowl',
      'pouring-jug',
      'dinner-plate',
      'serving-bowl',
      'bud-vase',
      'tall-vase',
    ];
    await page.goto('/products');
    for (const slug of seeded) {
      const card = page.locator(`[data-testid="product-card"][data-slug="${slug}"]`);
      await expect(card.locator('.placeholder'), `${slug} shows initials`).toHaveCount(0);
      const img = card.locator('img');
      await expect(img).toHaveAttribute('alt', /\w{4,}/);
      await img.scrollIntoViewIfNeeded();
      // naturalWidth is 0 for a broken image: the URL must actually serve bytes.
      await expect
        .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth), {
          message: `${slug} photo did not load`,
        })
        .toBeGreaterThan(0);
    }

    await page.goto('/products/pouring-jug');
    const hero = page.locator('.gallery img');
    await expect
      .poll(() => hero.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth))
      .toBeGreaterThan(0);
  });

  test('a query that matches nothing shows an empty state, not an error', async ({ page }) => {
    await page.goto('/products?q=zzzznothingmatchesthis');
    await expect(page.getByTestId('no-results')).toBeVisible();
  });

  test('a draft product is not reachable from the storefront', async ({ page }) => {
    // teapot is seeded as DRAFT precisely so this has something to check.
    const response = await page.goto('/products/teapot');
    expect(response?.status()).toBe(404);
  });

  test('buys an item end to end and the stock drops by what was bought', async ({ page }) => {
    const before = await availableStock('bud-vase', 'VASE-SM');
    expect(before).toBeGreaterThan(0);

    await addFirstVariantToCart(page, 'bud-vase');

    await page.goto('/cart');
    await expect(page.getByTestId('cart-line')).toHaveCount(1);
    await expect(page.getByTestId('line-quantity')).toHaveText('1');
    const total = await page.getByTestId('total').textContent();
    expect(total).toMatch(/^\$\d/);

    await page.getByTestId('go-to-checkout').click();
    await expect(page.getByTestId('checkout-total')).toHaveText(total!);

    await fillCheckout(page, 'guest-buyer@example.com');

    // The gateway page. With PAYMENTS_DRIVER=mock this is our own hosted page,
    // which signs a webhook exactly as the real provider would.
    await page.waitForURL(/\/mock-checkout\//, { timeout: 20_000 });
    await expect(page.getByTestId('mock-amount')).toHaveText(total!);

    // Stock is reserved but not yet shipped: available has dropped, on-hand has not.
    expect(await availableStock('bud-vase', 'VASE-SM')).toBe(before - 1);

    await page.getByTestId('mock-approve').click();

    await page.waitForURL(/\/orders\//, { timeout: 20_000 });
    await expect(page.getByTestId('order-number')).toContainText('SHOP-');
    await expect(page.getByTestId('order-status')).toHaveText('PAID');
    await expect(page.getByTestId('paid-notice')).toBeVisible();
    await expect(page.getByTestId('order-item')).toHaveCount(1);
    await expect(page.getByTestId('order-total')).toHaveText(total!);

    // Fulfilment consumed the reservation rather than adding a second decrement.
    expect(await availableStock('bud-vase', 'VASE-SM')).toBe(before - 1);
  });

  test('a declined payment leaves the order unpaid', async ({ page }) => {
    await addFirstVariantToCart(page, 'tall-vase');
    await fillCheckout(page, 'declined@example.com');
    await page.waitForURL(/\/mock-checkout\//, { timeout: 20_000 });

    await page.getByTestId('mock-decline').click();
    await expect(page.getByTestId('mock-statuses')).toContainText('200');

    // The order stays PENDING: a failed card is retryable, and cancelling here
    // would drop the reservation the customer may be about to pay for.
    const orderId = new URL(page.url()).searchParams.get('order');
    await page.goto(`/orders/${orderId}?email=declined@example.com`);
    await expect(page.getByTestId('order-status')).toHaveText('PENDING');
  });

  test('cart quantities can be changed and lines removed', async ({ page }) => {
    await addFirstVariantToCart(page, 'serving-bowl');
    await page.goto('/cart');

    await page.getByLabel('Increase quantity').click();
    await expect(page.getByTestId('line-quantity')).toHaveText('2');

    await page.getByLabel('Decrease quantity').click();
    await expect(page.getByTestId('line-quantity')).toHaveText('1');

    await page.getByTestId('remove-line').click();
    await expect(page.getByTestId('empty-cart')).toBeVisible();
  });

  test('the cart survives a reload, because it lives in Redis not in memory', async ({ page }) => {
    await addFirstVariantToCart(page, 'bud-vase');
    await page.goto('/cart');
    await expect(page.getByTestId('cart-line')).toHaveCount(1);

    await page.reload();
    await expect(page.getByTestId('cart-line')).toHaveCount(1);
  });

  test('checkout is unreachable with an empty cart', async ({ page }) => {
    await page.goto('/cart');
    // Start from a clean cart, whatever the previous test left behind.
    const lines = await page.getByTestId('cart-line').count();
    for (let index = 0; index < lines; index++) {
      await page.getByTestId('remove-line').first().click();
      await page.waitForTimeout(300);
    }
    await page.goto('/checkout');
    await page.waitForURL(/\/cart/, { timeout: 15_000 });
  });
});
