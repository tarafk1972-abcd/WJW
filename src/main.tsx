import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

/*
 * Daftarkan service worker sedini mungkin, untuk SEMUA pengunjung.
 *
 * Sebelumnya ini hanya terjadi setelah seseorang masuk dan mencapai layar
 * tertentu. Akibatnya dua hal: Chrome tidak pernah menawarkan "Instal
 * aplikasi" kepada warga yang baru membuka halaman depan, dan aplikasi
 * tidak bisa dibuka sama sekali saat sinyal hilang sebelum login.
 *
 * Ditunda sampai `load` agar tidak bersaing dengan pemuatan halaman.
 */
if ('serviceWorker' in navigator) {
  if (import.meta.env.DEV) {
    /*
     * JANGAN pasang service worker saat pengembangan.
     *
     * Di mode dev berkas dilayani Vite dan berubah setiap kali kode
     * disunting. Service worker yang menyimpannya menciptakan versi
     * hantu: perbaikan sudah jalan di server, tetapi layar tetap
     * menampilkan kode lama, dan satu-satunya jalan keluar adalah
     * membuka DevTools untuk "Unregister" — hal yang tidak masuk akal
     * diminta dari siapa pun.
     *
     * Sekalian lepaskan service worker yang terlanjur terpasang dari
     * versi sebelumnya, supaya localhost bersih dengan sendirinya.
     */
    void navigator.serviceWorker
      .getRegistrations()
      .then((rs) => Promise.all(rs.map((r) => r.unregister())))
      .then(() => caches?.keys().then((k) => Promise.all(k.map((n) => caches.delete(n)))))
      .catch(() => {})
  } else {
    window.addEventListener('load', () => {
      void navigator.serviceWorker
        // updateViaCache:'none' — sw.js sendiri harus selalu diambil segar.
        // Tanpa itu peramban boleh memakai sw.js lama sampai 24 jam, jadi
        // perbaikan pada service worker pun ikut tertahan.
        .register('/sw.js', { updateViaCache: 'none' })
        .then((reg) => {
          void reg.update()
          // Periksa lagi tiap kali aplikasi kembali dilihat, supaya
          // aplikasi yang dibiarkan terbuka berhari-hari tidak tertinggal.
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') void reg.update()
          })
        })
        .catch(() => {})

      /*
       * Begitu service worker baru memegang kendali, muat ulang sekali
       * agar pengguna langsung memakai kode terbaru — tanpa perlu
       * diberi tahu cara membersihkan cache. Penjaga `sudah` mencegah
       * putaran muat ulang tanpa henti.
       */
      let sudah = false
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (sudah) return
        sudah = true
        location.reload()
      })
    })
  }
}
