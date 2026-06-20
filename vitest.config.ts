// eslint-disable-next-line import/no-unresolved -- 'vitest/config' is a real subpath export the import resolver can't follow
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
