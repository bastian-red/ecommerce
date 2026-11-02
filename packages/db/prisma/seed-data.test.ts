/**
 * The demo catalog's photos. A product card with no photo falls back to two
 * letters of its title ("Ea" for Ear One), which is the first thing a visitor
 * sees on a shop. These checks keep every sellable product photographed, with
 * a file the storage contract will accept and a credit for it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { assertSafeKey, validateUpload } from '@shop/storage';
import { describe, expect, it } from 'vitest';
import { ProductStatus } from '../generated/client';
import { PRODUCTS, SEED_IMAGE_DIR, seedImageKey } from './seed-data';

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

  it('stores under a deterministic key the storage layer accepts', () => {
    const key = seedImageKey('cm0abc123', 'ear-one.webp');
    expect(key).toBe('products/cm0abc123/seed-ear-one.webp');
    expect(() => assertSafeKey(key)).not.toThrow();
    // Same input, same key: a re-seed overwrites instead of duplicating.
    expect(seedImageKey('cm0abc123', 'ear-one.webp')).toBe(key);
  });
});
