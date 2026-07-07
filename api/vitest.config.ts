import { defineConfig } from 'vitest/config';

process.env.DATABASE_URL ??= 'postgres://sucafina:sucafina@localhost:5433/sucafina_test';
process.env.API_KEY ??= 'dev-key-sucafina';

export default defineConfig({
  test: {
    poolOptions: { threads: { singleThread: true } },
  },
});
