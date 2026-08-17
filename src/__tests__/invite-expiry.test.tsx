/**
 * Masa berlaku kode undangan.
 *
 * Keluhan lapangan: undangan "hanya valid sebentar", padahal seharusnya
 * 7 hari. Server memang selalu memberi 7 hari — yang salah adalah apa
 * yang sampai ke layar admin.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as pathJoin } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { setToken } from '../lib/api'
import { createInvite, invalidateCache, register, setSession } from '../lib/db'

vi.mock('../ui/MapView', () => ({ MapView: () => <div />, pinIcon: () => null }))

const HARI = 86_400_000
let seq = 0

beforeAll(async () => {
  process.env.WJW_DB = pathJoin(mkdtempSync(pathJoin(tmpdir(), 'wjw-inv-')), 't.sqlite')
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

async function adminBaru() {
  seq += 1
  const { authApi } = await import('../lib/api')
  const r = await authApi.register({
    name: `Admin ${seq}`,
    phone: `08199${String(seq).padStart(6, '0')}`,
    email: `inv${seq}@x.id`,
    password: 'rahasia123',
    house: 'A1',
    mode: 'create',
    communityName: `RW Undangan ${seq}`,
    language: 'id',
  })
  return { token: r.token as string, id: (r.member as { id: string }).id }
}

describe('server memberi 7 hari', () => {
  it('bawaan tanpa menyebut jumlah hari', async () => {
    const a = await adminBaru()
    const { api } = await import('../lib/api')
    setToken(a.token)
    const r = (await api.post('/invites', { role: 'warga' })) as {
      invite: { expiresAt: number }
    }
    const hari = (r.invite.expiresAt - Date.now()) / HARI
    expect(hari).toBeGreaterThan(6.9)
    expect(hari).toBeLessThan(7.1)
  }, 20000)

  it('nilai itu bertahan lewat /api/state, tidak menyusut', async () => {
    const a = await adminBaru()
    const { api } = await import('../lib/api')
    setToken(a.token)
    await api.post('/invites', { role: 'warga' })

    const st = (await api.get('/state')) as {
      invites: { expiresAt: number }[]
    }
    const hari = (st.invites[0].expiresAt - Date.now()) / HARI
    expect(hari).toBeGreaterThan(6.9)
  }, 20000)
})

describe('layar admin menampilkan masa berlakunya', () => {
  it('panel bagikan muncul dengan tanggal berlaku, bukan kosong', async () => {
    const user = userEvent.setup()
    const a = await adminBaru()
    setToken(a.token)
    setSession(a.id)

    window.location.hash = '#/app/admin'
    render(<App />)
    await waitFor(() => expect(document.body.textContent).toContain('Undangan'))

    await user.click(
      screen.getAllByRole('button').find((b) => b.textContent?.trim() === 'Undangan')!,
    )
    await user.click(await screen.findByRole('button', { name: /Ajak jadi Admin/i }))
    await user.click(await screen.findByRole('button', { name: /Buat kode undangan/i }))

    /*
     * Inilah inti bugnya: panel ini dulu tidak pernah muncul, karena
     * undangan barunya dicari di snapshot cache yang belum diperbarui.
     * Admin hanya melihat kodenya, tanpa tanggal berlaku sama sekali.
     */
    await waitFor(() => expect(document.body.textContent).toContain('Berlaku sampai'), {
      timeout: 8000,
    })
  }, 30000)
})

describe('mode lokal juga 7 hari', () => {
  it('createInvite tanpa opsi memberi 7 hari', () => {
    localStorage.clear()
    invalidateCache()
    const f = register({
      name: 'Budi',
      phone: '0811000123',
      email: 'lokal@x.id',
      password: 'secret1',
      house: 'C1',
      language: 'id',
      mode: 'create',
      communityName: 'RW Lokal',
    })
    if (!f.ok) throw new Error('setup gagal')

    const inv = createInvite(f.member.id, f.community.id, 'warga')
    const hari = (inv.expiresAt - Date.now()) / HARI
    expect(hari).toBeGreaterThan(6.9)
    expect(hari).toBeLessThan(7.1)
  })
})
