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
  window.addEventListener('load', () => {
    // Gagal mendaftar bukan alasan menghentikan aplikasi — cukup diamkan.
    void navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
