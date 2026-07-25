/**
 * Local-disk driver. The default, so the project runs end to end with no cloud
 * account. In production it points at a mounted volume and the API serves the
 * files back through `/media/:key`.
 *
 * Every path is resolved and then checked to still be inside the root. Building
 * the path from a validated key is necessary but not sufficient: `path.resolve`
 * is the only thing that actually proves where a path landed after symlinks and
 * `..` segments are accounted for.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { assertSafeKey, contentTypeForKey } from './validate';
import {
  StorageConfigError,
  StorageValidationError,
  type PutParams,
  type StorageDriver,
} from './types';

export interface LocalDriverOptions {
  dir: string;
  publicUrl: string;
}

export function createLocalDriver(options: LocalDriverOptions): StorageDriver {
  if (!options.dir) {
    throw new StorageConfigError('STORAGE_LOCAL_DIR is required when STORAGE_DRIVER=local');
  }
  const root = resolve(options.dir);
  const publicUrl = options.publicUrl.replace(/\/+$/, '');

  function pathFor(key: string): string {
    assertSafeKey(key);
    const full = resolve(root, key);
    // The belt to the key validation's braces: proves where the path landed.
    if (full !== root && !full.startsWith(root + sep)) {
      throw new StorageValidationError(`Storage key escapes the storage root: ${key}`);
    }
    return full;
  }

  return {
    name: 'local',

    async put({ key, body }: PutParams) {
      const full = pathFor(key);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, body);
      return { key, url: `${publicUrl}/${key}` };
    },

    async delete(key: string) {
      // `force` so deleting an already-missing image is a no-op. Admin delete
      // must be idempotent; a half-cleaned record is worse than a missing file.
      await rm(pathFor(key), { force: true });
    },

    urlFor(key: string) {
      assertSafeKey(key);
      return `${publicUrl}/${key}`;
    },

    async get(key: string) {
      try {
        const body = await readFile(pathFor(key));
        return { body, contentType: contentTypeForKey(key) };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
  };
}
