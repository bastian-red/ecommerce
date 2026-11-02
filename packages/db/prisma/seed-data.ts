/**
 * The demo catalog, as data. Kept apart from `seed.ts` so a test can import it
 * without connecting to a database or writing a file.
 */
import { join } from 'node:path';
import { ProductStatus } from '../generated/client';

/** Where the seed's product photos live. */
export const SEED_IMAGE_DIR = join(__dirname, 'seed-images');

/**
 * The storage key of a product's seed photo. Deterministic, unlike the random
 * key an admin upload gets, so a re-seed overwrites the same object instead of
 * piling up copies, and the seed can find its own row again.
 */
export function seedImageKey(productId: string, file: string): string {
  return `products/${productId}/seed-${file}`;
}

export type SeedVariant = {
  sku: string;
  name: string;
  priceCents: number;
  stockOnHand: number;
};

export type SeedProduct = {
  slug: string;
  title: string;
  description: string;
  category: string;
  status?: ProductStatus;
  /** A photo in `prisma/seed-images/`, credited in its CREDITS.md. Every ACTIVE product has one. */
  image?: { file: string; alt: string };
  variants: SeedVariant[];
};

export const CATEGORIES: Array<{ slug: string; name: string }> = [
  { slug: 'audio', name: 'Audio' },
  { slug: 'wearables', name: 'Wearables' },
  { slug: 'accessories', name: 'Accessories' },
];

export const PRODUCTS: SeedProduct[] = [
  {
    slug: 'ear-one',
    image: { file: 'ear-one.webp', alt: 'White wireless earbuds beside their open charging case' },
    title: 'Ear One',
    description:
      'Transparent in-ear monitors with active noise cancellation and a 36 hour case. ' +
      'Machined aluminium stems, silicone tips in three sizes.',
    category: 'audio',
    variants: [
      { sku: 'EAR1-WHT', name: 'White', priceCents: 14900, stockOnHand: 42 },
      { sku: 'EAR1-BLK', name: 'Black', priceCents: 14900, stockOnHand: 18 },
    ],
  },
  {
    slug: 'ear-open',
    image: { file: 'ear-open.webp', alt: 'Navy open-ear headphones with a wraparound band on a white backdrop' },
    title: 'Ear Open',
    description:
      'Open-ear clips that leave the canal free. Directional drivers keep the sound in and the ' +
      'street audible.',
    category: 'audio',
    variants: [{ sku: 'EARO-WHT', name: 'White', priceCents: 19900, stockOnHand: 7 }],
  },
  {
    slug: 'monitor-speaker',
    image: { file: 'monitor-speaker.webp', alt: 'A round white desktop speaker on a wooden stand beside a monitor' },
    title: 'Monitor Speaker',
    description:
      'A single full-range desktop monitor. Class D amplification, USB-C in, 3.5mm in, ' +
      'no app required.',
    category: 'audio',
    variants: [
      { sku: 'MON-BLK', name: 'Black', priceCents: 29900, stockOnHand: 11 },
      { sku: 'MON-GRY', name: 'Grey', priceCents: 29900, stockOnHand: 3 },
    ],
  },
  {
    slug: 'watch-pro',
    image: { file: 'watch-pro.webp', alt: 'A smartwatch on a wrist, its face lit, a finger on the crown' },
    title: 'Watch Pro',
    description:
      'Aluminium case, always-on transflective display, 14 day battery. Reads notifications, ' +
      'nothing more.',
    category: 'wearables',
    variants: [
      { sku: 'WPRO-41', name: '41mm', priceCents: 24900, stockOnHand: 25 },
      { sku: 'WPRO-45', name: '45mm', priceCents: 27900, stockOnHand: 14 },
    ],
  },
  {
    slug: 'band-woven',
    image: { file: 'band-woven.webp', alt: 'A watch on a tan strap, worn on an outstretched arm' },
    title: 'Woven Band',
    description: 'Recycled polyester band with a stainless clasp. Fits every Watch case size.',
    category: 'wearables',
    variants: [
      { sku: 'BAND-RED', name: 'Red', priceCents: 4900, stockOnHand: 60 },
      { sku: 'BAND-BLK', name: 'Black', priceCents: 4900, stockOnHand: 55 },
    ],
  },
  {
    slug: 'cable-usbc',
    image: { file: 'cable-usbc.webp', alt: 'A coiled white USB-C cable with both connectors in view' },
    title: 'USB-C Cable',
    description: 'Braided 240W USB-C cable, 1.5m, with an inline power indicator.',
    category: 'accessories',
    variants: [{ sku: 'CBL-150', name: '1.5m', priceCents: 2900, stockOnHand: 120 }],
  },
  {
    slug: 'power-brick',
    image: { file: 'power-brick.webp', alt: 'Two white USB-C wall chargers, a large one and a compact one' },
    title: 'Power Brick',
    description: 'A 65W GaN charger with two USB-C ports and folding pins.',
    category: 'accessories',
    variants: [{ sku: 'PWR-65', name: '65W', priceCents: 5900, stockOnHand: 34 }],
  },
  {
    // Deliberately DRAFT: the storefront must never show it, and an integration
    // test asserts exactly that.
    slug: 'phone-three',
    title: 'Phone Three',
    description: 'Unannounced. Present in the database so draft filtering has something to hide.',
    category: 'accessories',
    status: ProductStatus.DRAFT,
    variants: [{ sku: 'PH3-256', name: '256GB', priceCents: 79900, stockOnHand: 0 }],
  },
];
