import { expect, test } from '@playwright/test';
import { API_BASE_URL } from './helpers';

/**
 * The smoke test. If this fails nothing else is worth reading.
 *
 * It checks the health endpoint's contents, not just its status, because a
 * health check that returns 200 while its database is unreachable is a bug that
 * hides every other bug.
 */
test.describe('health', () => {
  test('the API reports its dependencies as up', async ({ request }) => {
    const response = await request.get(`${API_BASE_URL}/health`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.checks.database).toBe(true);
    expect(body.checks.redis).toBe(true);
    expect(typeof body.uptimeSeconds).toBe('number');
  });

  test('the storefront renders', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /hardware, sold correctly/i })).toBeVisible();
    await expect(page.getByTestId('cart-link')).toBeVisible();
  });

  test('the catalog lists seeded products', async ({ page }) => {
    await page.goto('/products');
    await expect(page.getByTestId('product-card').first()).toBeVisible();
    const count = await page.getByTestId('product-card').count();
    expect(count).toBeGreaterThan(0);
  });
});
