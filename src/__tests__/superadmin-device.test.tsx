/**
 * Superadmin tidak boleh "memiliki" sebuah perangkat.
 *
 * Halaman depan menyapa anggota pemilik perangkat dan menyembunyikan
 * tombol Masuk. Ketika superadmin ikut terhitung, keluar dari Konsol
 * berujung pada layar "Apa kabar hari ini, Superadmin?" tanpa jalan
 * kembali — dan pada perangkat milik warga, sapaan warga itu tergantikan.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { deviceId, invalidateCache, loadDB, login, register, saveDB } from '../lib/db'

vi.mock('../ui/MapView', () => ({ MapView: () => <div />, pinIcon: () => null }))

const SUPER = 'tarafk1972@gmail.com'

describe('perangkat milik superadmin', () => {
  beforeEach(() => {
    localStorage.clear()
    invalidateCache()
    window.location.hash = '#/'
  })

  it('tidak mengklaim perangkat saat superadmin masuk', () => {
    const r = login(SUPER, 'superadmin')
    expect(r.ok).toBe(true)

    const sa = loadDB().members.find((m) => m.email === SUPER)!
    expect(sa.deviceId).toBeNull()
  })

  it('halaman depan tidak menyapa superadmin setelah keluar', async () => {
    login(SUPER, 'superadmin')

    window.location.hash = '#/'
    render(<App />)

    await waitFor(() => expect(document.body.textContent).toContain('Warga Jaga Warga'))
    const txt = document.body.textContent ?? ''
    expect(txt).not.toContain('Apa kabar hari ini, Superadmin')
    // Jalan kembali harus tetap ada.
    expect(screen.getByRole('button', { name: /Masuk/i })).toBeTruthy()
  })

  it('tidak merebut perangkat dari warga yang memakainya', async () => {
    const f = register({
      name: 'Budi Santoso',
      phone: '0811000001',
      email: 'budi@x.id',
      password: 'secret1',
      house: 'C12',
      language: 'id',
      mode: 'create',
      communityName: 'RW 05',
    })
    if (!f.ok) throw new Error('setup gagal')

    // Warga memiliki perangkat ini.
    const db = loadDB()
    db.members.find((m) => m.id === f.member.id)!.deviceId = deviceId()
    saveDB(db)

    // Superadmin memeriksa sesuatu dari perangkat yang sama.
    login(SUPER, 'superadmin')

    // Kepemilikan warga tidak boleh berpindah.
    const after = loadDB()
    expect(after.members.find((m) => m.id === f.member.id)!.deviceId).toBe(deviceId())
    expect(after.members.find((m) => m.email === SUPER)!.deviceId).toBeNull()

    // Dan sapaan yang muncul tetap milik warga.
    window.location.hash = '#/'
    render(<App />)
    await waitFor(() =>
      expect(document.body.textContent).toContain('Apa kabar hari ini, Budi'),
    )
  })

  it('superadmin tetap bisa masuk kembali ke Konsol', async () => {
    const user = userEvent.setup()
    login(SUPER, 'superadmin')

    window.location.hash = '#/'
    render(<App />)
    await waitFor(() => expect(document.body.textContent).toContain('Warga Jaga Warga'))

    await user.click(screen.getByRole('button', { name: /Masuk/i }))
    await waitFor(() => expect(window.location.hash).toBe('#/login'))
  })
})
