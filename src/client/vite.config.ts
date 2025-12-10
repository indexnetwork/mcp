import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type { Connect } from 'vite';

// Middleware to disable Vite's host check for ngrok/tunnel support
const disableHostCheckMiddleware: Connect.NextHandleFunction = (_req, _res, next) => {
  // Vite will use allowedHosts: true and host: 0.0.0.0 below
  next();
};

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'disable-host-check',
      configureServer(server) {
        // Add middleware at the very beginning
        server.middlewares.use(disableHostCheckMiddleware);
      },
    },
  ],
  root: 'src/client',
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    // Allow all hosts for ngrok/tunnel support in development
    allowedHosts: true,
    host: '0.0.0.0',
    strictPort: false,
    proxy: {
      // Proxy API requests to Express server
      '/mcp': {
        target: 'http://localhost:3002',
        bypass: (req) => {
          // Let GET /mcp/authorize requests go to React app
          if (req.method === 'GET' && req.url?.startsWith('/mcp/authorize')) {
            return req.url;
          }
        },
      },
      '/api': 'http://localhost:3002',
    },
  },
});
