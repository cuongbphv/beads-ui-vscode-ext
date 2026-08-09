import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/test/**/*.test.{ts,tsx}'],
    // The @vscode/test-electron smoke test launches a real editor; it is run
    // separately, not as part of the unit suite.
    exclude: ['src/test/electron/**'],
  },
});
