import { defineConfig } from 'vitest/config';

// Pure helpers only. Component behaviour is covered by the Playwright E2E suite,
// so there is no jsdom environment here.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**'],
  },
});
