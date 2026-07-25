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
    await page.getByTestId('search-input').fill('noise cancellation');
    await page.getByRole('button', { name: /apply/i }).click();
    await expect(page.getByTestId('product-card')).toHaveCount(1);
    await expect(page.getByTestId('product-card').first()).toHaveAttribute('data-slug', 'ear-one');

    // A category filter narrows without erroring.
    await page.goto('/products?category=audio');
    const audio = await page.getByTestId('product-card').count();
    expect(audio).toBeGreaterThan(0);
    expect(audio).toBeLessThan(all);
  });

  test('a query that matches nothing shows an empty state, not an error', async ({ page }) => {
    await page.goto('/products?q=zzzznothingmatchesthis');
    await expect(page.getByTestId('no-results')).toBeVisible();
  });

  test('a draft product is not reachable from the storefront', async ({ page }) => {
    // phone-three is seeded as DRAFT precisely so this has something to check.
    const response = await page.goto('/products/phone-three');
    expect(response?.status()).toBe(404);
  });

  test('buys an item end to end and the stock drops by what was bought', async ({ page }) => {
    const before = await availableStock('cable-usbc', 'CBL-150');
    expect(before).toBeGreaterThan(0);

    await addFirstVariantToCart(page, 'cable-usbc');

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
    expect(await availableStock('cable-usbc', 'CBL-150')).toBe(before - 1);

    await page.getByTestId('mock-approve').click();

    await page.waitForURL(/\/orders\//, { timeout: 20_000 });
    await expect(page.getByTestId('order-number')).toContainText('SHOP-');
    await expect(page.getByTestId('order-status')).toHaveText('PAID');
    await expect(page.getByTestId('paid-notice')).toBeVisible();
    await expect(page.getByTestId('order-item')).toHaveCount(1);
    await expect(page.getByTestId('order-total')).toHaveText(total!);

    // Fulfilment consumed the reservation rather than adding a second decrement.
    expect(await availableStock('cable-usbc', 'CBL-150')).toBe(before - 1);
  });

  test('a declined payment leaves the order unpaid', async ({ page }) => {
    await addFirstVariantToCart(page, 'power-brick');
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
    await addFirstVariantToCart(page, 'band-woven');
    await page.goto('/cart');

    await page.getByLabel('Increase quantity').click();
    await expect(page.getByTestId('line-quantity')).toHaveText('2');

    await page.getByLabel('Decrease quantity').click();
    await expect(page.getByTestId('line-quantity')).toHaveText('1');

    await page.getByTestId('remove-line').click();
    await expect(page.getByTestId('empty-cart')).toBeVisible();
  });

  test('the cart survives a reload, because it lives in Redis not in memory', async ({ page }) => {
    await addFirstVariantToCart(page, 'cable-usbc');
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
