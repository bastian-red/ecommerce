import { createLocalDriver } from './local-driver';
import { createS3Driver } from './s3-driver';
import { StorageConfigError, type StorageConfig, type StorageDriver } from './types';

export * from './types';
export * from './validate';
export { createLocalDriver } from './local-driver';
export { createS3Driver } from './s3-driver';

export function storageConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  return {
    driver: env.STORAGE_DRIVER === 's3' ? 's3' : 'local',
    localDir: env.STORAGE_LOCAL_DIR ?? './var/uploads',
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
