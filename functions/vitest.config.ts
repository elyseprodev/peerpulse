import { defineConfig } from 'vitest/config'

/**
 * Integration tests for the Cloud Functions.
 *
 * A single fork, no parallelism: every test file shares one in-memory Firestore
 * and one Auth emulator, and the tests deliberately inspect global state (the
 * ledger) across calls.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
})
