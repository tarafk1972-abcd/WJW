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
    //
    // Pendaftarannya kini membawa opsi updateViaCache, jadi yang diperiksa
    // adalah pemanggilannya di modul masuk aplikasi — bukan satu baris
    // teks yang persis. Syarat "bukan setelah login" tetap terjaga:
    // main.tsx berjalan untuk setiap pengunjung.
    const main = readFileSync('src/main.tsx', 'utf8')
    expect(main).toMatch(/serviceWorker[\s\S]{0,400}?\.register\(\s*'\/sw\.js'/)
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

/**
 * Alur pembuatan APK di GitHub Actions.
 *
 * APK dibangun di mesin GitHub karena ia sudah punya JDK dan Android SDK.
 * Yang paling mudah salah adalah alamat server: bila keliru, APK-nya
 * terpasang tetapi setiap layar kosong — dan build tetap "berhasil".
 */
describe('workflow pembuatan APK', () => {
  // Disimpan di docs/ karena token otomatis tidak boleh membuat workflow;
  // pemilik repositori menyalinnya ke .github/workflows/ sekali saja.
  const wf = readFileSync('docs/workflow/apk.yml', 'utf8')

  it('meminta alamat API sebagai masukan wajib', () => {
    expect(wf).toContain('api_base')
    expect(wf).toMatch(/required:\s*true/)
  })

  it('menolak alamat yang tidak bisa dijangkau dari HP', () => {
    // https wajib, dan alamat lokal tidak ada artinya di dalam APK.
    expect(wf).toContain('https://*')
    expect(wf).toContain('localhost')
    expect(wf).toContain('192.168.')
  })

  it('memastikan alamat benar-benar tertanam sebelum membungkus', () => {
    // Salah ketik nama variabel akan lolos tanpa pemeriksaan ini.
    expect(wf).toContain('grep -rqF "$API_BASE" dist/assets/')
  })

  it('menambahkan izin yang dibutuhkan fitur inti', () => {
    for (const izin of [
      'ACCESS_FINE_LOCATION',
      'POST_NOTIFICATIONS',
      'CAMERA',
      'RECORD_AUDIO',
    ]) {
      expect(wf, izin).toContain(izin)
    }
  })

  it('menjalankan tes sebelum membangun APK', () => {
    expect(wf).toContain('npm test')
  })

  it('gagal bila APK tidak terbentuk, bukan diam-diam kosong', () => {
    expect(wf).toContain('if-no-files-found: error')
  })
})

/**
 * Versi action yang dipakai workflow.
 *
 * `actions/upload-artifact@v3` dimatikan GitHub sejak 30 Januari 2025:
 * memakainya membuat workflow gagal, bukan sekadar memberi peringatan.
 * Contoh workflow yang beredar di internet banyak yang masih memakainya.
 */
describe('workflow memakai action yang masih hidup', () => {
  const wf = readFileSync('docs/workflow/apk.yml', 'utf8')

  it('tidak memakai artifact action v3 yang sudah dimatikan', () => {
    expect(wf).not.toMatch(/actions\/(upload|download)-artifact@v[123]\b/)
    expect(wf).toContain('actions/upload-artifact@v4')
  })

  it('memakai setup-java v4, bukan v3', () => {
    expect(wf).not.toMatch(/actions\/setup-java@v[123]\b/)
  })

  it('memakai gradle/actions/setup-gradle, bukan gradle-build-action lama', () => {
    // gradle-build-action sudah digantikan gradle/actions/setup-gradle.
    expect(wf).not.toContain('gradle/gradle-build-action')
    expect(wf).toContain('gradle/actions/setup-gradle@v4')
  })

  it('menyertakan langkah membangun aplikasi web sebelum membungkus', () => {
    /*
     * Contoh workflow Android biasa langsung memanggil ./gradlew di akar
     * repositori. Di sini tidak ada gradlew sampai Capacitor membuatnya,
     * jadi urutannya wajib: build web -> cap add -> gradlew.
     */
    const i = wf.indexOf('npm run build')
    const j = wf.indexOf('npx cap add android')
    const k = wf.indexOf('gradlew assembleDebug')
    expect(i).toBeGreaterThan(-1)
    expect(j).toBeGreaterThan(i)
    expect(k).toBeGreaterThan(j)
  })

  it('menjalankan gradlew di dalam folder android/, bukan akar repo', () => {
    expect(wf).toContain('working-directory: android')
  })
})

/**
 * Versi Capacitor yang dipakai.
 *
 * Diuji satu per satu pada Agustus 2026: v6 membawa kerentanan `tar`
 * bertingkat critical, v8 membawa `uuid` moderate lewat `xcode`, dan v7
 * bersih. Tanpa nomor versi, npm memasang yang terbaru — yaitu v8.
 */
describe('versi Capacitor', () => {
  const wf = readFileSync('docs/workflow/apk.yml', 'utf8')
  const doc = readFileSync('docs/BUAT-APK.md', 'utf8')

  it('workflow menyebut versi secara tegas, bukan mengambil yang terbaru', () => {
    expect(wf).toContain('@capacitor/core@7')
    expect(wf).toContain('@capacitor/cli@7')
    expect(wf).toContain('@capacitor/android@7')
  })

  it('workflow tidak memakai versi yang diketahui bermasalah', () => {
    expect(wf).not.toMatch(/@capacitor\/cli@[68]\b/)
    // Tanpa @ berarti npm mengambil versi terbaru; itu yang harus dihindari.
    expect(wf).not.toMatch(/@capacitor\/cli(?!@)/)
  })

  it('workflow memeriksa kerentanan setelah memasangnya', () => {
    // Kalau kelak v7 ikut terdampak, biar ketahuan sebelum jadi APK.
    expect(wf).toContain('npm audit --audit-level=high')
  })

  it('panduan manual juga menyebut versinya', () => {
    expect(doc).toContain('@capacitor/core@7')
  })
})
