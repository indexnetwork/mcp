import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

/**
 * Vite configuration for building React widgets
 * Outputs hashed filenames for cache busting
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        'widgets/index': resolve(__dirname, 'src/echo/index.html'),
        'oauth/index': resolve(__dirname, 'src/oauth-consent/index.html')
      },
      output: {
        entryFileNames: (chunk) => {
          const name = chunk.name ?? '';
          const folder = name.startsWith('oauth/') ? 'oauth' : 'widgets';
          return `${folder}/[name]-[hash:8].js`;
        },
        chunkFileNames: (chunk) => {
          const name = chunk.name ?? '';
          const folder = name.startsWith('oauth/') ? 'oauth' : 'widgets';
          return `${folder}/[name]-[hash:8].js`;
        },
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name ?? '';
          const folder = name.includes('oauth') ? 'oauth' : 'widgets';
          return `${folder}/[name]-[hash:8][extname]`;
        }
      }
    }
  }
});
