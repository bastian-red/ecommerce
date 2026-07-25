import { expect, test } from '@playwright/test';
import { addFirstVariantToCart, availableStock, fillCheckout } from './helpers';

/**
 * The idempotency guarantee, demonstrated through the browser.
 *
 * The integration suite proves it at the API level and is the authoritative
 * test. This one exists because the mock gateway's page can fire the duplicates
 * itself, which makes the property visible to anyone who opens the deployed app
 * rather than only to whoever runs the test suite.
 */
test.describe('duplicate webhook delivery', () => {
  test('twenty deliveries of one payment charge and ship the order once', async ({ page }) => {
    const before = await availableStock('band-woven', 'BAND-BLK');

    await page.goto('/products/band-woven');
    // BAND-BLK is the second variant.
    await page.getByTestId('variant-option').nth(1).locator('input').check();
    await page.getByTestId('add-to-cart').click();
    await page.waitForTimeout(600);

    await fillCheckout(page, 'idempotency@example.com');
    await page.waitForURL(/\/mock-checkout\//, { timeout: 20_000 });

    // Reserved, not yet shipped.
    expect(await availableStock('band-woven', 'BAND-BLK')).toBe(before - 1);

    // Twenty concurrent deliveries of the same event, which is what a gateway
    // does when it times out waiting for our acknowledgement and retries.
    await page.getByTestId('mock-deliveries').fill('20');
    await page.getByTestId('mock-approve').click();

    await page.waitForURL(/\/orders\//, { timeout: 25_000 });
    await expect(page.getByTestId('order-status')).toHaveText('PAID');

    // One decrement, not twenty.
    expect(await availableStock('band-woven', 'BAND-BLK')).toBe(before - 1);
  });

  test('replaying the same event id within a session changes nothing', async ({ page }) => {
    const before = await availableStock('cable-usbc', 'CBL-150');

    await addFirstVariantToCart(page, 'cable-usbc');
    await fillCheckout(page, 'replay@example.com');
    await page.waitForURL(/\/mock-checkout\//, { timeout: 20_000 });

    // Decline first. It sends a real signed webhook and, unlike approve, leaves
    // the page in place, so the event id is still in the gateway page's state
    // and the replay button can reuse it. Approving would navigate away and
    // reset it, which is what the replay control means by "last event".
    await page.getByTestId('mock-decline').click();
    await expect(page.getByTestId('mock-statuses')).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('mock-replay').click();
    await expect(page.getByTestId('mock-statuses')).toContainText('200', { timeout: 15_000 });

    // Still reserved, never shipped: a replayed failure is still one failure.
    expect(await availableStock('cable-usbc', 'CBL-150')).toBe(before - 1);
  });

  test('paying an already-paid order with a fresh event id changes nothing', async ({ page }) => {
    // This is layer two in isolation. The event id is genuinely new, so the
    // dedupe table cannot help; the guarded status transition is what refuses.
    const before = await availableStock('power-brick', 'PWR-65');

    await addFirstVariantToCart(page, 'power-brick');
    await fillCheckout(page, 'double-pay@example.com');
    await page.waitForURL(/\/mock-checkout\//, { timeout: 20_000 });

    const gatewayUrl = page.url();
    await page.getByTestId('mock-approve').click();
    await page.waitForURL(/\/orders\//, { timeout: 25_000 });

    const afterFirst = await availableStock('power-brick', 'PWR-65');
    expect(afterFirst).toBe(before - 1);

    // Back to the gateway page and pay again. A brand new event id, same order.
    // The assertion is on the order page and on stock, not on the gateway page's
    // status line: a successful delivery navigates away immediately, so waiting
    // for that element races the redirect.
    await page.goto(gatewayUrl);
    await page.getByTestId('mock-approve').click();
    await page.waitForURL(/\/orders\//, { timeout: 25_000 });
    await expect(page.getByTestId('order-status')).toHaveText('PAID');

    expect(await availableStock('power-brick', 'PWR-65')).toBe(afterFirst);
  });
});

test.describe('the mock gateway is not a production backdoor', () => {
  test('its page exists only while the mock driver is active', async ({ page }) => {
    // With PAYMENTS_DRIVER=stripe this page 404s. Under the mock driver, which
    // is what CI runs, a well-formed session renders and a malformed one does
    // not, so a stray URL cannot conjure a payment page.
    const response = await page.goto('/mock-checkout/cs_mock_missing_params');
    expect(response?.status()).toBe(404);
  });
});
