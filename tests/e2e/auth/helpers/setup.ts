/**
 * Test setup file - runs before each test file in the worker
 * Starts servers once per worker using beforeAll
 */

import { beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestServer, stopTestServer } from './server-bootstrap.js';
import { startFakeProtocolAPI, stopFakeProtocolAPI, resetRoutes } from './fake-protocol-api.js';
import { resetFakePrivy } from './fake-privy.js';

// Shared test context - populated in beforeAll
export const testContext = {
  server: { baseUrl: '', port: 0 },
  fakeProtocolApi: { baseUrl: '', port: 0 },
};

// Track if servers are already started
let serversStarted = false;

// Start servers once before all tests in this worker
beforeAll(async () => {
  // Only start servers if not already started
  if (serversStarted) {
    console.log('[Setup] Servers already running, skipping startup');
    return;
  }

  console.log('\n[Setup] Starting test servers...');
  serversStarted = true;

  // Start fake Protocol API first
  const protocolApi = await startFakeProtocolAPI();

  // Start test server
  const server = await startTestServer({
    protocolApiUrl: protocolApi.baseUrl,
  });

  // Store in context
  testContext.server = { baseUrl: server.baseUrl, port: server.port };
  testContext.fakeProtocolApi = { baseUrl: protocolApi.baseUrl, port: protocolApi.port };

  console.log(`[Setup] Test Server: ${server.baseUrl}`);
  console.log(`[Setup] Fake Protocol API: ${protocolApi.baseUrl}\n`);
});

// Stop servers after all tests in this worker
afterAll(async () => {
  console.log('\n[Setup] Stopping test servers...');
  await stopTestServer();
  await stopFakeProtocolAPI();
  console.log('[Setup] Test servers stopped\n');
});

// Reset mocks before each test
beforeEach(() => {
  resetFakePrivy();
  resetRoutes();
});

// Export context getter
export function getTestContext() {
  return testContext;
}
