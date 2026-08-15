/**
 * Tombol kamera harus benar-benar memotret.
 *
 * Atribut `capture` menyuruh ponsel langsung membuka kamera, bukan
 * pemilih berkas. Halaman darurat sudah memakainya sejak awal, tetapi
 * halaman Laporan tidak — jadi satpam yang ingin memotret kejadian malah
 * dibawa ke galeri, dan harus keluar aplikasi untuk memotret dulu.
 *
 * `capture` juga MENUTUP akses galeri, sehingga foto yang sudah diambil
 * beberapa menit lalu tidak bisa dilampirkan. Karena itu keduanya harus
 * tersedia berdampingan, bukan salah satu.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** Semua elemen <input type="file"> beserta atributnya, per berkas. */
function fileInputs(path: string): string[] {
  const src = readFileSync(path, 'utf8')
  return [...src.matchAll(/<input[^>]*type="file"[\s\S]*?\/>/g)].map((m) => m[0])
}

describe('tombol kamera pada halaman Laporan', () => {
  const inputs = fileInputs('src/pages/Reports.tsx')

  it('menyediakan jalur potret langsung', () => {
    const kamera = inputs.filter((i) => i.includes('capture="environment"'))
    // Satu untuk laporan baru, satu untuk utas insiden.
    expect(kamera.length).toBe(2)
  })

  it('tetap menyediakan jalur galeri di samping kamera', () => {
    const galeri = inputs.filter(
      (i) => i.includes('accept="image/*"') && !i.includes('capture='),
    )
    expect(galeri.length).toBe(2)
  })

  it('mengosongkan input agar foto yang sama bisa dipilih lagi', () => {
    // Tanpa ini, memotret ulang objek yang sama tidak memicu onChange.
    for (const i of inputs) {
      expect(i).toContain("e.target.value = ''")
    }
  })
})

describe('halaman darurat tetap memotret langsung', () => {
  it('foto dan video dibuka lewat kamera', () => {
    const inputs = fileInputs('src/pages/Panic.tsx')
    const kamera = inputs.filter((i) => i.includes('capture="environment"'))
    expect(kamera.length).toBe(2)
  })
})

describe('unggahan yang memang bukan pemotretan', () => {
  it('QRIS dan pemindai QR tidak memaksa membuka kamera', () => {
    // Keduanya menerima gambar yang sudah tersimpan; memaksa kamera di
    // sini justru menghalangi pemakaian yang wajar.
    for (const p of ['src/ui/QrisUpload.tsx', 'src/ui/QrScanner.tsx']) {
      for (const i of fileInputs(p)) {
        expect(i).not.toContain('capture=')
      }
    }
  })
})
