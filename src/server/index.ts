/**
 * Main Express Server
 * Integrates OAuth2, MCP, and vite-express for the React UI
 */

import express from 'express';
import cors from 'cors';
import { config, isProduction } from './config.js';
import { wellKnownRouter } from './oauth/wellknown.js';
import { handleDynamicClientRegistration } from './oauth/dcr.js';
import { authorizeRouter } from './oauth/authorize.js';
import { tokenRouter } from './oauth/token.js';
import { mcpRouter } from './mcp/handlers.js';
import { initializeMCPServer } from './mcp/server.js';
import { getRepositories } from './oauth/repositories/index.js';
import path from 'path';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log requests (can be disabled with LOG_REQUESTS=false)
if (process.env.LOG_REQUESTS !== 'false') {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });
}

// Initialize MCP server (loads widgets)
console.log('🚀 Starting server...\n');
await initializeMCPServer();

// Bootstrap static OAuth client (chatgpt-connector)
// This ensures the static client is always available, even after restarts with postgres storage
const repos = getRepositories();
await repos.clients.create({
  id: 'chatgpt-connector',
  clientName: 'ChatGPT Connector',
  redirectUris: [
    'https://chat.openai.com/connector_platform_oauth_redirect',
    'https://chatgpt.com/connector_platform_oauth_redirect',
  ],
});
console.log('✓ Registered static OAuth client: chatgpt-connector');

// Root landing page (unauthenticated) so external health checks don't see 403s
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>ChatGPT OAuth Bridge</title></head>
      <body style="font-family: sans-serif;">
        <h1>ChatGPT OAuth Bridge</h1>
        <p>The server is running. Use /mcp/authorize for OAuth and /mcp for MCP.</p>
        <p>Health check: <a href="/mcp/health">/mcp/health</a></p>
      </body>
    </html>
  `);
});

// Health check
app.get('/mcp/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: config.server.nodeEnv,
  });
});

// Serve widget assets (JS/CSS files)
app.use('/mcp/widgets', express.static(path.join(process.cwd(), 'dist/widgets'), {
  setHeaders(res) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    // Set correct MIME types
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
}));

// Serve favicon
app.get(['/mcp/favicon.ico', '/mcp/favicon.png', '/mcp/favicon.svg'], (_req, res) => {
  const faviconPath = path.join(process.cwd(), 'public/favicon.svg');

  // Check if favicon exists
  if (require('fs').existsSync(faviconPath)) {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.sendFile(faviconPath);
  } else {
    // Return empty response if favicon doesn't exist
    res.status(204).end();
  }
});

// OAuth2 Discovery Endpoints
app.use('/mcp/.well-known', wellKnownRouter);

// OAuth2 Dynamic Client Registration
app.post('/mcp/register', handleDynamicClientRegistration);

// OAuth2 Authorization Endpoint
// GET /mcp/authorize serves the React UI (handled by vite-express)
// POST /mcp/authorize receives consent from the frontend
app.use('/mcp/authorize', authorizeRouter);

// OAuth2 Token Endpoint
app.use('/mcp/token', tokenRouter);

// MCP Endpoints (requires OAuth authentication)
app.use('/mcp', mcpRouter);

// Start server
if (isProduction) {
  // Production: serve static files
  const clientPath = path.join(process.cwd(), 'dist/client');
  app.use(express.static(clientPath));

  // Serve OAuth UI for GET /authorize after validation passes (authorizeRouter calls next())
  // This catches the request after authorizeRouter validates params and logs authorize_request
  app.get('/authorize', (_req, res) => {
    res.sendFile(path.join(clientPath, 'index.html'));
  });

  // Catch-all for client-side routing (after all API routes)
  app.get('*', (req, res) => {
    // Don't serve index.html for API routes
    if (
      req.path.startsWith('/mcp') ||
      req.path.startsWith('/token') ||
      req.path.startsWith('/.well-known') ||
      req.path.startsWith('/api')
    ) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(path.join(clientPath, 'index.html'));
  });

  // Start server
  app.listen(config.server.port, () => {
    console.log(`
╔════════════════════════════════════════════╗
║   ChatGPT App Server (Production)         ║
╠════════════════════════════════════════════╣
║  Server:    ${config.server.baseUrl.padEnd(30)} ║
║  Port:      ${config.server.port.toString().padEnd(30)} ║
║                                            ║
║  Endpoints:                                ║
║  • MCP:     /mcp                           ║
║  • OAuth:   /mcp/authorize, /mcp/token     ║
║  • Health:  /mcp/health                    ║
╚════════════════════════════════════════════╝
    `);
  });
} else {
  // Development: use vite-express for HMR (dynamic import to avoid requiring it in production)
  const ViteExpress = (await import('vite-express')).default;

  ViteExpress.config({
    mode: 'development',
    viteConfigFile: path.join(process.cwd(), 'src/client/vite.config.ts'),
  });

  ViteExpress.listen(app, config.server.port, () => {
    console.log(`
╔════════════════════════════════════════════╗
║   ChatGPT App Server (Development)        ║
╠════════════════════════════════════════════╣
║  Server:    http://localhost:${config.server.port.toString().padEnd(19)} ║
║                                            ║
║  Endpoints:                                ║
║  • OAuth UI:  http://localhost:${config.server.port}/mcp/authorize    ║
║  • MCP:       http://localhost:${config.server.port}/mcp          ║
║  • Token:     http://localhost:${config.server.port}/mcp/token        ║
║  • Health:    http://localhost:${config.server.port}/mcp/health       ║
║                                            ║
║  OAuth Discovery:                          ║
║  • /mcp/.well-known/oauth-authorization-server ║
║  • /mcp/.well-known/oauth-protected-resource   ║
╠════════════════════════════════════════════╣
║  📝 Note: Build widgets first:             ║
║     bun run build:widgets                  ║
╚════════════════════════════════════════════╝
    `);
  });
}
