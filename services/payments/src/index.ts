/**
 * Payments service entry point. Callers import `createGateway` and the contract
 * types; nothing else.
 */
import { createMockGateway } from './mock-driver';
import { createStripeGateway } from './stripe-driver';
import { PaymentsConfigError, type PaymentGateway, type PaymentsConfig } from './types';

export * from './types';
export * from './signature';
export {
  MOCK_EVENT_TYPES,
  buildMockWebhookRequest,
  createMockGateway,
  isMockEventType,
  parseMockEvent,
  type MockEvent,
  type MockEventType,
} from './mock-driver';
export { STRIPE_API_VERSION, createStripeGateway, parseStripeEvent } from './stripe-driver';

/** Read config from the environment. Validation happens in `createGateway`. */
export function paymentsConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PaymentsConfig {
  const driver = env.PAYMENTS_DRIVER === 'stripe' ? 'stripe' : 'mock';
  return {
    driver,
    secretKey: env.STRIPE_SECRET_KEY,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    mockSecret: env.MOCK_WEBHOOK_SECRET,
    appBaseUrl: env.APP_BASE_URL ?? 'http://localhost:3000',
    currency: env.CURRENCY ?? 'usd',
  };
}

/**
 * The one place a driver is chosen. It throws rather than falling back: a
 * production deploy that meant `stripe` and silently got `mock` would take
 * orders and never charge for them, so a missing key has to fail loudly at boot.
 */
export function createGateway(config: PaymentsConfig): PaymentGateway {
  switch (config.driver) {
    case 'stripe':
      return createStripeGateway({
        secretKey: config.secretKey ?? '',
        webhookSecret: config.webhookSecret ?? '',
        currency: config.currency,
      });
    case 'mock':
      return createMockGateway({
        secret: config.mockSecret ?? '',
        appBaseUrl: config.appBaseUrl,
      });
    default: {
      const exhaustive: never = config.driver;
      throw new PaymentsConfigError(`Unknown PAYMENTS_DRIVER: ${String(exhaustive)}`);
    }
  }
}
