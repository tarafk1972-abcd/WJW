/**
 * Mengganti nama lingkungan.
 *
 * Nama ini tampil di bagian atas aplikasi setiap warga. Sebelumnya tidak
 * ada cara mengubahnya, sehingga lingkungan yang terlanjur bernama salah
 * — mis. kosong, sehingga yang terbaca tinggal nama adminnya — menyandang
 * nama itu selamanya.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { invalidateCache, loadDB, register, renameCommunity } from '../lib/db'

vi.mock('../ui/MapView', () => ({ MapView: () => <div />, pinIcon: () => null }))

function makeAdmin() {
  const f = register({
    name: 'Budi Santoso',
    phone: '0811000001',
    email: 'budi@x.id',
    password: 'secret1',
    house: 'C12',
    language: 'id',
    mode: 'create',
    communityName: 'RW 05 Griya Soreang',
  })
  if (!f.ok) throw new Error('setup gagal')
  return f
}

describe('renameCommunity', () => {
  beforeEach(() => {
    localStorage.clear()
    invalidateCache()
    window.location.hash = '#/'
  })

  it('mengganti nama yang tampil di seluruh aplikasi', () => {
    const f = makeAdmin()
    const r = renameCommunity(f.member.id, f.community.id, 'RW 07 Melati')
    expect(r.ok).toBe(true)
    expect(loadDB().communities[0].name).toBe('RW 07 Melati')
  })

  it('menolak nama kosong', () => {
    const f = makeAdmin()
    const r = renameCommunity(f.member.id, f.community.id, '   ')
    expect(r.ok).toBe(false)
    // Nama lama harus tetap utuh, bukan ikut terhapus.
    expect(loadDB().communities[0].name).toBe('RW 05 Griya Soreang')
  })

  it('menolak nama yang sama dengan nama admin yang mengubah', () => {
    const f = makeAdmin()
    const r = renameCommunity(f.member.id, f.community.id, 'budi santoso')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('errCommunityNameIsPerson')
  })

  it('mencatat perubahannya di catatan aktivitas', () => {
    const f = makeAdmin()
    renameCommunity(f.member.id, f.community.id, 'RW 07 Melati')
    const jejak = loadDB().audit.find((a) => a.action === 'community.rename')
    expect(jejak).toBeTruthy()
    expect(jejak!.detail).toContain('RW 07 Melati')
  })
})

describe('halaman Admin', () => {
  beforeEach(() => {
    localStorage.clear()
    invalidateCache()
    window.location.hash = '#/'
  })

  it('menyediakan cara mengganti nama lingkungan', async () => {
    const user = userEvent.setup()
    makeAdmin()

    window.location.hash = '#/app/admin'
    render(<App />)
    await waitFor(() =>
      expect(document.body.textContent).toContain('RW 05 Griya Soreang'),
    )

    await user.click(screen.getByRole('button', { name: /RW 05 Griya Soreang/i }))
    const dialog = await screen.findByRole('dialog')
    const { within } = await import('@testing-library/react')

    const input = within(dialog).getByDisplayValue('RW 05 Griya Soreang')
    await user.clear(input)
    await user.type(input, 'RW 07 Melati')
    await user.click(within(dialog).getByRole('button', { name: /Simpan/i }))

    await waitFor(() => expect(loadDB().communities[0].name).toBe('RW 07 Melati'))
  })
})

/**
 * Halaman Pengaturan menampilkan "Nama lingkungan", jadi di situlah orang
 * mencari cara mengubahnya. Sebelumnya nilainya hanya teks mati dan satu-
 * satunya tombol ganti nama ada di halaman lain.
 */
describe('halaman Pengaturan', () => {
  beforeEach(() => {
    localStorage.clear()
    invalidateCache()
    window.location.hash = '#/'
  })

  it('admin bisa mengganti nama dan kota dari sini', async () => {
    const user = userEvent.setup()
    makeAdmin()

    window.location.hash = '#/app/settings'
    render(<App />)
    await waitFor(() =>
      expect(document.body.textContent).toContain('Nama lingkungan'),
    )

    await user.click(screen.getByRole('button', { name: /RW 05 Griya Soreang/i }))
    const dialog = await screen.findByRole('dialog')
    const { within } = await import('@testing-library/react')

    const nama = within(dialog).getByDisplayValue('RW 05 Griya Soreang')
    await user.clear(nama)
    await user.type(nama, 'The Regent')

    const kota = within(dialog).getByPlaceholderText('Kab. Bandung')
    await user.clear(kota)
    await user.type(kota, 'Tangerang Selatan')

    await user.click(within(dialog).getByRole('button', { name: /Simpan/i }))

    await waitFor(() => {
      const c = loadDB().communities[0]
      expect(c.name).toBe('The Regent')
      expect(c.city).toBe('Tangerang Selatan')
    })
  })

  it('warga biasa hanya melihat namanya, tanpa bisa mengubah', async () => {
    const f = makeAdmin()
    // Turunkan perannya menjadi warga biasa.
    const db = loadDB()
    db.members.find((m) => m.id === f.member.id)!.role = 'warga'
    const { saveDB } = await import('../lib/db')
    saveDB(db)

    window.location.hash = '#/app/settings'
    render(<App />)
    await waitFor(() =>
      expect(document.body.textContent).toContain('Nama lingkungan'),
    )
    expect(screen.queryByRole('button', { name: /RW 05 Griya Soreang/i })).toBeNull()
    expect(document.body.textContent).toContain('RW 05 Griya Soreang')
  })
})
