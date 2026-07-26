import type { Express } from 'express';
import { createApp } from './bootstrap';

/**
 * The serverless entry point.
 *
 * ## Why the promise is module-scoped
 *
 * Bootstrapping Nest means building the whole dependency graph, opening a Prisma
 * client and connecting to Redis. Doing that per request would put a second or
 * more on every call and open a new database connection each time, which is how
 * a serverless deploy exhausts a Postgres connection limit.
 *
 * A serverless runtime keeps the module instance alive between invocations that
 * land on the same warm container, so caching the promise here means the cost is
 * paid once per container rather than once per request. The promise, not the
 * resolved app: two requests arriving during a cold start both await the same
 * bootstrap instead of racing two of them.
 *
 * ## What is deliberately missing
 *
 * `enableShutdownHooks` and `listen`. A serverless invocation is frozen, not
 * signalled, so shutdown hooks would never fire, and the platform owns the
 * socket. `app.init()` wires everything up without binding a port; the Express
 * instance underneath is what the platform then calls.
 *
 * `rawBody` comes from `createApp`, shared with the container entry point,
 * because webhook signature verification depends on it and an entry point that
 * quietly omitted it would fail only in production.
 */
let cached: Promise<Express> | undefined;

async function build(): Promise<Express> {
  const { app } = await createApp();
  await app.init();
  return app.getHttpAdapter().getInstance() as Express;
}

export function getExpressApp(): Promise<Express> {
  cached ??= build().catch((error: unknown) => {
    // Do not cache a failed bootstrap: a transient failure (a database asleep,
    // a cold Redis) must not poison every later request on this container.
    cached = undefined;
    throw error;
  });
  return cached;
}

/** The platform's handler. Delegates to Express once the app is up. */
export default async function handler(request: unknown, response: unknown): Promise<void> {
  const app = await getExpressApp();
  (app as unknown as (req: unknown, res: unknown) => void)(request, response);
}
