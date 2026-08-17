import react from '@vitejs/plugin-react'
import { createLogger, defineConfig } from 'vite'

/**
 * Vite mencetak setiap kegagalan proxy lengkap dengan jejak tumpukannya.
 * Ketika API mati, itu berarti puluhan baris ECONNREFUSED yang identik —
 * menenggelamkan satu petunjuk yang benar-benar berguna (lihat proxy di
 * bawah). Sembunyikan yang berulang itu saja; galat lain tetap tampil.
 */
const logger = createLogger()
const errorAsli = logger.error
logger.error = (msg, opts) => {
  if (msg.includes('http proxy error') && msg.includes('ECONNREFUSED')) return
  errorAsli(msg, opts)
}

/*
 * Waktu build, ditanam ke dalam berkas hasil build.
 *
 * Dipakai BUILD_STAMP (src/lib/meta.ts) untuk menjawab satu pertanyaan
 * yang kemarin memakan waktu berjam-jam: apakah yang berjalan di
 * peramban ini benar-benar kode terbaru?
 */
const stamp = new Date().toLocaleString('id-ID', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Jakarta',
})

export default defineConfig({
  customLogger: logger,
  define: { __BUILD_STAMP__: JSON.stringify(stamp) },
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // The sandbox preview is served from https://{port}-{id}.e2b.app
    allowedHosts: true,
    hmr: { clientPort: 443, protocol: 'wss' },
    // Browser memanggil /api pada origin yang sama; Vite meneruskannya ke API.
    // Penting untuk preview sandbox: klien tidak boleh menyebut localhost.
    // Vite mencetak sendiri setiap ECONNREFUSED lengkap dengan jejak
    // tumpukannya. Saat API mati itu berarti puluhan baris yang sama,
    // menenggelamkan petunjuk yang berguna. Cukup satu petunjuk di bawah.
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://127.0.0.1:8787',
        changeOrigin: true,
        configure(proxy) {
          /*
           * Bila API mati, tiap permintaan mencetak ECONNREFUSED beserta
           * jejak tumpukan — banyak, berulang, dan tidak menyebutkan apa
           * yang harus dilakukan. Ganti dengan satu petunjuk yang jelas,
           * lalu diam sampai keadaannya berubah.
           */
          let diberitahu = false
          proxy.on('error', (err: NodeJS.ErrnoException, _req, res) => {
            if (err.code === 'ECONNREFUSED') {
              if (!diberitahu) {
                diberitahu = true
                console.log(
                  '\n  [WJW] API belum berjalan, jadi data tidak bisa dimuat.' +
                    '\n        Buka terminal lain lalu jalankan:  npm run server' +
                    '\n        Atau hentikan ini dan jalankan keduanya:  npm run dev:all\n',
                )
              }
              // Balas 502 supaya klien memakai jalur luringnya.
              if (res && 'writeHead' in res && !res.headersSent) {
                res.writeHead(502, { 'content-type': 'application/json' })
                res.end(JSON.stringify({ error: 'errOffline' }))
              }
              return
            }
            console.log(`  [WJW] proxy /api: ${err.message}`)
          })
          proxy.on('proxyRes', () => {
            // API hidup lagi — izinkan petunjuk tampil bila nanti mati lagi.
            diberitahu = false
          })
        },
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
})
