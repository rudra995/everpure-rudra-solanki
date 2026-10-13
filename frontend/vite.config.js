import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API and Socket.IO run on port 4000. Vite forwards both, so the
// browser only ever talks to one origin (no CORS setup needed).
const API = process.env.VITE_API_TARGET || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: { manualChunks: { react: ['react', 'react-dom', 'react-router-dom'], charts: ['recharts'] } },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': API,
      '/healthz': API,
      '/socket.io': { target: API, ws: true },
    },
  },
});
