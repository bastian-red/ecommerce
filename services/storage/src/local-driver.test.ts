import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalDriver } from './local-driver';
import { StorageConfigError, StorageValidationError, type StorageDriver } from './types';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('pixels'),
]);

let dir: string;
let driver: StorageDriver;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'shop-storage-'));
  driver = createLocalDriver({ dir, publicUrl: 'http://localhost:4000/media/' });
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('createLocalDriver', () => {
  it('refuses to start without a directory', () => {
    expect(() => createLocalDriver({ dir: '', publicUrl: 'http://x' })).toThrow(StorageConfigError);
  });

  it('names itself', () => {
    expect(driver.name).toBe('local');
  });
});

describe('put / get / delete', () => {
  it('writes a file, creating the nested directory', async () => {
    const key = 'products/clx1/photo.png';
    const result = await driver.put({ key, body: PNG, contentType: 'image/png' });
    expect(result.key).toBe(key);
    await expect(stat(join(dir, key))).resolves.toBeTruthy();
  });

  it('reads the same bytes back with the right content type', async () => {
    const key = 'products/clx1/roundtrip.png';
    await driver.put({ key, body: PNG, contentType: 'image/png' });
    const got = await driver.get(key);
    expect(got?.body.equals(PNG)).toBe(true);
    expect(got?.contentType).toBe('image/png');
  });

  it('returns null for a missing key rather than throwing', async () => {
    expect(await driver.get('products/clx1/missing.png')).toBeNull();
  });

  it('deletes a file', async () => {
    const key = 'products/clx1/gone.png';
    await driver.put({ key, body: PNG, contentType: 'image/png' });
    await driver.delete(key);
    expect(await driver.get(key)).toBeNull();
  });

  it('deletes idempotently, so a retried admin delete cannot fail', async () => {
    await expect(driver.delete('products/clx1/never-existed.png')).resolves.toBeUndefined();
  });
});

describe('urlFor', () => {
  it('joins the public base and the key, trimming a trailing slash', () => {
    expect(driver.urlFor('products/clx1/photo.png')).toBe(
      'http://localhost:4000/media/products/clx1/photo.png',
    );
  });

  it('rejects an unsafe key', () => {
    expect(() => driver.urlFor('../escape.png')).toThrow(StorageValidationError);
  });
});

describe('path containment', () => {
  it('refuses to write outside the storage root', async () => {
    for (const key of ['../escape.png', 'products/../../escape.png', '/etc/passwd']) {
      await expect(driver.put({ key, body: PNG, contentType: 'image/png' })).rejects.toThrow(
        StorageValidationError,
      );
    }
  });

  it('refuses to read outside the storage root', async () => {
    await expect(driver.get('../../../etc/passwd')).rejects.toThrow(StorageValidationError);
  });

  it('refuses to delete outside the storage root', async () => {
    await expect(driver.delete('../escape.png')).rejects.toThrow(StorageValidationError);
  });
});
