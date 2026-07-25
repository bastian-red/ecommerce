import { Controller, Get, Inject, NotFoundException, Param, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { StorageValidationError, createStorage, type StorageDriver } from '@shop/storage';
import type { Response } from 'express';
import { CONFIG, type AppConfig } from '../config/config';

/**
 * Serves files stored by the local driver.
 *
 * Two headers matter here. `Content-Type` comes from the stored key's extension,
 * which was itself derived from validated magic bytes, so it can never be
 * `text/html`. `X-Content-Type-Options: nosniff` stops a browser from ignoring
 * that and sniffing its own conclusion, which is the other half of the same
 * stored-XSS defence.
 *
 * With the S3 driver this route is unused; images are served straight from the
 * bucket or CDN.
 */
@SkipThrottle()
@Controller('media')
export class MediaController {
  private readonly storage: StorageDriver;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.storage = createStorage(config.storage);
  }

  // A wildcard, because keys contain slashes (products/<id>/<uuid>.webp).
  @Get('*')
  async serve(@Param('0') key: string, @Res() response: Response): Promise<void> {
    let file;
    try {
      file = await this.storage.get(key);
    } catch (error) {
      if (error instanceof StorageValidationError) throw new NotFoundException();
      throw error;
    }
    if (!file) throw new NotFoundException();

    response
      .setHeader('Content-Type', file.contentType)
      .setHeader('X-Content-Type-Options', 'nosniff')
      // Keys are immutable: a replaced image gets a new UUID, so the old one can
      // be cached indefinitely.
      .setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      .send(file.body);
  }
}
