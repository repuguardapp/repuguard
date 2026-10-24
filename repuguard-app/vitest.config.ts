import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: { provider: 'v8' },
  },
  resolve: {
    alias: { '@': resolve(__dirname, './src') },
  },
});
