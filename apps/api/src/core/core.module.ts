import { Global, Module } from '@nestjs/common';
import { createGateway, type PaymentGateway } from '@shop/payments';
import { CONFIG, loadConfig, type AppConfig } from '../config/config';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { RedisService } from '../redis/redis.service';

export const PAYMENTS = Symbol('PAYMENTS');

/**
 * Global infrastructure providers, built once and shared by every feature
 * module.
 *
 * The gateway is constructed here, at boot, rather than lazily on first use.
 * That means a misconfigured driver (stripe selected with no key) fails the
 * deploy instead of failing the first customer's checkout.
 */
@Global()
@Module({
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    PrismaService,
    {
      provide: RedisService,
      useFactory: (config: AppConfig) => new RedisService(config.redisUrl),
      inject: [CONFIG],
    },
    {
      provide: QueueService,
      useFactory: (redis: RedisService) => new QueueService(redis.client),
      inject: [RedisService],
    },
    {
      provide: PAYMENTS,
      useFactory: (config: AppConfig): PaymentGateway => createGateway(config.payments),
      inject: [CONFIG],
    },
  ],
  exports: [CONFIG, PrismaService, RedisService, QueueService, PAYMENTS],
})
export class CoreModule {}
