import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { QUEUE_NAMES, type OrderEmailJob, type ReleaseExpiredJob } from '@shop/shared';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

/**
 * Producer side of the worker's queues. Two queues, because they have different
 * failure profiles: a reservation release must eventually happen or stock is
 * stranded, while an email that never sends is an annoyance.
 *
 * Every enqueue here is best-effort by design: `enqueue` swallows and logs
 * failures. The reason is that these calls happen inside the checkout and
 * webhook paths, and a Redis outage must not roll back a paid order. The
 * reservation sweeper in apps/worker polls the database directly rather than
 * relying on the delayed job, so a dropped job costs latency, not correctness.
 */
/**
 * BullMQ builds its Redis keys by joining parts with ':', so a custom job id
 * containing one is rejected outright.
 *
 * That rejection used to be invisible: `enqueue` swallows failures by design, so
 * an illegal id meant every confirmation email silently never sent while every
 * test stayed green. The rule is a pure function now, and the gate tests assert
 * it, so the failure cannot come back unnoticed.
 */
export function isValidJobId(jobId: string): boolean {
  return jobId.length > 0 && !jobId.includes(':');
}

export function releaseJobId(orderId: string): string {
  return `release-${orderId}`;
}

export function orderEmailJobId(kind: OrderEmailJob['kind'], orderId: string): string {
  return `${kind}-${orderId}`;
}

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly reservations: Queue<ReleaseExpiredJob>;
  private readonly emails: Queue<OrderEmailJob>;

  constructor(connection: Redis) {
    const defaultJobOptions = {
      attempts: 5,
      backoff: { type: 'exponential' as const, delay: 2_000 },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    };
    this.reservations = new Queue(QUEUE_NAMES.reservations, { connection, defaultJobOptions });
    this.emails = new Queue(QUEUE_NAMES.emails, { connection, defaultJobOptions });
  }

  /** Schedule the release of an order's reservation at its expiry. */
  async enqueueRelease(orderId: string, delayMs: number): Promise<void> {
    await this.enqueue(() =>
      this.reservations.add(
        'release',
        { orderId },
        { delay: Math.max(delayMs, 0), jobId: releaseJobId(orderId) },
      ),
    );
  }

  async enqueueOrderEmail(job: OrderEmailJob): Promise<void> {
    // The job id makes a duplicated webhook that somehow reaches this line
    // still produce one email rather than two.
    await this.enqueue(() =>
      this.emails.add('order-email', job, { jobId: orderEmailJobId(job.kind, job.orderId) }),
    );
  }

  private async enqueue(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.logger.error(
        `Failed to enqueue job: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.reservations.close(), this.emails.close()]);
  }
}
