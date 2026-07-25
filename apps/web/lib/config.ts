/** Server-side API base URL. On the deploy platform this is the private network. */
export const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000';

/** Browser-facing API base URL, baked at build time by infra/Dockerfile.web. */
export const PUBLIC_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export const APP_BASE_URL = process.env.APP_BASE_URL ?? 'http://localhost:3000';
