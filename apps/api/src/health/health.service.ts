import { Inject, Injectable } from '@nestjs/common';
import type { Health } from '@shop/shared';
import { withTimeout } from '../common/with-timeout';
import { CONFIG, type AppConfig } from '../config/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const CHECK_TIMEOUT_MS = 2_000;

/**
 * A health check that actually checks. Returning 200 while Postgres is
 * unreachable is worse than no health check at all: the monitor stays green
 * through an outage, so the first report comes from a customer.
 */
@Injectable()
export class HealthService {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async check(): Promise<Health> {
    // Each probe is bounded, so a hung dependency yields a fast 503 rather than
    // a request that never returns and reads as a timeout to the monitor.
    const [database, redis] = await Promise.all([
      withTimeout(this.checkDatabase(), false, CHECK_TIMEOUT_MS),
      withTimeout(this.redis.ping(), false, CHECK_TIMEOUT_MS),
    ]);

    return {
      status: database && redis ? 'ok' : 'degraded',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      checks: { database, redis },
      version: this.config.version,
      timestamp: new Date().toISOString(),
    };
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
