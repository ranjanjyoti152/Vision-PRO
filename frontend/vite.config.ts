import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // This exposes the server on 0.0.0.0 instead of just localhost
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8090',
        changeOrigin: true,
        ws: true,  // Enable WebSocket proxying for /api/cameras/ws/... paths
        configure: (proxy) => {
          // Suppress EPIPE/ECONNRESET noise from camera WebSocket streams closing
          proxy.on('error', (err: any) => {
            if (err.code === 'EPIPE' || err.code === 'ECONNRESET') return;
            console.error('[proxy error]', err.message);
          });
        },
      },
      '/ws': {
        target: 'ws://localhost:8090',
        ws: true,
      },
      '/recordings': {
        target: 'http://localhost:8090',
        changeOrigin: true,
      },
    },
  },
})
