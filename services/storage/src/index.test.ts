import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, createStorage, resolveLocalDir, storageConfigFromEnv } from './index';
import { StorageConfigError } from './types';

describe('storageConfigFromEnv', () => {
  it('defaults to the local driver', () => {
    expect(storageConfigFromEnv({}).driver).toBe('local');
  });

  it('selects s3 only on an exact match', () => {
    expect(storageConfigFromEnv({ STORAGE_DRIVER: 's3' }).driver).toBe('s3');
    expect(storageConfigFromEnv({ STORAGE_DRIVER: 'S3' }).driver).toBe('local');
  });

  it('carries the documented local defaults, anchored at the repo root', () => {
    const config = storageConfigFromEnv({}, '/repo');
    expect(config.localDir).toBe('/repo/var/uploads');
    expect(config.publicUrl).toBe('http://localhost:4000/media');
  });

  it('resolves a relative dir against the root, not the cwd', () => {
    // The seed (cwd packages/db) and the API (cwd apps/api or the root) must
    // agree on one folder, or a seeded photo is a 404 for the API.
    const before = process.cwd();
    try {
      process.chdir(join(REPO_ROOT, 'services'));
      expect(storageConfigFromEnv({ STORAGE_LOCAL_DIR: './var/uploads' }).localDir).toBe(
        join(REPO_ROOT, 'var', 'uploads'),
      );
    } finally {
      process.chdir(before);
    }
  });

  it('keeps an absolute dir as given', () => {
    expect(resolveLocalDir('/data/uploads', '/repo')).toBe('/data/uploads');
  });
});

describe('REPO_ROOT', () => {
  it('is the monorepo root', () => {
    expect(existsSync(join(REPO_ROOT, 'pnpm-workspace.yaml'))).toBe(true);
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
