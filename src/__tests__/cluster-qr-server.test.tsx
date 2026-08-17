/**
 * QR pendaftaran cluster harus dibuat di server, bukan hanya di HP admin.
 *
 * Keluhan lapangan: calon anggota memindai QR yang dicetak admin dan
 * menerima "Kode undangan tidak valid atau sudah dipakai". Penyebabnya
 * bukan masa berlaku dan bukan batas pemakaian: kode itu memang tidak
 * pernah ada di server. Halaman QR cluster membuatnya lewat jalur lokal
 * saja, jadi hanya peramban admin yang mengenalnya — setiap perangkat
 * lain, termasuk HP tetangga, benar-benar tidak menemukannya.
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

let seq = 0

beforeAll(async () => {
  process.env.WJW_DB = pathJoin(mkdtempSync(pathJoin(tmpdir(), 'wjw-cqr-')), 't.sqlite')
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

async function adminMasuk() {
  seq += 1
  const { authApi } = await import('../lib/api')
  const r = await authApi.register({
    name: `Admin ${seq}`,
    phone: `08166${String(seq).padStart(6, '0')}`,
    email: `cqr${seq}@x.id`,
    password: 'rahasia123',
    house: 'A1',
    mode: 'create',
    communityName: `The Regent ${seq}`,
    city: 'Tangerang Selatan',
    language: 'id',
  })
  setSession((r.member as { id: string }).id)
  return r.token as string
}

describe('QR cluster', () => {
  it('kodenya dikenali server, bukan hanya perangkat admin', async () => {
    const user = userEvent.setup()
    await adminMasuk()

    window.location.hash = '#/app/cluster-qr'
    const view = render(<App />)

    await user.click(await screen.findByRole('button', { name: /Buat QR pendaftaran/i }))

    // Ambil kode yang tampil di layar admin.
    const el = await waitFor(
      () => {
        const n = document.querySelector('.code-display')
        if (!n?.textContent?.trim()) throw new Error('kode belum tampil')
        return n
      },
      { timeout: 8000 },
    )
    const code = el.textContent!.trim()
    view.unmount()

    /*
     * Inilah ujiannya: tanya server, bukan cache peramban. Kalau kode
     * hanya dibuat secara lokal, permintaan ini 404 — persis seperti
     * yang dialami warga yang memindai posternya.
     */
    const r = await fetch(`/api/invites/${code}`)
    expect(r.status).toBe(200)
    const body = (await r.json()) as { invite: { role: string } }
    expect(body.invite.role).toBe('warga')
  }, 40000)

  it('tetap tampil setelah admin menutup dan membuka lagi halamannya', async () => {
    const user = userEvent.setup()
    await adminMasuk()

    window.location.hash = '#/app/cluster-qr'
    const a = render(<App />)
    await user.click(await screen.findByRole('button', { name: /Buat QR pendaftaran/i }))
    const code = (
      await waitFor(
        () => {
          const n = document.querySelector('.code-display')
          if (!n?.textContent?.trim()) throw new Error('belum')
          return n
        },
        { timeout: 8000 },
      )
    ).textContent!.trim()
    a.unmount()

    // Buka lagi: kode yang sama harus muncul kembali, bukan layar kosong
    // dengan tombol "Buat QR pendaftaran" lagi.
    window.location.hash = '#/app/cluster-qr'
    const b = render(<App />)
    await waitFor(() => expect(document.body.textContent).toContain(code), {
      timeout: 8000,
    })
    b.unmount()
  }, 40000)
})
