import { defineConfig } from 'vitest/config'

/**
 * Config for the Security Rules suite only.
 *
 * It is deliberately separate from the app config: these tests talk to a live
 * Firestore emulator, so they must run single-threaded (one emulator, one project
 * id) and must not load the jsdom setup that the app tests rely on.
 *
 * Run with:
 *   npm run test:rules
 * which wraps it in `firebase emulators:exec` so the emulator exists for exactly
 * the duration of the run. Requires Java (the emulator is a JVM app) — see
 * docs/deployment.md if `java -version` fails.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.spec.ts'],
    globals: true,
    // Rules tests share one emulator; parallel files would race on cleanup.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
})
