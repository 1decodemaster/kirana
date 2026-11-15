import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@kirana/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    // The G1.2 board-latency gate (p95 ≤ 50ms @ 2k items) measures real server
    // behavior: fork isolation matches the single-process server model, and
    // sequential files keep other suites' CPU load out of the measurement.
    pool: 'forks',
    fileParallelism: false,
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
  },
});
