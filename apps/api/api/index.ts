/**
 * Vercel's function entry point.
 *
 * Deliberately a one-line re-export. Everything real lives in `src/`, where it
 * is compiled by `nest build`, type-checked by `pnpm typecheck` and covered by
 * the same tsconfig as the rest of the service. A handler written out here
 * instead would sit outside all three.
 */
export { default } from '../src/vercel-handler';
