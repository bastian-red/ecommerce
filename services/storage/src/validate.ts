/**
 * Upload validation and key generation.
 *
 * The two rules that matter:
 *
 *  1. The content type is checked against an allowlist AND against the file's
 *     own magic bytes. A client-declared `image/png` on a file whose first bytes
 *     say otherwise is a stored-XSS attempt (an HTML or SVG payload served from
 *     the site's own origin), not a mistake.
 *  2. The storage key is generated here, from a UUID, never from the uploaded
 *     filename. A filename is attacker-controlled: `../../etc/passwd` and
 *     `index.html` are both fatal if they reach the filesystem or the CDN.
 */
import { randomUUID } from 'node:crypto';
import { StorageValidationError } from './types';

/** 8 MiB. Large enough for a product photo, small enough to bound memory. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Raster formats only. SVG is deliberately excluded: it is a script-carrying
 * document, and serving one from our origin is a cross-site scripting hole no
 * amount of sanitising reliably closes.
 */
export const ALLOWED_MIME_TYPES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

/** Magic-byte prefixes, checked against the declared type. */
const MAGIC: ReadonlyArray<{ mime: string; test: (buffer: Buffer) => boolean }> = [
  { mime: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/png',
    test: (b) =>
      b.length > 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  // Both WebP and AVIF are container formats: RIFF....WEBP and ....ftyp<brand>.
  {
    mime: 'image/webp',
    test: (b) => b.length > 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    mime: 'image/avif',
    test: (b) => b.length > 12 && b.subarray(4, 8).toString('ascii') === 'ftyp' && b.subarray(8, 12).toString('ascii').startsWith('avi'),
  },
];

/** Detect the real type from the bytes. Returns null when nothing matches. */
export function sniffMimeType(body: Buffer): string | null {
  return MAGIC.find((entry) => entry.test(body))?.mime ?? null;
}

export interface UploadCandidate {
  contentType: string;
  size: number;
  body: Buffer;
}

/**
 * Throws `StorageValidationError` with a message safe to show a user. Every
 * failure is the caller's fault, so every one maps to a 400.
 */
export function validateUpload(candidate: UploadCandidate): void {
  const declared = candidate.contentType.split(';')[0]?.trim().toLowerCase() ?? '';

  if (!(declared in ALLOWED_MIME_TYPES)) {
    throw new StorageValidationError(
      `Unsupported image type "${declared || 'unknown'}". Allowed: ${Object.keys(ALLOWED_MIME_TYPES).join(', ')}.`,
    );
  }
  if (candidate.size <= 0 || candidate.body.length === 0) {
    throw new StorageValidationError('File is empty.');
  }
  if (candidate.size > MAX_UPLOAD_BYTES) {
    throw new StorageValidationError(
      `File is ${Math.ceil(candidate.size / 1024 / 1024)}MB; the limit is ${MAX_UPLOAD_BYTES / 1024 / 1024}MB.`,
    );
  }
  if (candidate.size !== candidate.body.length) {
    throw new StorageValidationError('Declared size does not match the uploaded bytes.');
  }

  const actual = sniffMimeType(candidate.body);
  if (actual !== declared) {
    throw new StorageValidationError(
      `File contents are not a valid ${declared} image.`,
    );
  }
}

/**
 * Generate the storage key. The extension comes from the validated MIME type,
 * never from the client's filename, so there is no path to traverse and no way
 * to land an `.html` in a public bucket.
 */
export function buildStorageKey(productId: string, contentType: string): string {
  const extension = ALLOWED_MIME_TYPES[contentType.split(';')[0]?.trim().toLowerCase() ?? ''];
  if (!extension) throw new StorageValidationError(`Unsupported image type "${contentType}".`);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(productId)) {
    throw new StorageValidationError('Invalid product id.');
  }
  return `products/${productId}/${randomUUID()}.${extension}`;
}

/**
 * Reject anything that could escape the storage root. Applied on every read and
 * write, including keys read back out of the database, because a key that got in
 * before this check existed must not be trusted later.
 */
export function assertSafeKey(key: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9/_.-]{0,200}$/.test(key) || key.includes('..') || key.includes('//')) {
    throw new StorageValidationError(`Unsafe storage key: ${key}`);
  }
}

/** Content type to serve a stored key with, derived from its extension. */
export function contentTypeForKey(key: string): string {
  const extension = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
  const found = Object.entries(ALLOWED_MIME_TYPES).find(([, ext]) => ext === extension);
  return found?.[0] ?? 'application/octet-stream';
}
