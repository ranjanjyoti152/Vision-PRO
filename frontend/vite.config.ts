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
