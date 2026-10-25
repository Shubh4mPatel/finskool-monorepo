import { execSync } from 'child_process'
import { TEST_ENV } from './test-env.js'

// Runs once before the whole suite: brings the throwaway test database's schema
// up to date. Refuses to touch anything that doesn't look like a test database,
// since every test file TRUNCATEs all tables between tests.
export default function setup(): void {
  const url = TEST_ENV.DATABASE_URL
  if (!/_test(\?|$)/.test(url)) {
    throw new Error(`Refusing to run tests against a non-test database (DATABASE_URL must end in "_test"): ${url}`)
  }

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })
}
