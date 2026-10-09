import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { NODE_ENV: 'test' },
    // A shared real database must not be truncated by another test file mid-run.
    fileParallelism: !process.env.TEST_DATABASE_URL,
  },
});
