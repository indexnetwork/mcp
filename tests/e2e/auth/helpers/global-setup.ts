/**
 * Global setup for E2E auth tests
 * Runs once before all test files
 */

import { startTestServer } from './server-bootstrap.js';
import { startFakeProtocolAPI } from './fake-protocol-api.js';

export default async function globalSetup() {
  console.log('\n[E2E Auth Tests] Global setup starting...');

  // Set up test environment
  process.env.NODE_ENV = 'test';

  console.log('[Global Setup] Starting test infrastructure...');

  // Start fake Protocol API first
  const protocolApi = await startFakeProtocolAPI();

  // Start test server
  const server = await startTestServer({
    protocolApiUrl: protocolApi.baseUrl,
  });

  // Store server info in global context
  (globalThis as any).__TEST_SERVERS__ = {
    server: {
      baseUrl: server.baseUrl,
      port: server.port,
    },
    fakeProtocolApi: {
      baseUrl: protocolApi.baseUrl,
      port: protocolApi.port,
    },
  };

  console.log('[Global Setup] Test infrastructure ready');
  console.log(`  - Test Server: ${server.baseUrl}`);
  console.log(`  - Fake Protocol API: ${protocolApi.baseUrl}\n`);

  // Return teardown function
  return async () => {
    console.log('\n[Global Teardown] Shutting down test infrastructure...');

    const { stopTestServer } = await import('./server-bootstrap.js');
    const { stopFakeProtocolAPI } = await import('./fake-protocol-api.js');

    await stopTestServer();
    await stopFakeProtocolAPI();

    console.log('[Global Teardown] Test infrastructure stopped\n');
  };
}
