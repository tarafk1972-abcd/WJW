/**
 * Jaminan: posisi tidak pernah dikirim berkala.
 *
 * Aplikasi hanya boleh menyentuh GPS ketika ada peringatan darurat yang
 * sedang berlangsung. Di hari-hari biasa server tidak boleh tahu warga
 * ada di mana. Tes ini menjalankan aplikasi sungguhan terhadap server
 * sungguhan dan menghitung berapa kali posisi benar-benar terkirim.
 */
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as pathJoin } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { setToken } from '../lib/api'
import { invalidateCache, setSession } from '../lib/db'
import { resetPresenceState } from '../lib/presence'

vi.mock('../ui/MapView', () => ({ MapView: () => <div />, pinIcon: () => null }))

const TITIK = { lat: -6.9829, lng: 107.5197 }

/** Berapa kali POST /api/me/location terjadi. */
let posCalls = 0
let seq = 0

beforeAll(async () => {
  process.env.WJW_DB = pathJoin(mkdtempSync(pathJoin(tmpdir(), 'wjw-npl-')), 't.sqlite')
  process.env.WJW_NO_LISTEN = '1'
  process.env.WJW_SUPERADMIN_PASSWORD = 'sa'
  const { app } = await import('../../server/index.js')
  const { serve } = await import('@hono/node-server')
  const srv = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
  await new Promise((r) => setTimeout(r, 250))
  const base = `http://127.0.0.1:${(srv as unknown as { address(): { port: number } }).address().port}`

  const real = globalThis.fetch
  globalThis.fetch = ((i: RequestInfo | URL, init?: RequestInit) => {
    const u = typeof i === 'string' ? i : String(i)
    if (u.includes('/api/me/location') && (init?.method ?? 'GET') === 'POST') posCalls++
    return real(u.startsWith('/') ? base + u : u, init)
  }) as typeof fetch

  // GPS selalu berhasil, agar yang diuji adalah keputusan aplikasi —
  // bukan kebetulan GPS tidak tersedia di jsdom.
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (ok: (p: unknown) => void) =>
        ok({ coords: { latitude: TITIK.lat, longitude: TITIK.lng, accuracy: 5 } }),
      watchPosition: (ok: (p: unknown) => void) => {
        ok({ coords: { latitude: TITIK.lat, longitude: TITIK.lng, accuracy: 5 } })
        return 1
      },
      clearWatch: () => {},
    },
  })
})

beforeEach(() => {
  // Jangan membiarkan HashRouter render sebelumnya menerima hash/token baru
  // di luar act(); ini juga memutus SSE/effect sebelum test berikutnya.
  cleanup()
  localStorage.clear()
  invalidateCache()
  setToken(null)
  resetPresenceState()
  posCalls = 0
})

afterEach(() => cleanup())

async function daftar(mode: 'create' | 'join', communityId?: string) {
  seq += 1
  const { authApi } = await import('../lib/api')
  const r = await authApi.register({
    name: `Orang ${seq}`,
    phone: `08177700${String(seq).padStart(4, '0')}`,
    email: `npl${seq}@x.id`,
    password: 'rahasia123',
    house: `A${seq}`,
    mode,
    communityId,
    communityName: mode === 'create' ? `RW NPL ${seq}` : undefined,
    language: 'id',
  })
  return {
    token: r.token as string,
    id: (r.member as { id: string }).id,
    communityId: (r.member as { communityId: string }).communityId,
  }
}

describe('tanpa darurat', () => {
  it('aplikasi terbuka lama tidak mengirim posisi sama sekali', async () => {
    const m = await daftar('create')
    setToken(m.token)
    setSession(m.id)

    window.location.hash = '#/app'
    render(<App />)

    // Tunggu boot/sinkron pertama selesai sebelum membiarkan waktu berjalan;
    // semua update React selama jeda harus berada dalam act().
    await waitFor(() => expect(document.body.textContent).toContain('Butuh bantuan sekarang?'))
    // Polling berjalan tiap 8 detik; biarkan beberapa siklus lewat.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 3000))
    })
    expect(posCalls).toBe(0)
  }, 25000)
})

describe('saat ada darurat', () => {
  it('mengirim posisi, tetapi hanya sekali walau polling terus berjalan', async () => {
    const pelapor = await daftar('create')
    const tetangga = await daftar('join', pelapor.communityId)

    const { db } = await import('../../server/db.js')
    db.prepare("UPDATE members SET status='active' WHERE id=?").run(tetangga.id)

    // Pelapor menekan tombol darurat.
    const { api } = await import('../lib/api')
    setToken(pelapor.token)
    await api.post('/alerts', { category: 'other', at: TITIK, accuracy: 5 })

    // Tetangga membuka aplikasinya.
    setToken(tetangga.token)
    setSession(tetangga.id)
    posCalls = 0

    window.location.hash = '#/app'
    render(<App />)

    await waitFor(() => expect(posCalls).toBeGreaterThan(0), { timeout: 8000 })

    // Beberapa siklus polling berikutnya tidak boleh menambah kiriman:
    // itulah bedanya "sekali saat darurat" dengan "berkala".
    await act(async () => {
      await new Promise((r) => setTimeout(r, 3000))
    })
    expect(posCalls).toBe(1)
  }, 30000)
})

describe('pemeriksaan kode', () => {
  it('presence.ts tidak memakai pemantauan atau pengatur waktu', () => {
    const kode = readFileSync('src/lib/presence.ts', 'utf8')
    expect(kode).not.toContain('watchLocation')
    expect(kode).not.toContain('watchPosition')
    expect(kode).not.toContain('setInterval')
    expect(kode).not.toContain('setTimeout')
  })

  it('hanya ada satu tempat yang mengirim posisi ke server', () => {
    const kode = readFileSync('src/lib/presence.ts', 'utf8')
    expect(kode.split("api.post('/me/location'").length - 1).toBe(1)
  })

  it('pemantauan GPS terus-menerus hanya untuk satpam', () => {
    const kode = readFileSync('src/ui/DutyAndPresence.tsx', 'utf8')
    // Penjaga peran ini yang mencegah GPS warga menyala sepanjang hari.
    expect(kode).toContain('!isSatpam) return')
  })

  it('siaran lokasi hanya berjalan selama peringatan sendiri masih hidup', () => {
    const kode = readFileSync('src/pages/Panic.tsx', 'utf8')
    // Pemilik peringatan memang menyiarkan posisinya agar bisa ditemukan,
    // tetapi berhenti begitu peringatannya tidak lagi live.
    expect(kode).toContain('if (!active?.live)')
  })
})
