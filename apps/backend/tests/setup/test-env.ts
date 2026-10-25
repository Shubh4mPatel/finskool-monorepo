// Shared by vitest.config.ts (applied to every test worker) and global-setup.ts
// (which vitest runs in the main process, where `test.env` isn't applied).
export const TEST_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: process.env['TEST_DATABASE_URL'] ?? 'postgresql://finskool:finskool@localhost:55433/finskool_test',
  JWT_SECRET: 'test-jwt-secret',
  ANGELONE_ENABLED: 'false',
}
