import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(url: string) {
    // maxRetriesPerRequest: null stops ioredis throwing on a transient
    // reconnect, which matters on a hosted Redis that closes idle connections.
    // The trade is that a command issued while disconnected queues instead of
    // failing, which is why `ping` checks the status first.
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

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
