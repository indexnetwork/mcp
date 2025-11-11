import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'path';
import { cpSync, existsSync, mkdirSync } from 'fs';

function copyWidgetHtmlPlugin() {
  return {
    name: 'copy-widget-html',
    closeBundle() {
      const copies = [
        {
          src: resolve(__dirname, 'dist/src/echo/index.html'),
          dest: resolve(__dirname, 'dist/widgets/index.html'),
        },
        {
          src: resolve(__dirname, 'dist/src/discover/index.html'),
          dest: resolve(__dirname, 'dist/widgets/index-discover.html'),
        },
        {
          src: resolve(__dirname, 'dist/src/oauth-consent/index.html'),
          dest: resolve(__dirname, 'dist/oauth/index.html'),
        },
      ];

      copies.forEach(({ src, dest }) => {
        if (!existsSync(src)) {
          return;
        }
        mkdirSync(dirname(dest), { recursive: true });
        cpSync(src, dest);
      });
    },
  } as const;
}

/**
 * Vite configuration for building React widgets
 * Outputs hashed filenames for cache busting
 */
export default defineConfig({
  plugins: [react(), copyWidgetHtmlPlugin()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        'widgets/index': resolve(__dirname, 'src/echo/index.html'),
        'widgets/discover': resolve(__dirname, 'src/discover/index.html'),
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
