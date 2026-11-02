import { isAbsolute, resolve } from 'node:path';
import { createLocalDriver } from './local-driver';
import { createS3Driver } from './s3-driver';
import { StorageConfigError, type StorageConfig, type StorageDriver } from './types';

export * from './types';
export * from './validate';
export { createLocalDriver } from './local-driver';
export { createS3Driver } from './s3-driver';

/**
 * The monorepo root: `services/storage/{src,dist}` is two levels below it.
 *
 * A relative `STORAGE_LOCAL_DIR` is resolved against this, never against the
 * process cwd. Three processes read the same setting from three directories:
 * `pnpm dev` runs the API in `apps/api`, `scripts/e2e.sh` runs it from the repo
 * root, and the seed runs in `packages/db`. Resolved against the cwd, each one
 * wrote to and served from its own folder, so a photo the seed stored was a 404
 * for the API. Deployments set an absolute path (compose: `/data/uploads`), which
 * is used as given.
 */
export const REPO_ROOT = resolve(__dirname, '..', '..', '..');

export function resolveLocalDir(dir: string, root: string = REPO_ROOT): string {
  return isAbsolute(dir) ? dir : resolve(root, dir);
}

export function storageConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  root: string = REPO_ROOT,
): StorageConfig {
  return {
    driver: env.STORAGE_DRIVER === 's3' ? 's3' : 'local',
    localDir: resolveLocalDir(env.STORAGE_LOCAL_DIR ?? './var/uploads', root),
    publicUrl: env.STORAGE_PUBLIC_URL ?? 'http://localhost:4000/media',
    bucket: env.S3_BUCKET,
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  };
}

export function createStorage(config: StorageConfig): StorageDriver {
  switch (config.driver) {
    case 's3':
      return createS3Driver({
        bucket: config.bucket ?? '',
        region: config.region ?? '',
        publicUrl: config.publicUrl,
        endpoint: config.endpoint,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      });
    case 'local':
      return createLocalDriver({
        dir: config.localDir ?? '',
        publicUrl: config.publicUrl,
      });
    default: {
      const exhaustive: never = config.driver;
      throw new StorageConfigError(`Unknown STORAGE_DRIVER: ${String(exhaustive)}`);
    }
  }
}
