import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The browser talks to the same origin; Vite forwards /api and /ws to the Node server.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4748,
    proxy: {
      '/api': 'http://127.0.0.1:4747',
      '/ws': { target: 'ws://127.0.0.1:4747', ws: true },
    },
  },
});
