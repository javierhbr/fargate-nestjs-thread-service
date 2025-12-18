import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/unit/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'test/',
        'dist/',
        '**/*.spec.ts',
        '**/*.test.ts',
        'vitest.config.ts',
        'jest.config.js',
      ],
      include: [
        'src/infrastructure/adapters/**/*.ts',
        'src/application/use-cases/**/*.ts',
        'src/domain/entities/**/*.ts',
      ],
      all: true,
      lines: 80,
      functions: 80,
      branches: 80,
      statements: 80,
    },
    include: ['test/unit/**/*.spec.ts'],
    exclude: ['node_modules/', 'dist/', 'test/acceptance/**/*'],
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
