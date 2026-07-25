/**
 * The storage contract for product images.
 *
 * Two drivers: `local` writes to a directory (a mounted volume in production)
 * and is the default, so the project runs with no cloud account; `s3` speaks to
 * S3, R2, or any S3-compatible endpoint.
 *
 * Validation lives at the contract, not the transport. A file that is too large
 * or of the wrong type is rejected by the same function whether it arrived
 * through the API's multipart handler, a worker job, or a seed script. Putting
 * the check in the HTTP layer would mean every non-HTTP writer is unvalidated.
 */

export type StorageDriverName = 'local' | 's3';

export interface StorageConfig {
  driver: StorageDriverName;
  /** Where the local driver writes. Required when driver is 'local'. */
  localDir?: string;
  /** Base URL files are served from, without a trailing slash. */
  publicUrl: string;
  bucket?: string;
  region?: string;
  /** Custom endpoint for R2 / MinIO / Cloudinary-compatible hosts. */
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export interface PutParams {
  /** Storage key, e.g. `products/<productId>/<uuid>.webp`. Never client-supplied. */
  key: string;
  body: Buffer;
  contentType: string;
}

export interface StorageDriver {
  readonly name: StorageDriverName;
  put(params: PutParams): Promise<{ key: string; url: string }>;
  delete(key: string): Promise<void>;
  /** Public URL for a key. Pure, so callers can render without a round trip. */
  urlFor(key: string): string;
  /** Read a stored object back. The local driver's media route uses this. */
  get(key: string): Promise<{ body: Buffer; contentType: string } | null>;
}

export class StorageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageConfigError';
  }
}

export class StorageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageValidationError';
  }
}
