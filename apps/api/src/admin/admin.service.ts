import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, isUniqueViolation } from '@shop/db';
import type {
  AdminImageInput,
  AdminProductInput,
  AdminProductUpdate,
  AdminStockView,
  AdminVariantInput,
  Product,
  ProductImage,
  StockChange,
  StockLedgerEntry,
} from '@shop/shared';
import { buildStorageKey, createStorage, validateUpload, type StorageDriver } from '@shop/storage';
import { CatalogService } from '../catalog/catalog.service';
import { CONFIG, type AppConfig } from '../config/config';
import { InventoryService } from '../inventory/inventory.service';
import { PrismaService } from '../prisma/prisma.service';

const PRODUCT_INCLUDE = {
  category: true,
  images: { orderBy: { position: 'asc' } },
  variants: { orderBy: { position: 'asc' } },
} satisfies Prisma.ProductInclude;

@Injectable()
export class AdminService {
  private readonly storage: StorageDriver;

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly inventory: InventoryService,
    @Inject(CONFIG) config: AppConfig,
  ) {
    this.storage = createStorage(config.storage);
  }

  /** Admin listing shows every status, unlike the storefront's ACTIVE-only view. */
  async listProducts(): Promise<Product[]> {
    const rows = await this.prisma.product.findMany({
      include: PRODUCT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.catalog.toProduct(row));
  }

  async getProduct(id: string): Promise<Product> {
    const row = await this.prisma.product.findUnique({ where: { id }, include: PRODUCT_INCLUDE });
    if (!row) throw new NotFoundException('Product not found');
    return this.catalog.toProduct(row);
  }

  async createProduct(input: AdminProductInput): Promise<Product> {
    try {
      const row = await this.prisma.product.create({
        data: {
          slug: input.slug,
          title: input.title,
          description: input.description,
          status: input.status,
          categoryId: input.categoryId,
        },
        include: PRODUCT_INCLUDE,
      });
      return this.catalog.toProduct(row);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('That slug is already taken');
      throw error;
    }
  }

  async updateProduct(id: string, input: AdminProductUpdate): Promise<Product> {
    try {
      const row = await this.prisma.product.update({
        where: { id },
        data: input,
        include: PRODUCT_INCLUDE,
      });
      return this.catalog.toProduct(row);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('That slug is already taken');
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('Product not found');
      }
      throw error;
    }
  }

  /**
   * Products are archived, never deleted, when they have orders. An order line
   * references the variant with `onDelete: Restrict`, so deleting a sold product
   * would either fail or, with a cascade, destroy order history. Archiving keeps
   * the record and takes it off the storefront, which is what "delete" actually
   * means in a shop.
   */
  async archiveProduct(id: string): Promise<Product> {
    return this.updateProduct(id, { status: 'ARCHIVED' });
  }

  async createVariant(productId: string, input: AdminVariantInput): Promise<Product> {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');

    try {
      await this.prisma.$transaction(async (tx) => {
        const variant = await tx.productVariant.create({
          data: {
            productId,
            sku: input.sku,
            name: input.name,
            priceCents: input.priceCents,
            stockOnHand: input.stockOnHand,
            position: input.position,
          },
        });
        // Initial stock is a ledger movement like any other, so replaying the
        // ledger from zero reconstructs the variant's counters exactly.
        if (input.stockOnHand > 0) {
          await tx.stockLedger.create({
            data: {
              variantId: variant.id,
              kind: 'RESTOCK',
              onHandDelta: input.stockOnHand,
              reservedDelta: 0,
              reason: 'initial stock',
            },
          });
        }
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('That SKU already exists');
      throw error;
    }
    return this.getProduct(productId);
  }

  async updateVariant(
    variantId: string,
    input: Partial<Pick<AdminVariantInput, 'name' | 'priceCents' | 'position'>>,
  ): Promise<Product> {
    // stockOnHand is intentionally not updatable here. Stock only ever moves
    // through InventoryService, so every change leaves a ledger row.
    try {
      const variant = await this.prisma.productVariant.update({
        where: { id: variantId },
        data: input,
        select: { productId: true },
      });
      return this.getProduct(variant.productId);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('Variant not found');
      }
      throw error;
    }
  }

  /** Restock or correct stock. Always a delta, never an absolute value. */
  async changeStock(
    variantId: string,
    change: StockChange,
    actorId: string,
  ): Promise<AdminStockView> {
    if (change.quantity === 0) {
      throw new BadRequestException('A stock change of zero does nothing');
    }
    if (change.kind === 'RESTOCK' && change.quantity < 0) {
      throw new BadRequestException('Use ADJUST for a negative correction');
    }

    const applied = await this.prisma.$transaction((tx) =>
      this.inventory.adjust(tx, variantId, change.kind, change.quantity, change.reason, actorId),
    );

    if (!applied) {
      const variant = await this.prisma.productVariant.findUnique({
        where: { id: variantId },
        select: { stockOnHand: true, stockReserved: true },
      });
      if (!variant) throw new NotFoundException('Variant not found');
      throw new ConflictException(
        `That change would leave ${variant.stockReserved} reserved units unbacked ` +
          `(on hand ${variant.stockOnHand}).`,
      );
    }
    return this.getStock(variantId);
  }

  async getStock(variantId: string): Promise<AdminStockView> {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      include: { product: { select: { title: true } } },
    });
    if (!variant) throw new NotFoundException('Variant not found');
    return {
      variantId: variant.id,
      sku: variant.sku,
      productTitle: variant.product.title,
      variantName: variant.name,
      stockOnHand: variant.stockOnHand,
      stockReserved: variant.stockReserved,
      availableStock: Math.max(variant.stockOnHand - variant.stockReserved, 0),
    };
  }

  async listStock(): Promise<AdminStockView[]> {
    const variants = await this.prisma.productVariant.findMany({
      include: { product: { select: { title: true } } },
      orderBy: [{ product: { title: 'asc' } }, { position: 'asc' }],
    });
    return variants.map((variant) => ({
      variantId: variant.id,
      sku: variant.sku,
      productTitle: variant.product.title,
      variantName: variant.name,
      stockOnHand: variant.stockOnHand,
      stockReserved: variant.stockReserved,
      availableStock: Math.max(variant.stockOnHand - variant.stockReserved, 0),
    }));
  }

  /** The audit trail. Every stock number in the app is explainable from here. */
  async listLedger(variantId?: string, limit = 100): Promise<StockLedgerEntry[]> {
    const rows = await this.prisma.stockLedger.findMany({
      where: variantId ? { variantId } : {},
      include: {
        variant: { select: { sku: true } },
        order: { select: { number: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 500),
    });
    return rows.map((row) => ({
      id: row.id,
      variantId: row.variantId,
      sku: row.variant.sku,
      orderId: row.orderId,
      orderNumber: row.order?.number ?? null,
      kind: row.kind,
      onHandDelta: row.onHandDelta,
      reservedDelta: row.reservedDelta,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /**
   * Store a product image. Validation runs before anything touches the disk or
   * the bucket, and the key is generated rather than derived from the client's
   * filename.
   */
  async addImage(
    productId: string,
    file: { buffer: Buffer; mimetype: string; size: number },
    input: AdminImageInput,
  ): Promise<ProductImage> {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');

    validateUpload({ body: file.buffer, contentType: file.mimetype, size: file.size });
    const key = buildStorageKey(productId, file.mimetype);
    await this.storage.put({ key, body: file.buffer, contentType: file.mimetype });

    const image = await this.prisma.productImage.create({
      data: { productId, storageKey: key, alt: input.alt, position: input.position },
    });
    return {
      id: image.id,
      url: this.storage.urlFor(image.storageKey),
      alt: image.alt,
      position: image.position,
    };
  }

  async deleteImage(imageId: string): Promise<{ ok: true }> {
    const image = await this.prisma.productImage.findUnique({ where: { id: imageId } });
    if (!image) throw new NotFoundException('Image not found');
    // The row goes first. An orphaned file wastes bytes; an orphaned row renders
    // a broken image on the storefront, which is the worse of the two.
    await this.prisma.productImage.delete({ where: { id: imageId } });
    await this.storage.delete(image.storageKey);
    return { ok: true };
  }
}
