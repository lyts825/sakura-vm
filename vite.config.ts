import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      input: { main: resolve('index.html'), singleApp: resolve('single-app.html') },
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/@xterm/')) return 'terminal';
        },
      },
    },
  },
});
