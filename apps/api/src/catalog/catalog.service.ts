import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@shop/db';
import type { Category, Product, ProductList, ProductQuery } from '@shop/shared';
import { createStorage, type StorageDriver } from '@shop/storage';
import { CONFIG, type AppConfig } from '../config/config';
import { PrismaService } from '../prisma/prisma.service';

const PRODUCT_INCLUDE = {
  category: true,
  images: { orderBy: { position: 'asc' } },
  variants: { orderBy: { position: 'asc' } },
} satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>;

@Injectable()
export class CatalogService {
  private readonly storage: StorageDriver;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG) config: AppConfig,
  ) {
    this.storage = createStorage(config.storage);
  }

  async listCategories(): Promise<Category[]> {
    const rows = await this.prisma.category.findMany({ orderBy: { name: 'asc' } });
    return rows.map((row) => ({ id: row.id, slug: row.slug, name: row.name }));
  }

  /**
   * Storefront listing. ACTIVE products only, always: DRAFT and ARCHIVED are
   * filtered in the query rather than in the mapper, so there is no code path
   * that could return an unpublished product to a customer.
   */
  async listProducts(query: ProductQuery): Promise<ProductList> {
    const ids = await this.findMatchingIds(query);
    const skip = (query.page - 1) * query.perPage;
    const pageIds = ids.slice(skip, skip + query.perPage);

    const rows = pageIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: pageIds } },
          include: PRODUCT_INCLUDE,
        })
      : [];

    // findMany does not preserve the ordering of an IN list, so the ranked order
    // computed by the search query is reapplied here.
    const byId = new Map(rows.map((row) => [row.id, row]));
    const items = pageIds
      .map((id) => byId.get(id))
      .filter((row): row is ProductRow => row !== undefined)
      .map((row) => this.toProduct(row));

    return {
      items,
      total: ids.length,
      page: query.page,
      perPage: query.perPage,
      totalPages: Math.ceil(ids.length / query.perPage),
    };
  }

  /**
   * Filtering and ranking happen in one raw query because full-text search needs
   * `websearch_to_tsquery` and `ts_rank`, which Prisma's query builder cannot
   * express against the GIN expression index the migration creates.
   *
   * `websearch_to_tsquery` is used rather than `to_tsquery` specifically because
   * it never throws on arbitrary user input: `to_tsquery('a & & b')` is a 500 on
   * a search box, and sanitising the input by hand is a losing game.
   */
  private async findMatchingIds(query: ProductQuery): Promise<string[]> {
    const conditions: Prisma.Sql[] = [Prisma.sql`p."status" = 'ACTIVE'::"ProductStatus"`];

    if (query.category) {
      conditions.push(Prisma.sql`c."slug" = ${query.category}`);
    }
    if (query.q) {
      conditions.push(
        Prisma.sql`(
          setweight(to_tsvector('english', coalesce(p."title", '')), 'A') ||
          setweight(to_tsvector('english', coalesce(p."description", '')), 'B')
        ) @@ websearch_to_tsquery('english', ${query.q})`,
      );
    }
    // Price and stock filters are about variants, so they are EXISTS subqueries:
    // a product matches when any of its variants does.
    if (query.minPriceCents !== undefined) {
      conditions.push(
        Prisma.sql`EXISTS (SELECT 1 FROM "product_variants" v WHERE v."product_id" = p."id" AND v."price_cents" >= ${query.minPriceCents})`,
      );
    }
    if (query.maxPriceCents !== undefined) {
      conditions.push(
        Prisma.sql`EXISTS (SELECT 1 FROM "product_variants" v WHERE v."product_id" = p."id" AND v."price_cents" <= ${query.maxPriceCents})`,
      );
    }
    if (query.inStock) {
      conditions.push(
        Prisma.sql`EXISTS (SELECT 1 FROM "product_variants" v WHERE v."product_id" = p."id" AND v."stock_on_hand" - v."stock_reserved" > 0)`,
      );
    }

    const where = Prisma.join(conditions, ' AND ');
    const rank = query.q
      ? Prisma.sql`ts_rank(
          setweight(to_tsvector('english', coalesce(p."title", '')), 'A') ||
          setweight(to_tsvector('english', coalesce(p."description", '')), 'B'),
          websearch_to_tsquery('english', ${query.q})
        )`
      : Prisma.sql`0`;

    const orderBy = this.orderByFor(query, rank);

    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT p."id",
             (SELECT MIN(v."price_cents") FROM "product_variants" v WHERE v."product_id" = p."id") AS min_price,
             ${rank} AS rank
        FROM "products" p
        LEFT JOIN "categories" c ON c."id" = p."category_id"
       WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT 1000`);

    return rows.map((row) => row.id);
  }

  // `rank` is aliased into the SELECT list, so ORDER BY refers to it by name
  // rather than repeating the expression. The parameter documents that
  // dependency even though only one branch mentions it.
  private orderByFor(query: ProductQuery, _rank: Prisma.Sql): Prisma.Sql {
    switch (query.sort) {
      case 'price_asc':
        return Prisma.sql`min_price ASC NULLS LAST, p."created_at" DESC`;
      case 'price_desc':
        return Prisma.sql`min_price DESC NULLS LAST, p."created_at" DESC`;
      case 'relevance':
        // Relevance without a search term is meaningless, so it degrades to
        // newest rather than returning an arbitrary order.
        return query.q ? Prisma.sql`rank DESC, p."created_at" DESC` : Prisma.sql`p."created_at" DESC`;
      case 'newest':
      default:
        return Prisma.sql`p."created_at" DESC`;
    }
  }

  /** Storefront product page. 404 on anything not ACTIVE. */
  async getProductBySlug(slug: string): Promise<Product> {
    const row = await this.prisma.product.findFirst({
      where: { slug, status: 'ACTIVE' },
      include: PRODUCT_INCLUDE,
    });
    if (!row) throw new NotFoundException('Product not found');
    return this.toProduct(row);
  }

  /**
   * The single mapper from a database row to the public product shape. It exists
   * so `stockOnHand` and `stockReserved` cannot leak: the storefront gets
   * `availableStock` and nothing else, because how much is merely reserved is
   * pending-order volume and none of a customer's business.
   */
  toProduct(row: ProductRow): Product {
    const variants = row.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      name: variant.name,
      priceCents: variant.priceCents,
      availableStock: Math.max(variant.stockOnHand - variant.stockReserved, 0),
      position: variant.position,
    }));

    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: row.description,
      status: row.status,
      category: row.category
        ? { id: row.category.id, slug: row.category.slug, name: row.category.name }
        : null,
      images: row.images.map((image) => ({
        id: image.id,
        url: this.storage.urlFor(image.storageKey),
        alt: image.alt,
        position: image.position,
      })),
      variants,
      fromPriceCents: variants.length
        ? Math.min(...variants.map((variant) => variant.priceCents))
        : 0,
    };
  }
}
