import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

export const WORKER_HEARTBEAT_KEY = 'worker:heartbeat';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(url: string) {
    // maxRetriesPerRequest: null is what BullMQ requires, and it stops ioredis
    // throwing on transient reconnects.
    this.client = new Redis(url, { maxRetriesPerRequest: null });
    // Without a listener an emitted 'error' takes the process down, and a Redis
    // blip must degrade the cart, not kill the API.
    this.client.on('error', () => undefined);
  }

  /**
   * With maxRetriesPerRequest:null a command issued while disconnected sits in
   * the offline queue indefinitely, which would hang /health. Only ping when the
   * connection is actually ready, so a down Redis fails fast and visibly.
   */
  async ping(): Promise<boolean> {
    if (this.client.status !== 'ready') return false;
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async workerHeartbeat(): Promise<number | null> {
    if (this.client.status !== 'ready') return null;
    try {
      const value = await this.client.get(WORKER_HEARTBEAT_KEY);
      return value ? Number(value) : null;
    } catch {
      return null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
