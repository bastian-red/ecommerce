import { defineConfig } from 'vitest/config';

// Integration lane: needs a real Postgres + Redis. These tests are the proof of
// the two guarantees (no oversell, exactly-once webhooks), so they run serially
// against a real database rather than against mocks.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.integration.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
