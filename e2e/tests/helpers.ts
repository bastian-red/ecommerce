import type { Page } from '@playwright/test';

export const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000';

export const ADMIN = { email: 'admin@shop.local', password: 'password123' };

/** Sign in through the real form, so the session cookie is a real one. */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill(password);
  await page.getByRole('button', { name: /log in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });
}

/** Add one unit of a product's first in-stock variant to the cart. */
export async function addFirstVariantToCart(page: Page, slug: string): Promise<void> {
  await page.goto(`/products/${slug}`);
  await page.getByTestId('add-to-cart').click();
  // The button re-enables once the server action has committed.
  await page.getByTestId('add-to-cart').waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
}

/** Fill and submit the checkout form, landing on the gateway page. */
export async function fillCheckout(page: Page, email: string): Promise<void> {
  await page.goto('/checkout');
  await page.getByTestId('checkout-email').fill(email);
  await page.getByTestId('checkout-name').fill('Ada Lovelace');
  await page.getByTestId('checkout-line1').fill('1 Analytical Way');
  await page.getByTestId('checkout-city').fill('London');
  await page.getByTestId('checkout-postal').fill('E16AN');
  await page.getByTestId('checkout-country').fill('GB');
  await page.getByTestId('place-order').click();
}

/** Read a variant's stock straight from the API, to assert against the UI. */
export async function availableStock(slug: string, sku: string): Promise<number> {
  const response = await fetch(`${API_BASE_URL}/products/${slug}`);
  const product = (await response.json()) as {
    variants: Array<{ sku: string; availableStock: number }>;
  };
  return product.variants.find((variant) => variant.sku === sku)?.availableStock ?? -1;
}
