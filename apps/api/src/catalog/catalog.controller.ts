import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  productQuerySchema,
  slugSchema,
  type Category,
  type Product,
  type ProductList,
  type ProductQuery,
} from '@shop/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CatalogService } from './catalog.service';

/** Public storefront catalog. No auth: this is the shop window. */
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('categories')
  listCategories(): Promise<Category[]> {
    return this.catalog.listCategories();
  }

  @Get('products')
  listProducts(
    @Query(new ZodValidationPipe(productQuerySchema)) query: ProductQuery,
  ): Promise<ProductList> {
    return this.catalog.listProducts(query);
  }

  @Get('products/:slug')
  getProduct(@Param('slug', new ZodValidationPipe(slugSchema)) slug: string): Promise<Product> {
    return this.catalog.getProductBySlug(slug);
  }
}
