import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'src/widgets',
  define: {
    'process.env': '{}',
    'process.env.NODE_ENV': '"production"',
  },
  build: {
    outDir: '../../dist/widgets',
    emptyOutDir: true,
    lib: {
      entry: {
        'intent-display': 'src/IntentDisplay/index.tsx',
        'discover-connections': 'src/DiscoverConnections/index.tsx',
      },
      formats: ['es'],
      fileName: (format, name) => `${name}.js`,
    },
    rollupOptions: {
      output: {
        // Inline everything into single bundle
        inlineDynamicImports: false,
        // Extract CSS to separate file
        assetFileNames: '[name].[ext]',
      },
      // Don't externalize React - bundle it
      external: [],
    },
    // Ensure compatibility with iframe environment
    target: 'es2020',
    minify: 'esbuild',
    sourcemap: false,
  },
});
