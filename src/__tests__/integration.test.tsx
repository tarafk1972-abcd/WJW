/**
 * Membuktikan UI benar-benar menulis ke API, bukan hanya localStorage.
 * Server dijalankan sungguhan di port acak; fetch relatif diarahkan ke sana.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as pathJoin } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { invalidateCache } from '../lib/db'
import { setToken } from '../lib/api'

vi.mock('../ui/MapView', () => ({ MapView: () => <div />, pinIcon: () => null }))

let base = ''
let stop: (() => void) | null = null

beforeAll(async () => {
  process.env.WJW_DB = pathJoin(mkdtempSync(pathJoin(tmpdir(), 'wjw-it-')), 't.sqlite')
  process.env.WJW_SUPERADMIN_PASSWORD = 'x'
  process.env.WJW_NO_LISTEN = '1'
  const { app } = await import('../../server/index.js')
  const { serve } = await import('@hono/node-server')
  const srv = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
  await new Promise((r) => setTimeout(r, 250))
  const addr = (srv as unknown as { address(): { port: number } }).address()
  base = `http://127.0.0.1:${addr.port}`
  stop = () => (srv as unknown as { close(): void }).close()

  // jsdom tidak bisa memakai URL relatif — arahkan ke server nyata
  const real = globalThis.fetch
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input)
    return real(url.startsWith('/') ? base + url : url, init)
  }) as typeof fetch
})

afterAll(() => stop?.())

beforeEach(() => {
  localStorage.clear()
  invalidateCache()
  setToken(null)
  window.location.hash = '#/'
})

/** Baca langsung dari basis data server. */
async function serverDb() {
  return (await import('../../server/db.js')).db
}

describe('UI ↔ server', () => {
  it('registrasi dari UI tersimpan di basis data server', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /Daftar Sekarang/i }))
    await user.click(screen.getByRole('button', { name: /Lanjut/i }))
    await user.click(screen.getByRole('button', { name: /Buat lingkungan baru/i }))
    await user.type(screen.getByPlaceholderText('RW 05 Griya Soreang'), 'RW Integrasi')
    await user.click(screen.getByRole('button', { name: /Lanjut/i }))
    await user.type(screen.getByPlaceholderText('Budi Santoso'), 'Budi Integrasi')
    await user.type(screen.getByPlaceholderText('0812xxxxxxx'), '081700000001')
    await user.type(screen.getByPlaceholderText('nama@email.com'), 'it1@x.id')
    await user.type(screen.getByPlaceholderText('••••••'), 'rahasia123')
    await user.type(screen.getByPlaceholderText('Blok C No. 12'), 'Blok Z')
    await user.click(screen.getByRole('button', { name: /Buat lingkungan baru/i }))

    await waitFor(() => expect(window.location.hash).toBe('#/app'), { timeout: 5000 })

    // bukti: ada di server, dan sandinya di-hash
    const db = await serverDb()
    const row = db
      .prepare('SELECT name, role, status, password_hash FROM members WHERE email=?')
      .get('it1@x.id') as { name: string; role: string; status: string; password_hash: string }
    expect(row.name).toBe('Budi Integrasi')
    expect(row.role).toBe('admin')
    expect(row.status).toBe('active')
    expect(row.password_hash.startsWith('$2')).toBe(true)
  })

  it('tombol darurat dari UI membuat peringatan di server', async () => {
    // daftar lewat API agar cepat, lalu buka UI dengan sesi itu
    const { authApi } = await import('../lib/api')
    const { setSession } = await import('../lib/db')
    const r = await authApi.register({
      name: 'Panik', phone: '081700000002', email: 'it2@x.id',
      password: 'rahasia123', house: 'Blok P', mode: 'create',
      communityName: 'RW Panik', language: 'id',
    })
    setSession((r.member as { id: string }).id)

    window.location.hash = '#/app'
    render(<App />)

    const btn = await screen.findByRole('button', { name: 'DARURAT' }, { timeout: 5000 })
    // tahan penuh 2 detik
    btn.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await new Promise((res) => setTimeout(res, 2300))

    const db = await serverDb()
    await waitFor(
      async () => {
        const n = db
          .prepare("SELECT count(*) n FROM reports WHERE kind='sos'")
          .get() as { n: number }
        expect(n.n).toBeGreaterThan(0)
      },
      { timeout: 6000 },
    )

    const rep = db
      .prepare("SELECT author_id, live, snapshot FROM reports WHERE kind='sos' LIMIT 1")
      .get() as { author_id: string; live: number; snapshot: string }
    expect(rep.live).toBe(1)
    expect(JSON.parse(rep.snapshot).name).toBe('Panik')
  }, 20000)

  it('persetujuan admin di UI mengubah status di server', async () => {
    const user = userEvent.setup()
    const { authApi, setToken: st } = await import('../lib/api')
    const { setSession } = await import('../lib/db')

    const admin = await authApi.register({
      name: 'Adm', phone: '081700000003', email: 'it3@x.id',
      password: 'rahasia123', house: 'A', mode: 'create',
      communityName: 'RW Approve', language: 'id',
    })
    const cid = (admin.member as { communityId: string }).communityId
    const adminToken = admin.token

    // pendaftar baru (menimpa token sementara)
    await authApi.register({
      name: 'Pendaftar', phone: '081700000004', email: 'it4@x.id',
      password: 'rahasia123', house: 'B', mode: 'join',
      communityId: cid, language: 'id',
    })

    // kembali sebagai admin
    st(adminToken)
    setSession((admin.member as { id: string }).id)

    window.location.hash = '#/app/admin'
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /Konfirmasi/i }, { timeout: 5000 }))
    const sheet = await screen.findByRole('dialog')
    const { within } = await import('@testing-library/react')
    await user.click(within(sheet).getByRole('button', { name: /^Satpam$/i }))
    await user.click(within(sheet).getByRole('button', { name: /Terima · Satpam/i }))

    const db = await serverDb()
    await waitFor(
      () => {
        const row = db
          .prepare('SELECT role, status FROM members WHERE email=?')
          .get('it4@x.id') as { role: string; status: string }
        expect(row.status).toBe('active')
        expect(row.role).toBe('satpam')
      },
      { timeout: 6000 },
    )
  }, 20000)

  /**
   * Langganan lewat server: satu-satunya cara bayar adalah QRIS ShopeePay,
   * dan nomor referensinya datang dari server — tidak ada kolom isian
   * apa pun di halaman itu untuk mengetiknya.
   */
  it('halaman langganan memakai QRIS dengan referensi dari server', async () => {
    const user = userEvent.setup()
    const { authApi, setToken: st } = await import('../lib/api')
    const { setSession } = await import('../lib/db')

    const admin = await authApi.register({
      name: 'Admin Tagihan', phone: '081700000009', email: 'bill@x.id',
      password: 'rahasia123', house: 'A1', mode: 'create',
      communityName: 'RW Tagihan', language: 'id',
    })
    st(admin.token)
    setSession((admin.member as { id: string }).id)

    window.location.hash = '#/app/billing'
    render(<App />)
    await waitFor(() => expect(document.body.textContent).toContain('Langganan'))

    await user.click(await screen.findByRole('button', { name: /Buat tagihan/i }))

    // Tunggu kartu QRIS-nya, bukan sekadar kata "QRIS": kata itu juga
    // muncul pada keterangan di bawah tombol sebelum tagihan dibuat.
    await waitFor(() => expect(document.querySelector('.qris-card')).toBeTruthy(), {
      timeout: 6000,
    })

    // Referensi yang tampil harus sama persis dengan yang tersimpan di server.
    const db = await serverDb()
    const row = db
      .prepare('SELECT reference FROM invoices ORDER BY created_at DESC LIMIT 1')
      .get() as { reference: string }
    expect(row.reference).toMatch(/^WJW[A-HJ-NP-Z2-9]{5}$/)
    expect(await screen.findAllByText(row.reference)).not.toHaveLength(0)

    // Tidak ada satu pun kolom isian: referensi tidak bisa diketik admin.
    expect(document.querySelectorAll('input')).toHaveLength(0)
    expect(document.body.textContent).not.toMatch(/bukti transfer/i)
  }, 20000)
})
