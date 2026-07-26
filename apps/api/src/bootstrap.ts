import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadConfig, type AppConfig } from './config/config';

/**
 * Build the application, configured identically wherever it runs.
 *
 * There are two entry points — a long-running container (`main.ts`) and a
 * serverless handler (`vercel-handler.ts`) — and every setting that differs
 * between them is a bug waiting to happen. `rawBody` in particular: forget it in
 * one place and webhook signature verification fails there and only there, which
 * is the kind of defect that reaches production because it passes locally.
 *
 * So both call this. The only thing they do differently is how they serve it.
 */
export async function createApp(): Promise<{ app: INestApplication; config: AppConfig }> {
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

  return { app, config };
}
