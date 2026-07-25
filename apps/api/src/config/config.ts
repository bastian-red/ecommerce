import { paymentsConfigFromEnv, type PaymentsConfig } from '@shop/payments';
import { storageConfigFromEnv, type StorageConfig } from '@shop/storage';
import type { PricingPolicy } from '@shop/shared';

export interface AppConfig {
  port: number;
  redisUrl: string;
  authSecret: string;
  appBaseUrl: string;
  apiBaseUrl: string;
  currency: string;
  /** How long a checkout holds stock before the worker releases it. */
  reservationTtlMinutes: number;
  pricing: PricingPolicy;
  payments: PaymentsConfig;
  storage: StorageConfig;
  rateLimits: RateLimits;
  version: string;
}

/**
 * Per-IP request budgets, per minute.
 *
 * These are configurable rather than hardcoded for two reasons. First, the
 * integration suite drives twenty concurrent checkouts from one address, and a
 * limit tight enough for the internet is far too tight for a single-host test
 * run. Second, the right number genuinely depends on the deploy: a store whose
 * customers sit behind one corporate NAT needs a looser checkout budget than one
 * serving residential connections, and that is an operational decision, not a
 * code change.
 */
export interface RateLimits {
  /** Everything not otherwise limited. */
  global: number;
  /** Signup and login: the brute-force surface. */
  auth: number;
  /** Checkout: each one is a call to the payment gateway. */
  checkout: number;
}

/**
 * `Number('')` is 0, not NaN, so an empty variable would silently mean zero.
 * `RESERVATION_TTL_MINUTES=` left blank in a .env would then release every
 * reservation instantly, which is why an empty or whitespace-only value is
 * treated as absent rather than parsed.
 */
function intFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Fails fast on a missing AUTH_SECRET rather than booting with a weak one. The
 * same secret signs the web app's service tokens, so a mismatch here is a total
 * auth outage that must surface at boot, not on the first admin request.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const authSecret = env.AUTH_SECRET;
  if (!authSecret || authSecret.length < 16) {
    throw new Error('AUTH_SECRET must be set (>= 16 chars).');
  }
  return {
    port: intFromEnv(env.PORT ?? env.API_PORT, 4000),
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
    authSecret,
    appBaseUrl: env.APP_BASE_URL ?? 'http://localhost:3000',
    apiBaseUrl: env.API_BASE_URL ?? 'http://localhost:4000',
    currency: env.CURRENCY ?? 'usd',
    reservationTtlMinutes: intFromEnv(env.RESERVATION_TTL_MINUTES, 15),
    pricing: {
      taxBasisPoints: intFromEnv(env.TAX_BASIS_POINTS, 875),
      freeShippingThresholdCents: intFromEnv(env.FREE_SHIPPING_THRESHOLD_CENTS, 5_000),
      shippingFlatCents: intFromEnv(env.SHIPPING_FLAT_CENTS, 599),
    },
    payments: paymentsConfigFromEnv(env),
    storage: storageConfigFromEnv(env),
    rateLimits: rateLimitsFromEnv(env),
    version: env.APP_VERSION ?? '0.1.0',
  };
}

/**
 * Read at module load so the `@Throttle` decorators, which are evaluated at
 * class-definition time and cannot take a runtime value, still honour the
 * environment.
 */
export function rateLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): RateLimits {
  return {
    global: intFromEnv(env.RATE_LIMIT_GLOBAL, 60),
    auth: intFromEnv(env.RATE_LIMIT_AUTH, 5),
    // 30 rather than a tighter number: a shared NAT (an office, a mobile
    // carrier) puts many genuine customers behind one address, and locking them
    // out of checkout costs more than the gateway calls it saves.
    checkout: intFromEnv(env.RATE_LIMIT_CHECKOUT, 30),
  };
}

export const RATE_LIMITS = rateLimitsFromEnv();

export const CONFIG = Symbol('APP_CONFIG');
