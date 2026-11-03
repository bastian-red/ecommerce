/**
 * Demo catalog for the storefront, a small-batch ceramics studio: two users,
 * three categories, eight products with variants, real stock and a photograph
 * for each one on sale (data in `seed-data.ts`).
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
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createStorage, storageConfigFromEnv, validateUpload, type StorageDriver } from '@shop/storage';
import { CATEGORIES, PRODUCTS, SEED_IMAGE_DIR, seedImageKey, type SeedProduct } from './seed-data';

const prisma = new PrismaClient();

// Mirror of the hash format used by the web auth layer (apps/web/lib/password.ts).
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

/**
 * Store a product's photo through the same storage contract the admin upload
 * uses, so it is validated (type allowlist, magic bytes, size) the same way and
 * lands wherever the API serves from: the local folder in dev, the bucket on S3.
 * The file is rewritten every run, which also restores it after a wiped volume.
 */
async function seedImage(storage: StorageDriver, productId: string, product: SeedProduct) {
  // Every row the seed ever wrote for this product goes first, whatever file it
  // named: a product whose photo was removed or renamed in seed-data.ts must not
  // keep serving the old one. Admin uploads have random keys without the seed
  // prefix, so they are left alone.
  await prisma.productImage.deleteMany({
    where: { productId, storageKey: { startsWith: seedImageKey(productId, '') } },
  });
  if (!product.image) return;
  const body = await readFile(join(SEED_IMAGE_DIR, product.image.file));
  validateUpload({ contentType: 'image/webp', size: body.length, body });
  const key = seedImageKey(productId, product.image.file);
  await storage.put({ key, body, contentType: 'image/webp' });
  await prisma.productImage.create({
    data: { productId, storageKey: key, alt: product.image.alt, position: 0 },
  });
}

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
  // Same reasoning as the product prune: a category the catalog no longer
  // defines would otherwise stay in the storefront's filter list, leading to an
  // empty page. Products keep `categoryId` as SetNull, so nothing cascades.
  const staleCategories = await prisma.category.deleteMany({
    where: { slug: { notIn: CATEGORIES.map((category) => category.slug) } },
  });
  if (staleCategories.count > 0) {
    console.log(`Pruned ${staleCategories.count} stale categor${staleCategories.count === 1 ? "y" : "ies"}.`);
  }

  const storage = createStorage(storageConfigFromEnv());

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

    await seedImage(storage, row.id, product);
  }

  const variantCount = await prisma.productVariant.count();
  const imageCount = PRODUCTS.filter((product) => product.image).length;
  console.log(
    `Seeded ${CATEGORIES.length} categories, ${PRODUCTS.length} products, ` +
      `${variantCount} variants, ${imageCount} photos (${storage.name} storage). ` +
      `Admin: ${admin.email} / password123`,
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
