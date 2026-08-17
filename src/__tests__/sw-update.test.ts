/**
 * Service worker tidak boleh menjadi hantu yang menahan versi lama.
 *
 * Gejala di lapangan: perbaikan sudah dirilis, server sudah benar, tetapi
 * layar warga tetap menampilkan kalimat galat versi lama — dan satu-satunya
 * jalan keluar adalah membuka DevTools lalu "Unregister". Itu tidak masuk
 * akal untuk warga RT/RW.
 *
 * Dua aturan yang diuji di sini:
 *   1. Saat pengembangan (npm run dev), service worker TIDAK didaftarkan
 *      sama sekali. Di mode dev, berkas dilayani Vite dan berubah setiap
 *      saat; menyimpannya hanya menciptakan versi hantu yang membingungkan
 *      — persis yang terjadi kemarin.
 *   2. Di produksi, sw.js sendiri tidak boleh diambil dari cache HTTP
 *      peramban (updateViaCache: 'none'), dan begitu versi baru mengambil
 *      alih, halaman dimuat ulang sekali agar pengguna langsung memakai
 *      kode terbaru tanpa disuruh apa-apa.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const main = readFileSync('src/main.tsx', 'utf8')

describe('pendaftaran service worker', () => {
  it('dilewati saat mode pengembangan', () => {
    /*
     * Tanpa ini, sw.js ikut hidup di localhost dan menyajikan salinan
     * lama berkas Vite. Pengembang (dan penguji) melihat perbaikan yang
     * seolah tidak pernah sampai, lalu mengira bug-nya belum beres.
     */
    expect(main).toMatch(/import\.meta\.env\.DEV/)
  })

  it('sw.js sendiri tidak boleh diambil dari cache peramban', () => {
    // Tanpa updateViaCache:'none', peramban bisa memakai sw.js lama
    // sampai 24 jam — jadi perbaikan pada service worker pun tertahan.
    expect(main).toMatch(/updateViaCache:\s*'none'/)
  })

  it('memuat ulang sekali begitu versi baru mengambil alih', () => {
    // controllerchange = service worker baru sudah memegang kendali.
    // Muat ulang sekali di situ, dengan penjaga agar tidak berputar.
    expect(main).toMatch(/controllerchange/)
  })

  it('memeriksa pembaruan, tidak menunggu kebetulan', () => {
    expect(main).toMatch(/\.update\(\)/)
  })
})
