import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { SIGNATURE_HEADER, WebhookSignatureError, type PaymentGateway } from '@shop/payments';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { PAYMENTS } from '../core/core.module';
import { WebhooksService } from './webhooks.service';

/**
 * The gateway callback.
 *
 * Rate limiting is skipped deliberately. Providers burst hard on retry, and a
 * 429 to Stripe looks like a failure and triggers more retries: a rate limiter
 * here would turn a hiccup into an outage. The endpoint is protected by the
 * signature instead, which is a better gate than an IP counter anyway.
 *
 * Status codes carry meaning to the provider and are chosen precisely:
 *   200 — handled, or a duplicate, or nothing to do. Stop retrying.
 *   400 — signature failed. A retry will fail identically, so do not retry.
 *   503 — we could not process it yet (order not visible). Please retry.
 */
@SkipThrottle()
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly webhooks: WebhooksService,
    @Inject(PAYMENTS) private readonly gateway: PaymentGateway,
  ) {}

  @Post('stripe')
  @HttpCode(200)
  stripe(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: true; detail: string }> {
    return this.receive('stripe', request, signature);
  }

  @Post('mock')
  @HttpCode(200)
  mock(
    @Req() request: RawBodyRequest<Request>,
    @Headers(SIGNATURE_HEADER) signature: string | undefined,
  ): Promise<{ received: true; detail: string }> {
    return this.receive('mock', request, signature);
  }

  private async receive(
    provider: 'stripe' | 'mock',
    request: RawBodyRequest<Request>,
    signature: string | undefined,
  ): Promise<{ received: true; detail: string }> {
    // The endpoint for the inactive driver must not accept anything. Otherwise a
    // production deploy running Stripe would still honour mock webhooks signed
    // with a secret that has leaked into a repo somewhere.
    if (this.gateway.name !== provider) {
      throw new BadRequestException(`The ${provider} webhook endpoint is not active`);
    }

    // Signature verification needs the exact bytes received. Any re-serialisation
    // of the parsed JSON changes key order or whitespace and invalidates the MAC,
    // which is why main.ts creates the app with rawBody: true.
    const raw = request.rawBody;
    if (!raw) {
      throw new BadRequestException('Missing raw request body');
    }

    let event;
    try {
      event = this.gateway.verifyWebhook(raw, signature ?? '');
    } catch (error) {
      if (error instanceof WebhookSignatureError) {
        this.logger.warn(`Rejected ${provider} webhook: ${error.message}`);
        // 400, never 5xx: a bad signature will never become good on a retry.
        throw new BadRequestException('Invalid webhook signature');
      }
      throw error;
    }

    const outcome = await this.webhooks.handle(provider, event);
    if (outcome.retryable) {
      this.logger.warn(`Asking ${provider} to retry ${event.eventId}: ${outcome.detail}`);
      throw new ServiceUnavailableException(outcome.detail);
    }
    return { received: true, detail: outcome.detail };
  }
}
