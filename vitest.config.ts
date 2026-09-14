import { defineConfig } from 'vitest/config';

// Agent-side unit tests only (pure helpers: roster matching, message text). The API and the
// dashboard each run their own vitest from their own directory.
process.env.LUA_LOCAL_HARNESS ??= '1';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
