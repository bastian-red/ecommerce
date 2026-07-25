import { getPrisma } from '@shop/db';
import { NotificationService, createChannelFromEnv } from '@shop/notifications';
import { QUEUE_NAMES, orderEmailJobSchema, releaseExpiredJobSchema } from '@shop/shared';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import {
  releaseExpiredOrder,
  sendOrderEmail,
  sweepExpiredReservations,
  type WorkerDeps,
} from './handlers';

const WORKER_HEARTBEAT_KEY = 'worker:heartbeat';
const HEARTBEAT_INTERVAL_MS = 15_000;

function intFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function main(): void {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const heartbeatRedis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  connection.on('error', (error) => console.error('[worker] redis error:', error.message));
  heartbeatRedis.on('error', () => undefined);

  const deps: WorkerDeps = {
    prisma: getPrisma(),
    notifications: new NotificationService(createChannelFromEnv()),
    appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
  };

  // Job payloads are parsed with the same contracts the producer used. A queue
  // is an untrusted boundary like any other: a job left over from an older
  // deploy has a shape nobody checked.
  const reservationWorker = new Worker(
    QUEUE_NAMES.reservations,
    async (job) => releaseExpiredOrder(deps, releaseExpiredJobSchema.parse(job.data).orderId),
    { connection, concurrency: 5 },
  );

  const emailWorker = new Worker(
    QUEUE_NAMES.emails,
    async (job) => sendOrderEmail(deps, orderEmailJobSchema.parse(job.data)),
    { connection, concurrency: 5 },
  );

  for (const worker of [reservationWorker, emailWorker]) {
    worker.on('completed', (job, result) => {
      console.log(`[worker] ${job.queueName}/${job.name} ${job.id} -> ${JSON.stringify(result)}`);
    });
    worker.on('failed', (job, error) => {
      console.error(`[worker] ${job?.queueName}/${job?.name} ${job?.id} failed:`, error.message);
    });
  }

  // The sweep is the safety net behind the delayed jobs: it finds past-due
  // reservations regardless of whether their job ever fired.
  const sweepIntervalMs = intFromEnv(process.env.SWEEP_INTERVAL_SECONDS, 30) * 1_000;
  const sweep = async (): Promise<void> => {
    try {
      const result = await sweepExpiredReservations(deps);
      if (result.released > 0) {
        console.log(`[worker] sweep released ${result.released}/${result.scanned} expired orders`);
      }
    } catch (error) {
      console.error('[worker] sweep failed:', (error as Error).message);
    }
  };
  void sweep();
  const sweepTimer = setInterval(() => void sweep(), sweepIntervalMs);

  // Heartbeat so /health can report worker liveness.
  const beat = async (): Promise<void> => {
    try {
      await heartbeatRedis.set(WORKER_HEARTBEAT_KEY, String(Date.now()), 'EX', 60);
    } catch (error) {
      console.error('[worker] heartbeat failed:', (error as Error).message);
    }
  };
  void beat();
  const heartbeatTimer = setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);

  const shutdown = async (): Promise<void> => {
    clearInterval(sweepTimer);
    clearInterval(heartbeatTimer);
    // Close the workers before the connections so in-flight jobs finish rather
    // than being redelivered to the next deploy.
    await Promise.all([reservationWorker.close(), emailWorker.close()]);
    await Promise.all([connection.quit(), heartbeatRedis.quit()]);
    await deps.prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  console.log(
    `[worker] listening on ${QUEUE_NAMES.reservations} and ${QUEUE_NAMES.emails}; ` +
      `sweeping every ${sweepIntervalMs / 1000}s`,
  );
}

main();
