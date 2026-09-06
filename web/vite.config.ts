import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The browser talks to the same origin; Vite forwards /api and /ws to the Node server.
// Both ports follow the environment so a second copy can run without colliding with the first.
const api = `127.0.0.1:${process.env.AGENTTRACE_PORT || 4747}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.AGENTTRACE_WEB_PORT || 4748),
    proxy: {
      '/api': `http://${api}`,
      '/ws': { target: `ws://${api}`, ws: true },
    },
  },
});
