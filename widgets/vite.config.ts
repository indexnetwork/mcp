import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        'index-echo': './src/echo/index.html'
      },
      output: {
        entryFileNames: 'echo-[hash:8].js',
        assetFileNames: 'echo-[hash:8].[ext]'
      }
    }
  }
});
