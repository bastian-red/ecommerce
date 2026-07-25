import { describe, expect, it } from 'vitest';
import { createStorage, storageConfigFromEnv } from './index';
import { StorageConfigError } from './types';

describe('storageConfigFromEnv', () => {
  it('defaults to the local driver', () => {
    expect(storageConfigFromEnv({}).driver).toBe('local');
  });

  it('selects s3 only on an exact match', () => {
    expect(storageConfigFromEnv({ STORAGE_DRIVER: 's3' }).driver).toBe('s3');
    expect(storageConfigFromEnv({ STORAGE_DRIVER: 'S3' }).driver).toBe('local');
  });

  it('carries the documented local defaults', () => {
    const config = storageConfigFromEnv({});
    expect(config.localDir).toBe('./var/uploads');
    expect(config.publicUrl).toBe('http://localhost:4000/media');
  });
});

describe('createStorage', () => {
  it('builds the local driver', () => {
    expect(
      createStorage({ driver: 'local', localDir: '/tmp/shop', publicUrl: 'http://x/media' }).name,
    ).toBe('local');
  });

  it('builds the s3 driver', () => {
    expect(
      createStorage({
        driver: 's3',
        bucket: 'shop-media',
        region: 'us-east-1',
        publicUrl: 'https://cdn.example.com',
      }).name,
    ).toBe('s3');
  });

  it('fails loudly when s3 is selected with no bucket', () => {
    expect(() =>
      createStorage({ driver: 's3', region: 'us-east-1', publicUrl: 'https://cdn.example.com' }),
    ).toThrow(StorageConfigError);
  });

  it('fails loudly when s3 is selected with no region', () => {
    expect(() =>
      createStorage({ driver: 's3', bucket: 'b', publicUrl: 'https://cdn.example.com' }),
    ).toThrow(StorageConfigError);
  });
});
