/**
 * Fake Protocol API server for E2E testing
 * Simulates the external Protocol API that extract_intent calls
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { URL } from 'url';

interface RouteConfig {
  response?: any;
  error?: { status: number; body: any };
  delay?: number;
  handler?: (req: IncomingMessage, body: string) => Promise<any>;
}

let server: Server | null = null;
let serverPort: number = 0;
const routes = new Map<string, RouteConfig>();
let lastDiscoverFilterBody: any | null = null;
let discoverFilterCallCount = 0;

/**
 * Start the fake Protocol API server
 */
export async function startFakeProtocolAPI(port: number = 0): Promise<{ port: number; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    server = createServer(async (req, res) => {
      try {
        await handleRequest(req, res);
      } catch (error) {
        console.error('[FakeProtocolAPI] Request error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });

    server.listen(port, () => {
      const address = server!.address();
      if (typeof address === 'object' && address !== null) {
        serverPort = address.port;
        const baseUrl = `http://localhost:${serverPort}`;
        console.log(`[FakeProtocolAPI] Started on ${baseUrl}`);
        resolve({ port: serverPort, baseUrl });
      } else {
        reject(new Error('Failed to get server address'));
      }
    });

    server.on('error', reject);
  });
}

/**
 * Stop the fake Protocol API server
 */
export async function stopFakeProtocolAPI(): Promise<void> {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => {
        server = null;
        serverPort = 0;
        console.log('[FakeProtocolAPI] Stopped');
        resolve();
      });
    } else {
      resolve();
    }
  });
}

/**
 * Configure a route response
 */
export function setRouteResponse(path: string, response: any): void {
  const existing = routes.get(path) || {};
  routes.set(path, { ...existing, response, error: undefined });
}

/**
 * Configure a route error
 */
export function setRouteError(path: string, status: number, body: any): void {
  const existing = routes.get(path) || {};
  routes.set(path, { ...existing, error: { status, body }, response: undefined });
}

/**
 * Configure a route delay (for timeout testing)
 */
export function setRouteDelay(path: string, delayMs: number): void {
  const existing = routes.get(path) || {};
  routes.set(path, { ...existing, delay: delayMs });
}

/**
 * Configure a custom handler for a route
 */
export function setRouteHandler(
  path: string,
  handler: (req: IncomingMessage, body: string) => Promise<any>
): void {
  const existing = routes.get(path) || {};
  routes.set(path, { ...existing, handler });
}

/**
 * Get the last request body sent to /discover/filter
 */
export function getLastDiscoverFilterBody(): any | null {
  return lastDiscoverFilterBody;
}

/**
 * Get the number of times /discover/filter has been called
 */
export function getDiscoverFilterCallCount(): number {
  return discoverFilterCallCount;
}

/**
 * Set up incremental /discover/filter responses for testing accumulation behavior.
 * Call 1: empty, Call 2: user-a only, Call 3+: user-a + user-b
 */
export function setupIncrementalDiscoverFilter(): void {
  setRouteHandler('/discover/filter', async () => {
    discoverFilterCallCount++;
    const callNum = discoverFilterCallCount;

    const baseResponse = {
      pagination: { page: 1, limit: 50, hasNext: false, hasPrev: false },
      filters: { intentIds: null, userIds: null, indexIds: null, sources: null, excludeDiscovered: true },
    };

    if (callNum === 1) {
      // First call: empty results (indexer not ready)
      return { ...baseResponse, results: [] };
    } else if (callNum === 2) {
      // Second call: partial results (user-a only)
      return {
        ...baseResponse,
        results: [
          {
            user: { id: 'incremental-user-a', name: 'Incremental User A', email: null, avatar: null, intro: null },
            totalStake: 100,
            intents: [],
          },
        ],
      };
    } else {
      // Third+ calls: full results (user-a + user-b)
      return {
        ...baseResponse,
        results: [
          {
            user: { id: 'incremental-user-a', name: 'Incremental User A', email: null, avatar: null, intro: null },
            totalStake: 100,
            intents: [],
          },
          {
            user: { id: 'incremental-user-b', name: 'Incremental User B', email: null, avatar: null, intro: null },
            totalStake: 80,
            intents: [],
          },
        ],
      };
    }
  });
}

/**
 * Reset all route configurations
 */
export function resetRoutes(): void {
  routes.clear();
  lastDiscoverFilterBody = null;
  discoverFilterCallCount = 0;

  // Set up default successful response for /discover/new
  setRouteResponse('/discover/new', {
    intents: [
      {
        id: 'test-intent-1',
        description: 'Test intent from fake Protocol API',
        confidence: 0.95,
      },
    ],
    filesProcessed: 0,
    linksProcessed: 0,
    intentsGenerated: 1,
  });

  // Set up default response for /discover/filter
  setRouteResponse('/discover/filter', {
    results: [],
    pagination: {
      page: 1,
      limit: 50,
      hasNext: false,
      hasPrev: false,
    },
    filters: {
      intentIds: null,
      userIds: null,
      indexIds: null,
      sources: null,
      excludeDiscovered: true,
    },
  });

  // Set up default response for /synthesis/vibecheck
  setRouteResponse('/synthesis/vibecheck', {
    synthesis: 'Default synthesis text',
    targetUserId: 'unknown',
    contextUserId: 'unknown',
  });
}

/**
 * Get current server base URL
 */
export function getBaseUrl(): string {
  if (!serverPort) {
    throw new Error('Fake Protocol API not started');
  }
  return `http://localhost:${serverPort}`;
}

/**
 * Handle incoming requests
 */
async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', `http://localhost:${serverPort}`);
  const path = url.pathname;

  console.log(`[FakeProtocolAPI] ${req.method} ${path}`);

  // Read request body
  const body = await readBody(req);

  // Capture /discover/filter request body
  if (path === '/discover/filter' && body) {
    try {
      lastDiscoverFilterBody = JSON.parse(body);
    } catch (e) {
      // Ignore parse errors
    }
  }

  // Check authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  // Get route configuration
  const config = routes.get(path);

  if (!config) {
    // Default 404 response
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  // Apply delay if configured
  if (config.delay) {
    await new Promise(resolve => setTimeout(resolve, config.delay));
  }

  // Use custom handler if provided
  if (config.handler) {
    const result = await config.handler(req, body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // Return error if configured
  if (config.error) {
    res.writeHead(config.error.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(config.error.body));
    return;
  }

  // Return success response
  if (config.response) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(config.response));
    return;
  }

  // Default empty response
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({}));
}

/**
 * Read request body as string
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

// Initialize with default routes
resetRoutes();
