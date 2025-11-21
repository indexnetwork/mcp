/**
 * Main Express Server
 * Integrates OAuth2, MCP, and vite-express for the React UI
 */

import express from 'express';
import cors from 'cors';
import ViteExpress from 'vite-express';
import { config, isProduction } from './config.js';
import { wellKnownRouter } from './oauth/wellknown.js';
import { handleDynamicClientRegistration } from './oauth/dcr.js';
import { authorizeRouter } from './oauth/authorize.js';
import { tokenRouter } from './oauth/token.js';
import { mcpRouter } from './mcp/handlers.js';
import { initializeMCPServer } from './mcp/server.js';
import path from 'path';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log requests in development
if (!isProduction) {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });
}

// Initialize MCP server (loads widgets)
console.log('🚀 Starting server...\n');
await initializeMCPServer();

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: config.server.nodeEnv,
  });
});

// Root landing page (unauthenticated) so external health checks don't see 403s
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>ChatGPT OAuth Bridge</title></head>
      <body style="font-family: sans-serif;">
        <h1>ChatGPT OAuth Bridge</h1>
        <p>The server is running. Use /authorize for OAuth and /mcp for MCP.</p>
      </body>
    </html>
  `);
});

// Serve widget assets (JS/CSS files)
app.use('/widgets', express.static(path.join(process.cwd(), 'dist/widgets'), {
  setHeaders(res) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    // Set correct MIME types
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
}));

// Serve favicon
app.get(['/favicon.ico', '/favicon.png', '/favicon.svg'], (_req, res) => {
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

// OAuth2 Discovery Endpoints (/.well-known/*)
app.use('/.well-known', wellKnownRouter);
// Mirror discovery endpoints under /mcp/.well-known for clients that scope metadata per resource path
app.use('/mcp/.well-known', wellKnownRouter);

// OAuth2 Dynamic Client Registration
app.post('/register', handleDynamicClientRegistration);

// OAuth2 Authorization Endpoint
// GET /authorize serves the React UI (handled by vite-express)
// POST /authorize receives consent from the frontend
app.use('/authorize', authorizeRouter);

// OAuth2 Token Endpoint
app.use('/token', tokenRouter);

// MCP Endpoints (requires OAuth authentication)
app.use('/mcp', mcpRouter);

// Start server
if (isProduction) {
  // Production: serve static files
  const clientPath = path.join(process.cwd(), 'dist/client');
  app.use(express.static(clientPath));

  // Catch-all for client-side routing (after all API routes)
  app.get('*', (req, res) => {
    // Don't serve index.html for API routes
    if (
      req.path.startsWith('/mcp') ||
      req.path.startsWith('/authorize') ||
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
║  • OAuth:   /authorize, /token             ║
║  • Health:  /health                        ║
╚════════════════════════════════════════════╝
    `);
  });
} else {
  // Development: use vite-express for HMR
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
║  • OAuth UI:  http://localhost:${config.server.port}/authorize    ║
║  • MCP:       http://localhost:${config.server.port}/mcp          ║
║  • Token:     http://localhost:${config.server.port}/token        ║
║  • Health:    http://localhost:${config.server.port}/health       ║
║                                            ║
║  OAuth Discovery:                          ║
║  • /.well-known/oauth-authorization-server ║
║  • /.well-known/oauth-protected-resource   ║
╠════════════════════════════════════════════╣
║  📝 Note: Build widgets first:             ║
║     bun run build:widgets                  ║
╚════════════════════════════════════════════╝
    `);
  });
}
