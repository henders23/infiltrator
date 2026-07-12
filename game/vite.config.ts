import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// INFILTRATOR dev/build config. Base is relative so the built app can be opened
// from a file server or subpath without rewriting asset URLs.
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
