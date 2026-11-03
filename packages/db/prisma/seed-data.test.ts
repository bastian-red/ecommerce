/**
 * The demo catalog's photos. A product card with no photo falls back to two
 * letters of its title ("Ki" for Kiln Mug), which is the first thing a visitor
 * sees on a shop. These checks keep every sellable product photographed, with
 * a file the storage contract will accept and a credit for it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { assertSafeKey, buildStorageKey, validateUpload } from '@shop/storage';
import { describe, expect, it } from 'vitest';
import { ProductStatus } from '../generated/client';
import { CATEGORIES, PRODUCTS, SEED_IMAGE_DIR, seedImageKey } from './seed-data';

const active = PRODUCTS.filter((product) => (product.status ?? ProductStatus.ACTIVE) === ProductStatus.ACTIVE);
const credits = readFileSync(join(SEED_IMAGE_DIR, 'CREDITS.md'), 'utf8');

describe('seed photos', () => {
  it('cover the whole storefront', () => {
    expect(active.length).toBeGreaterThan(0);
    for (const product of active) {
      expect(product.image, `${product.slug} has no photo`).toBeDefined();
    }
  });

  it.each(active.map((product) => [product.slug, product] as const))(
    '%s: a real WebP the storage contract accepts, with alt text',
    (_slug, product) => {
      const path = join(SEED_IMAGE_DIR, product.image!.file);
      const body = readFileSync(path);
      expect(() => validateUpload({ contentType: 'image/webp', size: body.length, body })).not.toThrow();
      // Small enough that seven of them do not bloat the repo or the first paint.
      expect(statSync(path).size).toBeLessThan(150 * 1024);
      expect(product.image!.alt.trim().length).toBeGreaterThan(10);
      expect(product.image!.alt).not.toMatch(/^(image|photo|picture) of/i);
    },
  );

  it('credits every file and ships no uncredited one', () => {
    const files = readdirSync(SEED_IMAGE_DIR).filter((name) => name.endsWith('.webp'));
    const used = active.map((product) => product.image!.file).sort();
    expect(files.sort()).toEqual(used);
    for (const file of files) expect(credits).toContain(`\`${file}\``);
  });

  it('credits every file to its Unsplash page and photographer', () => {
    // Every photo is under the Unsplash License. A row that names the file but
    // links somewhere else (or nowhere) is a credit that cannot be checked.
    const rows = credits.split('\n').filter((line) => line.startsWith('| `'));
    for (const product of active) {
      const row = rows.find((line) => line.startsWith(`| \`${product.image!.file}\``));
      expect(row, `${product.image!.file} has no credit row`).toBeDefined();
      expect(row).toMatch(/\]\(https:\/\/unsplash\.com\/@[\w-]+\)/);
      expect(row).toMatch(/\]\(https:\/\/unsplash\.com\/photos\/[\w-]+\)/);
    }
    expect(credits).toContain('https://unsplash.com/license');
  });

  it('stores under a deterministic key the storage layer accepts', () => {
    const key = seedImageKey('cm0abc123', 'kiln-mug.webp');
    expect(key).toBe('products/cm0abc123/seed-kiln-mug.webp');
    expect(() => assertSafeKey(key)).not.toThrow();
    // Same input, same key: a re-seed overwrites instead of duplicating.
    expect(seedImageKey('cm0abc123', 'kiln-mug.webp')).toBe(key);
  });

  it('has a prefix that covers every seed key and no admin upload key', () => {
    // The seed deletes rows by this prefix before writing its own, so a removed
    // or renamed photo cannot linger. Admin uploads are `<id>/<uuid>.<ext>`.
    const prefix = seedImageKey('cm0abc123', '');
    expect(seedImageKey('cm0abc123', 'tall-vase.webp').startsWith(prefix)).toBe(true);
    expect(buildStorageKey('cm0abc123', 'image/webp').startsWith(prefix)).toBe(false);
    expect(seedImageKey('cm0abc1234', 'tall-vase.webp').startsWith(prefix)).toBe(false);
  });
});

describe('seed catalog', () => {
  it('is a ceramics studio in exactly three categories', () => {
    expect(CATEGORIES.map((category) => category.slug).sort()).toEqual(['drinkware', 'objects', 'tableware']);
  });

  it('files every product under a seeded category', () => {
    const slugs = new Set(CATEGORIES.map((category) => category.slug));
    for (const product of PRODUCTS) expect(slugs, product.slug).toContain(product.category);
  });

  it('keeps the shape the tests depend on: 7 ACTIVE, 1 DRAFT, unique slugs and SKUs', () => {
    expect(active).toHaveLength(7);
    expect(PRODUCTS.filter((product) => product.status === ProductStatus.DRAFT)).toHaveLength(1);
    expect(new Set(PRODUCTS.map((product) => product.slug)).size).toBe(PRODUCTS.length);
    const skus = PRODUCTS.flatMap((product) => product.variants.map((variant) => variant.sku));
    expect(new Set(skus).size).toBe(skus.length);
  });

  it('holds the scarcity the E2E races are built on', () => {
    const variant = (slug: string, sku: string) =>
      PRODUCTS.find((product) => product.slug === slug)!.variants.find((v) => v.sku === sku)!;
    // The oversell race needs a single-variant product; the low-stock display needs a variant under 5.
    expect(PRODUCTS.find((product) => product.slug === 'tea-bowl')!.variants).toHaveLength(1);
    expect(variant('pouring-jug', 'JUG-OXB').stockOnHand).toBeLessThan(5);
  });
});
