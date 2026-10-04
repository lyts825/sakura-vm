import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react()],
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      input: { main: resolve('index.html'), singleApp: resolve('single-app.html') },
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/@xterm/')) return 'terminal';
          const path = id.replaceAll('\\', '/');
          if (!isSsrBuild) {
            if (/\/shared\/plugin-(?:schema|resolver|selection)\.ts$/.test(path)) return 'plugin-contracts';
            if (/\/shared\/(?:plugins|plugin-(?:catalog\.generated|protocol))\.ts$/.test(path) ||
              /\/plugins\/[^/]+\/manifest\.ts$/.test(path) || /\/plugins\/packs\/[^/]+\.ts$/.test(path))
              return 'plugin-catalog';
          }
        },
      },
    },
  },
}));
