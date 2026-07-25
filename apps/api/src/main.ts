import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadConfig } from './config/config';

async function bootstrap(): Promise<void> {
  // rawBody exposes req.rawBody, which webhook signature verification needs: the
  // MAC is over the exact bytes received, and re-serialising the parsed JSON
  // changes whitespace and key order enough to invalidate it.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = loadConfig();

  // Behind a platform proxy the socket address is the proxy, not the client.
  // Trusting the first hop is what makes req.ip the address the rate limiter
  // should actually be counting.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // Validation is Zod, in the controllers, against the shared contracts. No
  // Nest ValidationPipe and no class-validator: one definition of each shape.
  app.enableCors({ origin: config.appBaseUrl, credentials: true });
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
