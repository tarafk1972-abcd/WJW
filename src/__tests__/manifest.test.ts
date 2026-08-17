/**
 * Manifest dan ikon aplikasi.
 *
 * Android hanya mau memasang aplikasi web bila manifestnya menyebut ikon
 * PNG berukuran 192 dan 512 piksel. Sebelumnya hanya ada SVG, sehingga
 * "Instal aplikasi" tidak pernah muncul di Chrome Android — dan APK yang
 * dibungkus dari sini pun tidak punya ikon yang benar.
 */
import { readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(
  readFileSync('public/manifest.webmanifest', 'utf8'),
) as {
  name: string
  short_name: string
  start_url: string
  display: string
  icons: { src: string; sizes: string; type: string; purpose: string }[]
}

describe('manifest aplikasi', () => {
  it('menyediakan ikon PNG 192 dan 512 yang dibutuhkan Android', () => {
    const png = manifest.icons.filter((i) => i.type === 'image/png')
    const ukuran = png.map((i) => i.sizes)
    expect(ukuran).toContain('192x192')
    expect(ukuran).toContain('512x512')
  })

  it('menyediakan ikon maskable, agar tidak terpotong di layar utama', () => {
    // Tanpa ini Android memangkas ikon secara sembarang.
    const maskable = manifest.icons.filter((i) => i.purpose.includes('maskable'))
    expect(maskable.length).toBeGreaterThan(0)
  })

  it('setiap ikon yang disebut benar-benar ada dan tidak kosong', () => {
    for (const i of manifest.icons) {
      const path = 'public/' + i.src.replace(/^\.\//, '')
      expect(() => statSync(path), path).not.toThrow()
      expect(statSync(path).size, path).toBeGreaterThan(500)
    }
  })

  it('berkas PNG-nya benar-benar PNG', () => {
    for (const i of manifest.icons.filter((x) => x.type === 'image/png')) {
      const path = 'public/' + i.src.replace(/^\.\//, '')
      const buf = readFileSync(path)
      // Angka ajaib PNG.
      expect(buf.subarray(0, 8).toString('hex'), path).toBe('89504e470d0a1a0a')
    }
  })

  it('berjalan sebagai aplikasi berdiri sendiri, bukan tab peramban', () => {
    expect(manifest.display).toBe('standalone')
    expect(manifest.name).toBe('Warga Jaga Warga')
    expect(manifest.short_name.length).toBeLessThanOrEqual(12)
  })
})

describe('konfigurasi Capacitor', () => {
  const cfg = JSON.parse(readFileSync('capacitor.config.json', 'utf8')) as {
    appId: string
    appName: string
    webDir: string
  }

  it('memakai id paket yang sah dan tetap', () => {
    // Sekali dirilis, id ini tidak bisa diubah tanpa memasang ulang.
    expect(cfg.appId).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/)
  })

  it('menunjuk folder hasil build yang benar', () => {
    expect(cfg.webDir).toBe('dist')
  })
})

/**
 * Syarat Chrome agar "Instal aplikasi" muncul di Android.
 *
 * Bila salah satu tidak terpenuhi, menunya tidak muncul sama sekali —
 * tanpa pesan galat apa pun, sehingga sangat mudah lolos dari perhatian.
 */
describe('syarat pemasangan di Android', () => {
  const sw = readFileSync('public/sw.js', 'utf8')

  it('service worker menangani fetch', () => {
    // Ini syarat mutlak Chrome; tanpa handler fetch tidak ada tawaran instal.
    expect(sw).toMatch(/addEventListener\(\s*'fetch'/)
  })

  it('service worker didaftarkan untuk semua pengunjung, bukan setelah login', () => {
    // Kalau hanya didaftarkan di layar tertentu, warga yang baru membuka
    // halaman depan tidak akan pernah ditawari memasang.
    const main = readFileSync('src/main.tsx', 'utf8')
    expect(main).toContain("navigator.serviceWorker.register('/sw.js')")
  })

  it('tidak menyimpan jawaban API ke cache', () => {
    /*
     * Data darurat harus selalu yang terbaru. Menyajikan salinan lama
     * saat kejadian berlangsung lebih berbahaya daripada gagal memuat.
     */
    expect(sw).toContain("url.pathname.startsWith('/api/')")
  })

  it('halaman menautkan manifest dan warna tema', () => {
    const html = readFileSync('index.html', 'utf8')
    expect(html).toContain('rel="manifest"')
    expect(html).toContain('name="theme-color"')
  })

  it('start_url berada dalam scope', () => {
    // start_url di luar scope membuat manifest ditolak.
    expect(manifest.start_url).toBe('./')
  })
})
