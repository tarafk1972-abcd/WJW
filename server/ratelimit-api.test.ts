/**
 * Pembatasan laju pada endpoint sungguhan.
 *
 * Yang diuji di sini bukan fungsinya (itu di ratelimit.test.ts),
 * melainkan bahwa endpoint publiknya benar-benar memakainya — dan
 * bahwa pemakaian normal tidak ikut terhambat.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { BATAS, hitRateLimit, resetRateLimits } from './ratelimit'

let app: { fetch: (req: Request) => Promise<Response> }

beforeAll(async () => {
  process.env.WJW_DB = join(mkdtempSync(join(tmpdir(), 'wjw-rl-')), 't.sqlite')
  process.env.WJW_NO_LISTEN = '1'
  process.env.WJW_SUPERADMIN_PASSWORD = 'sa'
  app = (await import('./index')).app
})

beforeEach(() => {
  resetRateLimits()
})

/** Panggil login dari satu alamat tertentu. */
function login(ip: string, password = 'salah-sekali') {
  return app.fetch(
    new Request('http://x/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ identifier: 'orang@x.id', password }),
    }),
  )
}

describe('POST /api/auth/login', () => {
  it('akhirnya menjawab 429, bukan melayani tanpa batas', async () => {
    let terakhir = 0
    // Jauh lebih banyak daripada yang mungkin diketik manusia.
    for (let i = 0; i < BATAS.login.max + 5; i++) {
      terakhir = (await login('9.9.9.9')).status
    }
    expect(terakhir).toBe(429)
  })

  it('tidak menghukum warga yang salah ketik beberapa kali', async () => {
    /*
     * Batasnya harus longgar terhadap manusia. Warga yang lupa sandi
     * lalu mencoba beberapa kali sedang memakai aplikasi darurat —
     * bukan menyerang. Jawabannya harus tetap 401 (sandi salah).
     *
     * 20 kali juga mewakili keadaan yang lebih penting: SATU RW berbagi
     * satu alamat publik, jadi percobaan beberapa tetangga menumpuk di
     * penghitung yang sama.
     */
    for (let i = 0; i < 20; i++) {
      const r = await login('8.8.8.8')
      expect(r.status).toBe(401)
    }
  })

  it('memblokir per alamat, tidak mengunci akunnya', async () => {
    for (let i = 0; i < BATAS.login.max + 5; i++) await login('7.7.7.7')
    expect((await login('7.7.7.7')).status).toBe(429)

    // Pemilik akun yang sah, dari jaringan lain, tetap bisa mencoba.
    // Kalau akunnya yang dikunci, ini ikut 429 — dan penyerang berhasil
    // membungkam warga hanya dengan menebak sandi orang itu.
    expect((await login('6.6.6.6')).status).toBe(401)
  })
})

describe('POST /api/auth/register', () => {
  it('dibatasi juga, karena tiap pendaftaran menambah kerja admin', async () => {
    /*
     * Jatahnya dihabiskan lewat penghitung langsung, bukan dengan
     * benar-benar mendaftar ratusan kali: tiap pendaftaran sungguhan
     * menjalankan bcrypt, dan tes yang butuh 20 detik akan berhenti
     * dijalankan orang.
     */
    for (let i = 0; i < BATAS.register.max; i++) {
      hitRateLimit('register', '5.5.5.5', BATAS.register)
    }

    const r = await app.fetch(
      new Request('http://x/api/auth/register', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '5.5.5.5',
        },
        body: JSON.stringify({
          name: 'Spam',
          phone: '0899000111',
          email: 'spam@x.id',
          password: 'rahasia123',
          house: 'A1',
          mode: 'create',
          communityName: 'Palsu',
          language: 'id',
        }),
      }),
    )
    expect(r.status).toBe(429)
  })

  it('pendaftar pertama dari jaringan itu tetap dilayani', async () => {
    // Yang paling merugikan bukan penyerang yang lolos, melainkan
    // tetangga sungguhan yang ditolak. Pastikan jalur normalnya lapang.
    const r = await app.fetch(
      new Request('http://x/api/auth/register', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '4.4.4.4',
        },
        body: JSON.stringify({
          name: 'Warga Asli',
          phone: '0899222333',
          email: 'asli@x.id',
          password: 'rahasia123',
          house: 'B2',
          mode: 'create',
          communityName: 'RW Asli',
          language: 'id',
        }),
      }),
    )
    expect(r.status).toBe(201)
  })
})
