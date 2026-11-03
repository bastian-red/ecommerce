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
  { slug: 'drinkware', name: 'Drinkware' },
  { slug: 'tableware', name: 'Tableware' },
  { slug: 'objects', name: 'Objects' },
];

/**
 * A small-batch ceramics studio. Every piece comes out of one kiln firing, so
 * stock is genuinely scarce: the tea bowl's seven units are what the oversell
 * race fights over, and the jug's three oxblood units are the low-stock case.
 *
 * Within a product, the first variant is the glaze the photo shows, because the
 * product page preselects it.
 */
export const PRODUCTS: SeedProduct[] = [
  {
    slug: 'kiln-mug',
    image: { file: 'kiln-mug.webp', alt: 'An ash-white glazed stoneware mug on a wooden table against a pale wall' },
    title: 'Kiln Mug',
    description:
      'Wheel-thrown stoneware mug, 350 ml, with a pulled handle and a thumb rest. Glazed inside ' +
      'and out and fired to cone 6; dishwasher and microwave safe.',
    category: 'drinkware',
    variants: [
      { sku: 'MUG-ASH', name: 'Ash white', priceCents: 3800, stockOnHand: 42 },
      { sku: 'MUG-OXB', name: 'Oxblood', priceCents: 3800, stockOnHand: 18 },
    ],
  },
  {
    slug: 'tea-bowl',
    image: {
      file: 'tea-bowl.webp',
      alt: 'A white stoneware bowl with a celadon-glazed interior and small square tabs around its rim',
    },
    title: 'Tea Bowl',
    description:
      'A wide, low bowl for matcha or a slow pot of sencha, 400 ml. Celadon inside, white satin ' +
      'outside, hand-cut tabs around the rim. Hand wash only.',
    category: 'drinkware',
    variants: [{ sku: 'BOWL-CEL', name: 'Celadon', priceCents: 5400, stockOnHand: 7 }],
  },
  {
    slug: 'pouring-jug',
    image: { file: 'pouring-jug.webp', alt: 'A rustic ash-white stoneware jug with a pinched spout and a loop handle' },
    title: 'Pouring Jug',
    description:
      'A 600 ml jug for milk, water or a few stems, its spout pinched by hand so it pours without ' +
      'dripping. Iron-speckled clay shows through the glaze; dishwasher safe.',
    category: 'drinkware',
    variants: [
      { sku: 'JUG-ASH', name: 'Ash white', priceCents: 4600, stockOnHand: 11 },
      { sku: 'JUG-OXB', name: 'Oxblood', priceCents: 4600, stockOnHand: 3 },
    ],
  },
  {
    slug: 'dinner-plate',
    image: {
      file: 'dinner-plate.webp',
      alt: 'Four cream stoneware dinner plates stacked, a mandarin on top and a mustard napkin beside them',
    },
    title: 'Stoneware Dinner Plate',
    description:
      'A 27 cm plate with a raised foot ring, so a stack sits flat in the cupboard. Satin oat glaze ' +
      'that does not show cutlery marks; dishwasher safe.',
    category: 'tableware',
    variants: [
      { sku: 'PLATE-1', name: 'Single', priceCents: 3200, stockOnHand: 25 },
      { sku: 'PLATE-4', name: 'Set of 4', priceCents: 11900, stockOnHand: 14 },
    ],
  },
  {
    slug: 'serving-bowl',
    image: { file: 'serving-bowl.webp', alt: 'A deep white speckled stoneware serving bowl on a pale grey surface' },
    title: 'Serving Bowl',
    description:
      'A 26 cm bowl for salads and pasta, thrown thick enough to keep warm food warm. The clay ' +
      'speckles through the glaze at the rim; dishwasher safe.',
    category: 'tableware',
    variants: [
      { sku: 'SERVE-SPK', name: 'Speckled', priceCents: 8900, stockOnHand: 60 },
      { sku: 'SERVE-OXB', name: 'Oxblood', priceCents: 8900, stockOnHand: 55 },
    ],
  },
  {
    slug: 'bud-vase',
    image: { file: 'bud-vase.webp', alt: 'A small round matte white bud vase with a narrow neck on a grey ground' },
    title: 'Bud Vase',
    description:
      'A 12 cm vase for a single stem. Unglazed and matte outside, glazed inside so it holds water.',
    category: 'objects',
    variants: [{ sku: 'VASE-SM', name: 'Small', priceCents: 2900, stockOnHand: 120 }],
  },
  {
    slug: 'tall-vase',
    image: { file: 'tall-vase.webp', alt: 'A tall bottle vase in a deep oxblood glaze, its lip fading to pale, on white' },
    title: 'Tall Vase',
    description:
      'A 30 cm bottle vase dipped in our oxblood glaze, which breaks pale where it runs thin at the ' +
      'lip. Watertight; wipe clean.',
    category: 'objects',
    variants: [{ sku: 'VASE-TL', name: 'Tall', priceCents: 6900, stockOnHand: 34 }],
  },
  {
    // Deliberately DRAFT: the storefront must never show it, and an integration
    // test asserts exactly that.
    slug: 'teapot',
    title: 'Teapot',
    description: 'Next kiln batch. Present in the database so draft filtering has something to hide.',
    category: 'objects',
    status: ProductStatus.DRAFT,
    variants: [{ sku: 'POT-1', name: 'Stoneware', priceCents: 14900, stockOnHand: 0 }],
  },
];
