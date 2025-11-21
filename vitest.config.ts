import { defineConfig } from 'vitest/config';

/**
 * Default Vitest configuration for all tests
 * Runs both unit tests and e2e tests
 */
export default defineConfig({
  test: {
    // Set NODE_ENV for tests
    env: {
      NODE_ENV: 'test',
    },

    // Use Node environment for server-side testing
    environment: 'node',

    // Test file patterns - all tests
    include: ['tests/unit/**/*.test.ts', 'tests/e2e/**/*.spec.ts'],

    // Global test timeout - auth flows can take time
    testTimeout: 30000,

    // Hook timeout for server startup/teardown
    hookTimeout: 15000,

    // Run tests sequentially to avoid port conflicts
    sequence: {
      concurrent: false,
    },

    // Setup file for e2e tests
    setupFiles: ['tests/e2e/auth/helpers/setup.ts'],

    // Reporter configuration
    reporters: ['verbose'],

    // Retry failed tests once (useful for timing-sensitive auth tests)
    retry: 1,

    // Pool configuration - use forks for better isolation
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true, // Run all tests in single fork to share server instance
      },
    },
  },

  // Resolve TypeScript paths
  resolve: {
    alias: {
      '@server': '/src/server',
    },
  },
});
