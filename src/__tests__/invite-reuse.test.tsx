/**
 * Satu kode undangan, banyak calon anggota.
 *
 * Keluhan lapangan: calon anggota kedua menerima "Kode undangan tidak
 * valid atau sudah dipakai", padahal kode itu berlaku 7 hari dan sengaja
 * dibuat tanpa batas pemakaian. Berkas ini menempuh jalur yang sama
 * dengan pengguna sungguhan: layar pendaftaran, tombol "Periksa kode",
 * lalu kirim — berulang kali dengan kode yang sama.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  process.env.WJW_DB = pathJoin(mkdtempSync(pathJoin(tmpdir(), 'wjw-reuse-')), 't.sqlite')
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

/** Admin membuat lingkungan di server, lalu satu kode undangan. */
async function adminDenganKode() {
  seq += 1
  const { api, authApi, setToken: set } = await import('../lib/api')
  const r = await authApi.register({
    name: `Admin ${seq}`,
    phone: `08155${String(seq).padStart(6, '0')}`,
    email: `reuse${seq}@x.id`,
    password: 'rahasia123',
    house: 'A1',
    mode: 'create',
    communityName: `The Regent ${seq}`,
    city: 'Tangerang Selatan',
    language: 'id',
  })
  set(r.token)
  const inv = (await api.post('/invites', { role: 'warga', days: 7 })) as {
    invite: { code: string }
  }
  set(null)
  return inv.invite.code
}

/** Perangkat baru: pakai kode itu sampai selesai mendaftar. */
async function daftarDenganKode(code: string, n: number) {
  const user = userEvent.setup()
  localStorage.clear()
  invalidateCache()
  setToken(null)

  window.location.hash = '#/register'
  const view = render(<App />)
  await waitFor(() => expect(document.body.textContent).toContain('Lanjut'))
  await user.click(screen.getByRole('button', { name: /Lanjut/i }))
  await user.click(screen.getByRole('button', { name: /Punya kode undangan/i }))

  const input = await waitFor(() => document.querySelector('input') as HTMLInputElement)
  await user.type(input, code)
  await user.click(screen.getByRole('button', { name: /Periksa kode/i }))

  await waitFor(() => expect(document.body.textContent).toContain('The Regent'), {
    timeout: 8000,
  })
  expect(document.body.textContent).not.toContain('tidak dikenali')

  await user.click(screen.getByRole('button', { name: /Lanjut/i }))

  const isi = async (placeholder: string, value: string) => {
    const el = await screen.findByPlaceholderText(placeholder)
    await user.type(el, value)
  }
  await isi('Budi Santoso', `Warga ${n}`)
  await isi('0812xxxxxxx', `0877${String(n).padStart(7, '0')}`)
  await isi('nama@email.com', `pakai${seq}-${n}@x.id`)
  await isi('••••••', 'rahasia123')
  await isi('Blok C No. 12', `B${n}`)

  await user.click(screen.getByRole('button', { name: /Ajukan permintaan gabung/i }))
  await waitFor(() => expect(window.location.hash).toContain('/pending'), {
    timeout: 8000,
  })
  view.unmount()
}

describe('satu kode undangan dipakai banyak orang', () => {
  it('orang kedua dan ketiga tidak ditolak', async () => {
    const code = await adminDenganKode()
    await daftarDenganKode(code, 1)
    await daftarDenganKode(code, 2)
    await daftarDenganKode(code, 3)
  }, 60000)
})
