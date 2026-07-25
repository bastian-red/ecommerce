import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  adminImageInputSchema,
  adminProductInputSchema,
  adminProductUpdateSchema,
  adminVariantInputSchema,
  idSchema,
  orderListQuerySchema,
  stockChangeSchema,
  type AdminProductInput,
  type AdminProductUpdate,
  type AdminStockView,
  type AdminVariantInput,
  type Order,
  type OrderList,
  type OrderListQuery,
  type Product,
  type ProductImage,
  type StockChange,
  type StockLedgerEntry,
} from '@shop/shared';
import { MAX_UPLOAD_BYTES } from '@shop/storage';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser, type CurrentUserInfo } from '../auth/current-user.decorator';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { OrdersService } from '../orders/orders.service';
import { AdminService } from './admin.service';

/**
 * Both guards, on the controller, in this order: AuthGuard resolves the user,
 * RolesGuard checks the role. Applying them per-handler would eventually mean
 * one handler missing one of them, and that handler would be the whole admin
 * panel exposed.
 */
@UseGuards(AuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly orders: OrdersService,
  ) {}

  // ---- Products ----

  @Get('products')
  listProducts(): Promise<Product[]> {
    return this.admin.listProducts();
  }

  @Get('products/:id')
  getProduct(@Param('id', new ZodValidationPipe(idSchema)) id: string): Promise<Product> {
    return this.admin.getProduct(id);
  }

  @Post('products')
  createProduct(
    @Body(new ZodValidationPipe(adminProductInputSchema)) body: AdminProductInput,
  ): Promise<Product> {
    return this.admin.createProduct(body);
  }

  @Patch('products/:id')
  updateProduct(
    @Param('id', new ZodValidationPipe(idSchema)) id: string,
    @Body(new ZodValidationPipe(adminProductUpdateSchema)) body: AdminProductUpdate,
  ): Promise<Product> {
    return this.admin.updateProduct(id, body);
  }

  @Delete('products/:id')
  archiveProduct(@Param('id', new ZodValidationPipe(idSchema)) id: string): Promise<Product> {
    return this.admin.archiveProduct(id);
  }

  // ---- Variants ----

  @Post('products/:id/variants')
  createVariant(
    @Param('id', new ZodValidationPipe(idSchema)) id: string,
    @Body(new ZodValidationPipe(adminVariantInputSchema)) body: AdminVariantInput,
  ): Promise<Product> {
    return this.admin.createVariant(id, body);
  }

  @Patch('variants/:id')
  updateVariant(
    @Param('id', new ZodValidationPipe(idSchema)) id: string,
    @Body(new ZodValidationPipe(adminVariantInputSchema.partial().omit({ sku: true, stockOnHand: true })))
    body: Partial<Pick<AdminVariantInput, 'name' | 'priceCents' | 'position'>>,
  ): Promise<Product> {
    return this.admin.updateVariant(id, body);
  }

  // ---- Stock ----

  @Get('stock')
  listStock(): Promise<AdminStockView[]> {
    return this.admin.listStock();
  }

  @Post('variants/:id/stock')
  changeStock(
    @CurrentUser() user: CurrentUserInfo,
    @Param('id', new ZodValidationPipe(idSchema)) id: string,
    @Body(new ZodValidationPipe(stockChangeSchema)) body: StockChange,
  ): Promise<AdminStockView> {
    return this.admin.changeStock(id, body, user.id);
  }

  @Get('ledger')
  listLedger(@Query('variantId') variantId?: string): Promise<StockLedgerEntry[]> {
    return this.admin.listLedger(variantId);
  }

  // ---- Images ----

  @Post('products/:id/images')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  addImage(
    @Param('id', new ZodValidationPipe(idSchema)) id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body(new ZodValidationPipe(adminImageInputSchema)) body: { alt: string; position: number },
  ): Promise<ProductImage> {
    return this.admin.addImage(id, file, body);
  }

  @Delete('images/:id')
  deleteImage(@Param('id', new ZodValidationPipe(idSchema)) id: string): Promise<{ ok: true }> {
    return this.admin.deleteImage(id);
  }

  // ---- Orders ----

  @Get('orders')
  listOrders(
    @Query(new ZodValidationPipe(orderListQuerySchema)) query: OrderListQuery,
  ): Promise<OrderList> {
    return this.orders.listAll(query);
  }

  @Post('orders/:id/fulfill')
  fulfillOrder(
    @CurrentUser() user: CurrentUserInfo,
    @Param('id', new ZodValidationPipe(idSchema)) id: string,
  ): Promise<Order> {
    return this.orders.fulfill(id, user.role);
  }
}
