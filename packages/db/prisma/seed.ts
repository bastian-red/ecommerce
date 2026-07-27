/**
 * Demo catalog for the storefront: two users, three categories, eight products
 * with variants and real stock.
 *
 * Passwords: admin@shop.local / customer@shop.local, both "password123".
 *
 * Idempotent by construction: every row is written through `upsert` on a natural
 * key (email, slug, sku), so running this twice converges on the same state
 * instead of duplicating the catalog. Stock is set absolutely rather than
 * incremented, so a re-seed also resets a database an E2E run drained.
 */
import { PrismaClient, ProductStatus } from '../generated/client';
import { randomBytes, scryptSync } from 'node:crypto';

const prisma = new PrismaClient();

// Mirror of the hash format used by the web auth layer (apps/web/lib/password.ts).
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

type SeedVariant = {
  sku: string;
  name: string;
  priceCents: number;
  stockOnHand: number;
};

type SeedProduct = {
  slug: string;
  title: string;
  description: string;
  category: string;
  status?: ProductStatus;
  variants: SeedVariant[];
};

const CATEGORIES: Array<{ slug: string; name: string }> = [
  { slug: 'audio', name: 'Audio' },
  { slug: 'wearables', name: 'Wearables' },
  { slug: 'accessories', name: 'Accessories' },
];

const PRODUCTS: SeedProduct[] = [
  {
    slug: 'ear-one',
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
    title: 'Ear Open',
    description:
      'Open-ear clips that leave the canal free. Directional drivers keep the sound in and the ' +
      'street audible.',
    category: 'audio',
    variants: [{ sku: 'EARO-WHT', name: 'White', priceCents: 19900, stockOnHand: 7 }],
  },
  {
    slug: 'monitor-speaker',
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
    title: 'USB-C Cable',
    description: 'Braided 240W USB-C cable, 1.5m, with an inline power indicator.',
    category: 'accessories',
    variants: [{ sku: 'CBL-150', name: '1.5m', priceCents: 2900, stockOnHand: 120 }],
  },
  {
    slug: 'power-brick',
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

/**
 * Remove every product this file does not define, and everything hanging off it.
 *
 * The E2E suite creates products (`e2e-widget-<timestamp>`) and never removes
 * them, so without this they accumulate on every run until the admin screens are
 * mostly test debris. Upserting the seed set alone does not fix that: it can
 * only add and update, never delete, so the "clean slate" this file promises was
 * not true.
 *
 * Deletion order is dictated by the foreign keys. `OrderItem.variantId` is
 * `onDelete: Restrict`, so a variant that was ever ordered cannot be dropped
 * while the order exists. Deleting the order first cascades its items and
 * payments and nulls the ledger's `orderId`; deleting the product then cascades
 * its variants, images and their ledger rows.
 */
async function pruneNonSeedProducts(): Promise<number> {
  const doomed = await prisma.product.findMany({
    where: { slug: { notIn: PRODUCTS.map((product) => product.slug) } },
    select: { id: true, variants: { select: { id: true } } },
  });
  if (doomed.length === 0) return 0;

  const variantIds = doomed.flatMap((product) => product.variants.map((variant) => variant.id));

  if (variantIds.length > 0) {
    const orderIds = (
      await prisma.orderItem.findMany({
        where: { variantId: { in: variantIds } },
        select: { orderId: true },
        distinct: ['orderId'],
      })
    ).map((item) => item.orderId);

    if (orderIds.length > 0) {
      // WebhookEvent.orderId is a plain column with no foreign key, so its rows
      // would otherwise point at orders that no longer exist.
      await prisma.webhookEvent.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
  }

  await prisma.product.deleteMany({ where: { id: { in: doomed.map((p) => p.id) } } });
  return doomed.length;
}

async function main() {
  const pruned = await pruneNonSeedProducts();
  if (pruned > 0) {
    console.log(`Pruned ${pruned} product(s) left behind by earlier test runs.`);
  }

  const admin = await prisma.user.upsert({
    where: { email: 'admin@shop.local' },
    update: { role: 'ADMIN' },
    create: {
      email: 'admin@shop.local',
      name: 'Store Admin',
      passwordHash: hashPassword('password123'),
      role: 'ADMIN',
    },
  });

  await prisma.user.upsert({
    where: { email: 'customer@shop.local' },
    update: {},
    create: {
      email: 'customer@shop.local',
      name: 'Demo Customer',
      passwordHash: hashPassword('password123'),
      role: 'CUSTOMER',
    },
  });

  const categoryIds = new Map<string, string>();
  for (const category of CATEGORIES) {
    const row = await prisma.category.upsert({
      where: { slug: category.slug },
      update: { name: category.name },
      create: category,
    });
    categoryIds.set(category.slug, row.id);
  }

  for (const product of PRODUCTS) {
    const categoryId = categoryIds.get(product.category);
    if (!categoryId) throw new Error(`seed: unknown category ${product.category}`);

    const row = await prisma.product.upsert({
      where: { slug: product.slug },
      update: {
        title: product.title,
        description: product.description,
        status: product.status ?? ProductStatus.ACTIVE,
        categoryId,
      },
      create: {
        slug: product.slug,
        title: product.title,
        description: product.description,
        status: product.status ?? ProductStatus.ACTIVE,
        categoryId,
      },
    });

    for (const [position, variant] of product.variants.entries()) {
      // stockReserved is reset to 0 alongside stockOnHand: a re-seed is a clean
      // slate, not a merge with whatever reservations a previous run left behind.
      await prisma.productVariant.upsert({
        where: { sku: variant.sku },
        update: {
          productId: row.id,
          name: variant.name,
          priceCents: variant.priceCents,
          stockOnHand: variant.stockOnHand,
          stockReserved: 0,
          position,
        },
        create: {
          productId: row.id,
          sku: variant.sku,
          name: variant.name,
          priceCents: variant.priceCents,
          stockOnHand: variant.stockOnHand,
          stockReserved: 0,
          position,
        },
      });
    }
  }

  const variantCount = await prisma.productVariant.count();
  console.log(
    `Seeded ${CATEGORIES.length} categories, ${PRODUCTS.length} products, ` +
      `${variantCount} variants. Admin: ${admin.email} / password123`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
