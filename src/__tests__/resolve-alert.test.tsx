/**
 * Menandai peringatan selesai harus bertahan.
 *
 * Keluhan lapangan: setelah Admin/Satpam menekan "Tandai selesai",
 * statusnya sempat berubah menjadi "Selesai" beberapa detik, lalu kembali
 * menjadi "Ditangani". Penyebabnya perubahan hanya ditulis ke cache
 * perangkat, tidak pernah dikirim ke server — lalu sinkronisasi
 * berikutnya (tiap 8 detik) menimpanya kembali dengan data server.
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
  process.env.WJW_DB = pathJoin(mkdtempSync(pathJoin(tmpdir(), 'wjw-res-')), 't.sqlite')
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
    phone: `08199${String(seq).padStart(6, '0')}`,
    email: `res${seq}@x.id`,
    password: 'rahasia123',
    house: `A${seq}`,
    mode,
    communityId,
    communityName: mode === 'create' ? `RW Resolve ${seq}` : undefined,
    language: 'id',
  })
  return {
    token: r.token as string,
    id: (r.member as { id: string }).id,
    communityId: (r.member as { communityId: string }).communityId,
  }
}

describe('menandai peringatan selesai', () => {
  it('tetap Selesai setelah sinkronisasi berikutnya', async () => {
    const user = userEvent.setup()
    const admin = await daftar('create')
    const warga = await daftar('join', admin.communityId)

    const { db } = await import('../../server/db.js')
    db.prepare("UPDATE members SET status='active' WHERE id=?").run(warga.id)

    // Warga menekan tombol darurat.
    const { api } = await import('../lib/api')
    setToken(warga.token)
    const dibuat = (await api.post('/alerts', {
      category: 'other',
      at: TITIK,
      accuracy: 5,
    })) as { report: { id: string } }
    const alertId = dibuat.report.id

    // Admin membukanya dan menandai selesai.
    setToken(admin.token)
    setSession(admin.id)
    window.location.hash = `#/app/reports?id=${alertId}`
    render(<App />)

    const tombol = await screen.findByRole(
      'button',
      { name: /Tandai selesai/i },
      { timeout: 8000 },
    )
    await user.click(tombol)

    // Inilah intinya: server harus ikut berubah, bukan hanya layar.
    await waitFor(
      () => {
        const row = db
          .prepare('SELECT status FROM reports WHERE id=?')
          .get(alertId) as { status: string }
        expect(row.status).toBe('resolved')
      },
      { timeout: 8000 },
    )
  }, 30000)

  it('status "Ditangani" juga bertahan di server', async () => {
    const user = userEvent.setup()
    const admin = await daftar('create')
    const warga = await daftar('join', admin.communityId)

    const { db } = await import('../../server/db.js')
    db.prepare("UPDATE members SET status='active' WHERE id=?").run(warga.id)

    const { api } = await import('../lib/api')
    setToken(warga.token)
    const dibuat = (await api.post('/alerts', {
      category: 'other',
      at: TITIK,
      accuracy: 5,
    })) as { report: { id: string } }
    const alertId = dibuat.report.id

    setToken(admin.token)
    setSession(admin.id)
    window.location.hash = `#/app/reports?id=${alertId}`
    render(<App />)

    const tombol = await screen.findByRole(
      'button',
      { name: /Saya menuju lokasi/i },
      { timeout: 8000 },
    )
    await user.click(tombol)

    // Penanggap harus tercatat di server, bukan hanya di layar.
    await waitFor(
      () => {
        const row = db
          .prepare('SELECT responders FROM reports WHERE id=?')
          .get(alertId) as { responders: string }
        expect(JSON.parse(row.responders)).toContain(admin.id)
      },
      { timeout: 8000 },
    )
  }, 30000)
})
