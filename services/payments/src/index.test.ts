import { describe, expect, it } from 'vitest';
import { createGateway, paymentsConfigFromEnv } from './index';
import { PaymentsConfigError } from './types';

describe('paymentsConfigFromEnv', () => {
  it('defaults to the mock driver, so a missing variable never silently means Stripe', () => {
    expect(paymentsConfigFromEnv({}).driver).toBe('mock');
  });

  it('selects stripe only on an exact match', () => {
    expect(paymentsConfigFromEnv({ PAYMENTS_DRIVER: 'stripe' }).driver).toBe('stripe');
    expect(paymentsConfigFromEnv({ PAYMENTS_DRIVER: 'Stripe' }).driver).toBe('mock');
    expect(paymentsConfigFromEnv({ PAYMENTS_DRIVER: 'anything' }).driver).toBe('mock');
  });

  it('reads the rest of the settings with sane defaults', () => {
    const config = paymentsConfigFromEnv({ MOCK_WEBHOOK_SECRET: 's'.repeat(32) });
    expect(config.appBaseUrl).toBe('http://localhost:3000');
    expect(config.currency).toBe('usd');
    expect(config.mockSecret).toBe('s'.repeat(32));
  });
});

describe('createGateway', () => {
  it('builds the mock driver', () => {
    const gateway = createGateway({
      driver: 'mock',
      mockSecret: 'mock-webhook-secret-at-least-32-chars',
      appBaseUrl: 'http://localhost:3000',
      currency: 'usd',
    });
    expect(gateway.name).toBe('mock');
  });

  it('builds the stripe driver', () => {
    const gateway = createGateway({
      driver: 'stripe',
      secretKey: 'not-a-real-stripe-key',
      webhookSecret: 'not-a-real-webhook-secret',
      appBaseUrl: 'http://localhost:3000',
      currency: 'usd',
    });
    expect(gateway.name).toBe('stripe');
  });

  it('fails loudly when stripe is selected with no key, instead of falling back to mock', () => {
    // A deploy that meant stripe and quietly got mock would take orders and never
    // charge for them. That has to be a boot failure, not a warning.
    expect(() =>
      createGateway({
        driver: 'stripe',
        appBaseUrl: 'http://localhost:3000',
        currency: 'usd',
      }),
    ).toThrow(PaymentsConfigError);
  });

  it('fails loudly when mock is selected with no signing secret', () => {
    expect(() =>
      createGateway({ driver: 'mock', appBaseUrl: 'http://localhost:3000', currency: 'usd' }),
    ).toThrow(PaymentsConfigError);
  });
});
