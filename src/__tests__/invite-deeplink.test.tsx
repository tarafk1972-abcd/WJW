/**
 * Membuka tautan undangan (#/join/KODE) di perangkat yang belum pernah
 * memakai aplikasi ini.
 *
 * Itulah keadaan setiap calon anggota: HP-nya kosong, tidak punya data
 * lingkungan apa pun. Dulu layar ini hanya mencari kode di penyimpanan
 * lokal, yang di HP baru selalu kosong — jadi kolom kode terisi tetapi
 * nama lingkungan tidak pernah muncul, dan tombol Lanjut tidak bisa
 * ditekan. Kode yang sah tampak seperti kode yang ditolak.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as pathJoin } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { setToken } from '../lib/api'
import { invalidateCache } from '../lib/db'

vi.mock('../ui/MapView', () => ({ MapView: () => <div />, pinIcon: () => null }))

let seq = 0

beforeAll(async () => {
  process.env.WJW_DB = pathJoin(mkdtempSync(pathJoin(tmpdir(), 'wjw-deep-')), 't.sqlite')
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
  window.location.hash = '#/'
})

async function kodeDariAdmin() {
  seq += 1
  const { api, authApi, setToken: set } = await import('../lib/api')
  const r = await authApi.register({
    name: `Admin ${seq}`,
    phone: `08177${String(seq).padStart(6, '0')}`,
    email: `deep${seq}@x.id`,
    password: 'rahasia123',
    house: 'A1',
    mode: 'create',
    communityName: `Villa Deeplink ${seq}`,
    city: 'Tangerang Selatan',
    language: 'id',
  })
  set(r.token)
  const inv = (await api.post('/invites', { role: 'warga', days: 7 })) as {
    invite: { code: string }
  }
  set(null)
  // perangkat calon anggota: kosong sama sekali
  localStorage.clear()
  invalidateCache()
  return inv.invite.code
}

describe('tautan undangan di perangkat baru', () => {
  it('nama lingkungan langsung muncul tanpa menekan apa pun', async () => {
    const code = await kodeDariAdmin()

    window.location.hash = `#/join/${code}`
    render(<App />)

    expect(await screen.findByDisplayValue(code)).toBeTruthy()
    await waitFor(() => expect(document.body.textContent).toContain('Villa Deeplink'), {
      timeout: 8000,
    })
    expect(document.body.textContent).not.toContain('tidak dikenali')
  }, 30000)

  it('kode yang memang salah tetap dikatakan salah', async () => {
    await kodeDariAdmin()

    window.location.hash = '#/join/ZZZZZZ'
    render(<App />)

    await waitFor(() => expect(document.body.textContent).toContain('tidak dikenali'), {
      timeout: 8000,
    })
  }, 30000)
})
