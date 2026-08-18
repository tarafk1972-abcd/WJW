/**
 * Pembatasan laju untuk endpoint publik.
 *
 * Selama aplikasi hanya berjalan di Wi-Fi rumah, tidak adanya pembatasan
 * ini nyaris tak berisiko. Begitu servernya publik, keadaannya berubah
 * total: siapa pun di internet bisa mencoba ribuan sandi per menit
 * terhadap /api/auth/login, atau membanjiri antrean persetujuan admin
 * lewat /api/auth/register.
 *
 * Yang dijaga di sini:
 *   - percobaan login beruntun akhirnya ditolak (429), bukan dilayani
 *     tanpa batas;
 *   - penolakan itu sementara dan per-alamat, bukan mengunci akun —
 *     mengunci akun justru memberi penyerang cara membungkam warga;
 *   - warga yang salah ketik sandi sekali-dua kali tidak terganggu;
 *   - pendaftaran juga dibatasi, karena tiap pendaftaran menambah
 *     pekerjaan admin sungguhan.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { hitRateLimit, resetRateLimits } from './ratelimit'

beforeEach(() => {
  resetRateLimits()
})

describe('hitRateLimit', () => {
  it('mengizinkan percobaan wajar', () => {
    for (let i = 0; i < 5; i++) {
      expect(hitRateLimit('login', '1.1.1.1', { max: 10, windowMs: 60_000 })).toBe(true)
    }
  })

  it('menolak setelah batas terlampaui', () => {
    for (let i = 0; i < 10; i++) {
      hitRateLimit('login', '2.2.2.2', { max: 10, windowMs: 60_000 })
    }
    expect(hitRateLimit('login', '2.2.2.2', { max: 10, windowMs: 60_000 })).toBe(false)
  })

  it('menghitung tiap alamat secara terpisah', () => {
    for (let i = 0; i < 10; i++) {
      hitRateLimit('login', '3.3.3.3', { max: 10, windowMs: 60_000 })
    }
    // Tetangga yang memakai jaringan lain tidak boleh ikut terhukum.
    expect(hitRateLimit('login', '4.4.4.4', { max: 10, windowMs: 60_000 })).toBe(true)
  })

  it('memisahkan jenis endpoint', () => {
    for (let i = 0; i < 10; i++) {
      hitRateLimit('login', '5.5.5.5', { max: 10, windowMs: 60_000 })
    }
    // Habisnya jatah login tidak boleh ikut memblokir pendaftaran.
    expect(hitRateLimit('register', '5.5.5.5', { max: 10, windowMs: 60_000 })).toBe(true)
  })

  it('memulihkan diri setelah jendela waktunya lewat', () => {
    const now = Date.now()
    for (let i = 0; i < 10; i++) {
      hitRateLimit('login', '6.6.6.6', { max: 10, windowMs: 1000, now })
    }
    expect(hitRateLimit('login', '6.6.6.6', { max: 10, windowMs: 1000, now })).toBe(false)

    /*
     * Ini yang membedakan pembatasan laju dari penguncian akun: keadaan
     * harus pulih sendiri. Warga yang lupa sandi lalu mencoba beberapa
     * kali tidak boleh terkunci sampai ada yang menolongnya.
     */
    expect(
      hitRateLimit('login', '6.6.6.6', { max: 10, windowMs: 1000, now: now + 1500 }),
    ).toBe(true)
  })
})
