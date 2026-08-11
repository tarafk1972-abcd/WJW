/**
 * Memeriksa kode undangan.
 *
 * Kode bisa berada di dua tempat: basis data server, atau data di
 * peramban ini (undangan yang dibuat saat luring, atau dari data contoh).
 * Kedua jalur pemeriksaan harus memberi jawaban yang sama untuk kode yang
 * sama — dulu tidak: membuka tautan /join/:code menerima kode lokal,
 * sementara menekan "Periksa kode" menolaknya sebagai tidak valid.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { createInvite, invalidateCache, register } from '../lib/db'

vi.mock('../ui/MapView', () => ({ MapView: () => <div />, pinIcon: () => null }))

/** Buat undangan yang hanya ada di peramban ini. */
function localInvite() {
  const f = register({
    name: 'Budi',
    phone: '0811000001',
    email: 'b@x.id',
    password: 'secret1',
    house: 'C12',
    language: 'id',
    mode: 'create',
    communityName: 'RW 05 Griya Soreang',
  })
  if (!f.ok) throw new Error('setup gagal')
  const inv = createInvite(f.member.id, f.community.id, 'warga')
  localStorage.removeItem('wjw.session.v1')
  invalidateCache()
  return inv
}

/** Server menjawab, tetapi tidak mengenal kode itu. */
function serverRejects() {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ error: 'errInvite' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

/** Buka langkah "Punya kode undangan". */
async function openCodeStep(user: ReturnType<typeof userEvent.setup>) {
  window.location.hash = '#/register'
  render(<App />)
  await waitFor(() => expect(document.body.textContent).toContain('Lanjut'))
  await user.click(screen.getByRole('button', { name: /Lanjut/i }))
  await user.click(screen.getByRole('button', { name: /Punya kode undangan/i }))
  await waitFor(() => expect(document.querySelector('input')).toBeTruthy())
}

describe('kode undangan yang hanya ada di perangkat', () => {
  beforeEach(() => {
    localStorage.clear()
    invalidateCache()
    window.location.hash = '#/'
    vi.restoreAllMocks()
  })

  it('tidak lagi disebut tidak valid oleh tombol Periksa kode', async () => {
    const user = userEvent.setup()
    const inv = localInvite()
    serverRejects()

    await openCodeStep(user)
    await user.type(document.querySelector('input') as HTMLInputElement, inv.code)
    await user.click(screen.getByRole('button', { name: /Periksa kode/i }))

    await waitFor(() =>
      expect(document.body.textContent).toContain('RW 05 Griya Soreang'),
    )
    expect(document.body.textContent).not.toContain('tidak valid atau sudah dipakai')
  })

  it('memperingatkan bahwa undangan itu tidak sampai ke admin', async () => {
    const user = userEvent.setup()
    const inv = localInvite()
    serverRejects()

    await openCodeStep(user)
    await user.type(document.querySelector('input') as HTMLInputElement, inv.code)
    await user.click(screen.getByRole('button', { name: /Periksa kode/i }))

    await waitFor(() =>
      expect(document.body.textContent).toContain('hanya ada di perangkat ini'),
    )
  })

  it('kode yang benar-benar salah tetap ditolak', async () => {
    const user = userEvent.setup()
    localInvite()
    serverRejects()

    await openCodeStep(user)
    await user.type(document.querySelector('input') as HTMLInputElement, 'ZZZZZZ')
    await user.click(screen.getByRole('button', { name: /Periksa kode/i }))

    await waitFor(() =>
      expect(document.body.textContent).toContain('tidak valid atau sudah dipakai'),
    )
  })

  it('kode yang dikenal server tidak diberi peringatan itu', async () => {
    const user = userEvent.setup()
    localInvite()
    // Hanya endpoint pencarian undangan yang dijawab; sisanya dianggap
    // tidak ditemukan, agar tiruan ini tidak mempengaruhi layar lain.
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.includes('/api/invites/'))
        return Promise.resolve(
          new Response(
            JSON.stringify({
              invite: {
                code: 'ABC234',
                role: 'warga',
                expiresAt: Date.now() + 86_400_000,
              },
              community: { id: 'c_srv', name: 'RW Server', city: 'Bandung' },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        )
      return Promise.resolve(
        new Response(JSON.stringify({ error: 'errUnknown' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
      )
    })

    await openCodeStep(user)
    await user.type(document.querySelector('input') as HTMLInputElement, 'ABC234')
    await user.click(screen.getByRole('button', { name: /Periksa kode/i }))

    await waitFor(() => expect(document.body.textContent).toContain('RW Server'))
    expect(document.body.textContent).not.toContain('hanya ada di perangkat ini')
  })
})
