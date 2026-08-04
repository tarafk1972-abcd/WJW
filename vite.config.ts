import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // The sandbox preview is served from https://{port}-{id}.e2b.app
    allowedHosts: true,
    hmr: { clientPort: 443, protocol: 'wss' },
    // Browser memanggil /api pada origin yang sama; Vite meneruskannya ke API.
    // Penting untuk preview sandbox: klien tidak boleh menyebut localhost.
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
})
