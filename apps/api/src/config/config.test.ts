import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const base = { AUTH_SECRET: 'a-test-secret-at-least-16-chars' };

describe('loadConfig', () => {
  it('refuses to boot without an AUTH_SECRET', () => {
    // A mismatched or missing secret is a total auth outage. It has to surface
    // at boot, not on the first admin request.
    expect(() => loadConfig({})).toThrow(/AUTH_SECRET/);
  });

  it('refuses a short AUTH_SECRET', () => {
    expect(() => loadConfig({ AUTH_SECRET: 'short' })).toThrow(/AUTH_SECRET/);
  });

  it('prefers PORT over API_PORT, which is what the deploy platform sets', () => {
    expect(loadConfig({ ...base, PORT: '8080', API_PORT: '4000' }).port).toBe(8080);
    expect(loadConfig({ ...base, API_PORT: '4100' }).port).toBe(4100);
    expect(loadConfig(base).port).toBe(4000);
  });

  it('falls back to the documented defaults on garbage numeric input', () => {
    const config = loadConfig({ ...base, TAX_BASIS_POINTS: 'lots', RESERVATION_TTL_MINUTES: '' });
    expect(config.pricing.taxBasisPoints).toBe(875);
    expect(config.reservationTtlMinutes).toBe(15);
  });

  it('reads the pricing policy', () => {
    const config = loadConfig({
      ...base,
      TAX_BASIS_POINTS: '1900',
      FREE_SHIPPING_THRESHOLD_CENTS: '10000',
      SHIPPING_FLAT_CENTS: '499',
    });
    expect(config.pricing).toEqual({
      taxBasisPoints: 1900,
      freeShippingThresholdCents: 10_000,
      shippingFlatCents: 499,
    });
  });

  it('accepts a zero tax rate rather than treating it as missing', () => {
    expect(loadConfig({ ...base, TAX_BASIS_POINTS: '0' }).pricing.taxBasisPoints).toBe(0);
  });

  it('defaults the drivers to the self-contained ones', () => {
    const config = loadConfig(base);
    expect(config.payments.driver).toBe('mock');
    expect(config.storage.driver).toBe('local');
  });
});
