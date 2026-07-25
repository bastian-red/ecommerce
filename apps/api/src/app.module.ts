import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { RolesGuard } from './auth/roles.guard';
import { CartController } from './cart/cart.controller';
import { CartService } from './cart/cart.service';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { CheckoutController } from './checkout/checkout.controller';
import { CheckoutService } from './checkout/checkout.service';
import { RATE_LIMITS } from './config/config';
import { CoreModule } from './core/core.module';
import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { InventoryService } from './inventory/inventory.service';
import { MediaController } from './media/media.controller';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { RedisService } from './redis/redis.service';
import { WebhooksController } from './webhooks/webhooks.controller';
import { WebhooksService } from './webhooks/webhooks.service';

@Module({
  imports: [
    CoreModule,
    // Rate limiting is backed by the same Redis the cart uses, so limits are
    // shared across instances and survive a restart. An in-memory limiter on a
    // two-instance deploy is a limiter that permits twice what it says.
    ThrottlerModule.forRootAsync({
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [{ ttl: 60_000, limit: RATE_LIMITS.global }],
        storage: new ThrottlerStorageRedisService(redis.client),
      }),
    }),
  ],
  controllers: [
    HealthController,
    AuthController,
    CatalogController,
    CartController,
    CheckoutController,
    WebhooksController,
    OrdersController,
    AdminController,
    MediaController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    AuthGuard,
    RolesGuard,
    AuthService,
    HealthService,
    CatalogService,
    CartService,
    InventoryService,
    CheckoutService,
    WebhooksService,
    OrdersService,
    AdminService,
  ],
})
export class AppModule {}
