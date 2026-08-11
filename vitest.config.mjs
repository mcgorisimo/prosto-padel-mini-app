import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    maxWorkers: 2,
    include: ['src/**/*.test.{js,jsx}', 'tests/unit/**/*.test.{js,jsx}'],
    setupFiles: ['./tests/unit/setup.js'],
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    coverage: {
      provider: 'v8',
      all: true,
      include: [
        'src/lib/backendMatchAdapter.js',
        'src/lib/backendBookingHomeAdapter.js',
        'src/lib/paidCourtCheckout.js',
        'src/lib/moscowDateTime.js',
      ],
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage/unit',
      thresholds: {
        statements: 51,
        branches: 85,
        functions: 66,
        lines: 51,
      },
    },
  },
});
