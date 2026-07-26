import { Logger } from '@nestjs/common';
import { createApp } from './bootstrap';

/**
 * The long-running entry point: Docker, or any host that runs a process.
 * The serverless equivalent is `vercel-handler.ts`; both share `createApp`.
 */
async function bootstrap(): Promise<void> {
  const { app, config } = await createApp();

  // Only meaningful for a process that can be signalled. A serverless
  // invocation is frozen rather than shut down, so the handler skips this.
  app.enableShutdownHooks();

  // 0.0.0.0 rather than localhost: a container that binds the loopback answers
  // nothing from outside itself, and the platform's health probe fails.
  await app.listen(config.port, '0.0.0.0');
  Logger.log(
    `API listening on :${config.port} (payments: ${config.payments.driver}, storage: ${config.storage.driver})`,
    'Bootstrap',
  );
}

void bootstrap();
