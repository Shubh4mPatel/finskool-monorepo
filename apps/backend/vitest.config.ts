import { defineConfig } from 'vitest/config'
import { TEST_ENV } from './tests/setup/test-env.js'

// Integration tests run against a real, throwaway Postgres (docker-compose.test.yml)
// so Prisma's raw queries, unique constraints and transactions are exercised for
// real. Redis/BullMQ are mocked in tests/setup/mocks.ts — see that file for why.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/setup/global-setup.ts'],
    setupFiles: ['tests/setup/mocks.ts'],
    // Every test file shares one database — run files one at a time so their
    // per-test TRUNCATEs can't wipe each other's fixtures mid-test.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: TEST_ENV,
  },
})
