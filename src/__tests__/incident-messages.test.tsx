/**
 * Pesan pada utas insiden harus sampai ke peserta lain.
 *
 * Sebelumnya balasan hanya tersimpan di perangkat pengirim: tidak pernah
 * terlihat siapa pun, sementara pengirim mengira pesannya sudah sampai.
 * Kegagalan diam-diam seperti itu berbahaya saat kejadian berlangsung.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as pathJoin } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { setToken } from '../lib/api'
import { invalidateCache, setSession } from '../lib/db'

vi.mock('../ui/MapView', () => ({ MapView: () => <div />, pinIcon: () => null }))

const TITIK = { lat: -6.9829, lng: 107.5197 }
let seq = 0

beforeAll(async () => {
  process.env.WJW_DB = pathJoin(mkdtempSync(pathJoin(tmpdir(), 'wjw-im-')), 't.sqlite')
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
    return real(u.startsWith('/') ? base + u : u, init)
  }) as typeof fetch
})

beforeEach(() => {
  localStorage.clear()
  invalidateCache()
  setToken(null)
})

async function daftar(mode: 'create' | 'join', communityId?: string) {
  seq += 1
  const { authApi } = await import('../lib/api')
  const r = await authApi.register({
    name: `Orang ${seq}`,
    phone: `08166${String(seq).padStart(6, '0')}`,
    email: `im${seq}@x.id`,
    password: 'rahasia123',
    house: `A${seq}`,
    mode,
    communityId,
    communityName: mode === 'create' ? `RW Pesan ${seq}` : undefined,
    language: 'id',
  })
  return {
    token: r.token as string,
    id: (r.member as { id: string }).id,
    communityId: (r.member as { communityId: string }).communityId,
  }
}

/** Buat satu peringatan darurat, kembalikan idnya. */
async function buatAlert(token: string) {
  const { api } = await import('../lib/api')
  setToken(token)
  const r = (await api.post('/alerts', {
    category: 'other',
    at: TITIK,
    accuracy: 5,
  })) as { report: { id: string } }
  return r.report.id
}

function pesanDi(id: string, db: import('better-sqlite3').Database) {
  const row = db.prepare('SELECT messages FROM reports WHERE id=?').get(id) as {
    messages: string
  }
  return JSON.parse(row.messages) as { from: string; body: string }[]
}

describe('utas insiden', () => {
  it('pesan admin tersimpan di server, bukan hanya di perangkatnya', async () => {
    const user = userEvent.setup()
    const admin = await daftar('create')
    const warga = await daftar('join', admin.communityId)
    const { db } = await import('../../server/db.js')
    db.prepare("UPDATE members SET status='active' WHERE id=?").run(warga.id)

    const alertId = await buatAlert(warga.token)

    setToken(admin.token)
    setSession(admin.id)
    window.location.hash = `#/app/reports?id=${alertId}`
    render(<App />)

    const kolom = await screen.findByPlaceholderText(/Tulis perkembangan/i, undefined, {
      timeout: 8000,
    })
    await user.type(kolom, 'Saya sudah di gerbang')
    await user.keyboard('{Enter}')

    await waitFor(
      () => {
        const pesan = pesanDi(alertId, db)
        expect(pesan.some((m) => m.body === 'Saya sudah di gerbang')).toBe(true)
      },
      { timeout: 8000 },
    )
  }, 30000)

  it('pesan itu terlihat oleh pelapor', async () => {
    const admin = await daftar('create')
    const warga = await daftar('join', admin.communityId)
    const { db } = await import('../../server/db.js')
    db.prepare("UPDATE members SET status='active' WHERE id=?").run(warga.id)

    const alertId = await buatAlert(warga.token)

    // Admin mengirim lewat API.
    const { api } = await import('../lib/api')
    setToken(admin.token)
    await api.post(`/alerts/${alertId}/messages`, { body: 'Bantuan menuju ke sana' })

    // Pelapor membuka layarnya dan melihat pesan itu.
    setToken(warga.token)
    setSession(warga.id)
    window.location.hash = `#/app/reports?id=${alertId}`
    render(<App />)

    await waitFor(
      () => expect(document.body.textContent).toContain('Bantuan menuju ke sana'),
      { timeout: 8000 },
    )
  }, 30000)

  it('menolak pesan kosong', async () => {
    const a = await daftar('create')
    const alertId = await buatAlert(a.token)
    const { api, ApiError } = await import('../lib/api')
    setToken(a.token)
    await expect(
      api.post(`/alerts/${alertId}/messages`, { body: '   ' }),
    ).rejects.toBeInstanceOf(ApiError)
  }, 20000)

  it('orang dari lingkungan lain tidak bisa menulis di utas ini', async () => {
    const a = await daftar('create')
    const asing = await daftar('create')
    const alertId = await buatAlert(a.token)

    const { api, ApiError } = await import('../lib/api')
    setToken(asing.token)
    await expect(
      api.post(`/alerts/${alertId}/messages`, { body: 'menyusup' }),
    ).rejects.toBeInstanceOf(ApiError)
  }, 20000)
})

/**
 * Foto bukti harus sampai ke penolong, bukan berhenti di perangkat
 * pengirim. Karena gambar bisa besar, batasnya ditegakkan di server —
 * klien bisa diubah siapa saja.
 */
describe('foto bukti', () => {
  /** PNG 1x1 yang sah. */
  const PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ' +
    'AAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

  function lampiranDi(id: string, db: import('better-sqlite3').Database) {
    const row = db.prepare('SELECT attachments FROM reports WHERE id=?').get(id) as {
      attachments: string
    }
    return JSON.parse(row.attachments) as { dataUrl: string; by: string }[]
  }

  it('tersimpan di server sehingga terlihat peserta lain', async () => {
    const a = await daftar('create')
    const alertId = await buatAlert(a.token)
    const { api } = await import('../lib/api')
    const { db } = await import('../../server/db.js')

    setToken(a.token)
    await api.post(`/alerts/${alertId}/attachments`, { dataUrl: PNG })

    const lampiran = lampiranDi(alertId, db)
    expect(lampiran).toHaveLength(1)
    expect(lampiran[0].by).toBe(a.id)
  }, 20000)

  it('menolak berkas yang bukan gambar', async () => {
    const a = await daftar('create')
    const alertId = await buatAlert(a.token)
    const { api, ApiError } = await import('../lib/api')
    setToken(a.token)

    // Skrip yang menyamar sebagai lampiran.
    await expect(
      api.post(`/alerts/${alertId}/attachments`, {
        dataUrl: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      }),
    ).rejects.toBeInstanceOf(ApiError)
  }, 20000)

  it('menolak gambar yang terlalu besar', async () => {
    const a = await daftar('create')
    const alertId = await buatAlert(a.token)
    const { api, ApiError } = await import('../lib/api')
    setToken(a.token)

    const besar = 'data:image/jpeg;base64,' + 'A'.repeat(900_000)
    await expect(
      api.post(`/alerts/${alertId}/attachments`, { dataUrl: besar }),
    ).rejects.toBeInstanceOf(ApiError)
  }, 20000)

  it('membatasi jumlah lampiran per laporan', async () => {
    const a = await daftar('create')
    const alertId = await buatAlert(a.token)
    const { api, ApiError } = await import('../lib/api')
    setToken(a.token)

    for (let i = 0; i < 12; i++) {
      await api.post(`/alerts/${alertId}/attachments`, { dataUrl: PNG })
    }
    await expect(
      api.post(`/alerts/${alertId}/attachments`, { dataUrl: PNG }),
    ).rejects.toBeInstanceOf(ApiError)
  }, 30000)

  it('orang dari lingkungan lain tidak bisa melampirkan', async () => {
    const a = await daftar('create')
    const asing = await daftar('create')
    const alertId = await buatAlert(a.token)

    const { api, ApiError } = await import('../lib/api')
    setToken(asing.token)
    await expect(
      api.post(`/alerts/${alertId}/attachments`, { dataUrl: PNG }),
    ).rejects.toBeInstanceOf(ApiError)
  }, 20000)
})
