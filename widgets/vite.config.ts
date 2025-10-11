import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite configuration for building React widgets
 * Outputs hashed filenames for cache busting
 */
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        'echo': './src/echo/index.html'
      },
      output: {
        entryFileNames: 'echo-[hash:8].js',
        assetFileNames: 'echo-[hash:8].[ext]'
      }
    }
  }
});
