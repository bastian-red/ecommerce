/**
 * S3 driver. Works against AWS S3, Cloudflare R2 and MinIO; anything that speaks
 * the S3 API. `forcePathStyle` is on when a custom endpoint is configured,
 * because R2 and MinIO do not do virtual-host-style buckets.
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { assertSafeKey, contentTypeForKey } from './validate';
import { StorageConfigError, type PutParams, type StorageDriver } from './types';

export interface S3DriverOptions {
  bucket: string;
  region: string;
  publicUrl: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Injectable for tests. */
  client?: S3Client;
}

export function createS3Driver(options: S3DriverOptions): StorageDriver {
  if (!options.bucket) {
    throw new StorageConfigError('S3_BUCKET is required when STORAGE_DRIVER=s3');
  }
  if (!options.region) {
    throw new StorageConfigError('S3_REGION is required when STORAGE_DRIVER=s3');
  }

  const publicUrl = options.publicUrl.replace(/\/+$/, '');
  const client =
    options.client ??
    new S3Client({
      region: options.region,
      ...(options.endpoint ? { endpoint: options.endpoint, forcePathStyle: true } : {}),
      // Credentials are omitted when absent so the SDK falls back to the
      // instance role, which is how this should run on a managed host.
      ...(options.accessKeyId && options.secretAccessKey
        ? {
            credentials: {
              accessKeyId: options.accessKeyId,
              secretAccessKey: options.secretAccessKey,
            },
          }
        : {}),
    });

  return {
    name: 's3',

    async put({ key, body, contentType }: PutParams) {
      assertSafeKey(key);
      await client.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          // Product images are immutable: a new upload gets a new UUID key, so
          // the old one is never overwritten and can be cached forever.
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      return { key, url: `${publicUrl}/${key}` };
    },

    async delete(key: string) {
      assertSafeKey(key);
      await client.send(new DeleteObjectCommand({ Bucket: options.bucket, Key: key }));
    },

    urlFor(key: string) {
      assertSafeKey(key);
      return `${publicUrl}/${key}`;
    },

    async get(key: string) {
      assertSafeKey(key);
      try {
        const result = await client.send(
          new GetObjectCommand({ Bucket: options.bucket, Key: key }),
        );
        const bytes = await result.Body?.transformToByteArray();
        if (!bytes) return null;
        return {
          body: Buffer.from(bytes),
          contentType: result.ContentType ?? contentTypeForKey(key),
        };
      } catch (error) {
        const name = (error as { name?: string }).name;
        if (name === 'NoSuchKey' || name === 'NotFound') return null;
        throw error;
      }
    },
  };
}
