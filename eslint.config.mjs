import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Flat config, linted from the repo root in a single pass (`pnpm lint`).
 * Deliberately not a per-package turbo task: one config, one resolution root,
 * no chance of a package silently linting with no rules at all.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      // Prisma's client. Machine-written, replaced on every `db:generate`, and
      // not something a lint rule has any business having an opinion about.
      'packages/db/generated/**',
      'var/**',
      'next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Everything here runs on Node or in a bundler that provides these. Without
    // declaring them, `no-undef` reports `process` and `console` as errors in
    // every server file.
    languageOptions: {
      globals: { ...globals.node, ...globals.es2022 },
    },
    rules: {
      // Unused args are fine when they document a signature; require a _ prefix.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // Prisma's generated types and Stripe's event payloads legitimately need
      // narrowing casts; ban the implicit ones, not the deliberate ones.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      // TypeScript already reports an undefined identifier, and it does it with
      // full type information. Leaving the lint rule on as well only produces
      // false positives on ambient and DOM globals.
      'no-undef': 'off',
    },
  },
  {
    // Browser code additionally gets the DOM globals.
    files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    /**
     * `consistent-type-imports` is off for the API, and this is not a style
     * preference.
     *
     * NestJS resolves constructor dependencies from the type metadata that
     * `emitDecoratorMetadata` writes at compile time. An `import type` erases
     * the class entirely, so the metadata records `undefined` and Nest fails to
     * inject at runtime with an error that points nowhere near the import. The
     * rule's autofix will happily make that change across every service, and the
     * result compiles cleanly and dies at boot.
     */
    files: ['apps/api/src/**/*.ts'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
  {
    // Workers, seeds, scripts and tests are allowed to talk to stdout.
    files: [
      'apps/worker/**/*.ts',
      'packages/db/prisma/**/*.ts',
      'scripts/**/*.mjs',
      '**/*.test.ts',
      'e2e/**/*.ts',
      // The log channel's whole purpose is to print instead of delivering.
      'services/notifications/src/channel.ts',
    ],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.test.ts', 'apps/api/test/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
