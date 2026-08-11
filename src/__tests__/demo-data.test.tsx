/**
 * Tombol "data contoh" dan jalan keluarnya.
 *
 * Data contoh hanya hidup di peramban: ia tidak pernah sampai ke server,
 * sehingga Konsol Superadmin tetap kosong. Ia juga langsung menjadikan
 * perangkat ini milik "Budi Santoso". Keduanya mengejutkan bila tidak
 * dikatakan lebih dulu, dan jalan keluarnya dulu hanya ada di Pengaturan
 * — yang baru bisa dibuka setelah masuk.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { invalidateCache, loadDB } from '../lib/db'

vi.mock('../ui/MapView', () => ({ MapView: () => <div />, pinIcon: () => null }))

describe('data contoh', () => {
  beforeEach(() => {
    localStorage.clear()
    invalidateCache()
    window.location.hash = '#/'
    vi.restoreAllMocks()
  })

  it('menyebutkan bahwa datanya tidak dikirim ke server', async () => {
    render(<App />)
    await waitFor(() => expect(document.body.textContent).toContain('Warga Jaga Warga'))
    expect(document.body.textContent).toContain('tidak dikirim ke server')
  })

  it('meminta persetujuan lebih dulu, dan batal berarti tidak berubah', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'confirm').mockReturnValue(false)

    render(<App />)
    await user.click(await screen.findByRole('button', { name: /data contoh/i }))

    expect(loadDB().communities).toHaveLength(0)
    expect(window.location.hash).toBe('#/')
  })

  it('memperingatkan soal Konsol dan nama perangkat sebelum mengisi', async () => {
    const user = userEvent.setup()
    const ask = vi.spyOn(globalThis, 'confirm').mockReturnValue(false)

    render(<App />)
    await user.click(await screen.findByRole('button', { name: /data contoh/i }))

    const pesan = ask.mock.calls[0][0] as string
    expect(pesan).toContain('Konsol')
    expect(pesan).toContain('Budi Santoso')
  })

  it('menawarkan jalan keluar tanpa harus masuk lebih dulu', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true)

    render(<App />)
    await user.click(await screen.findByRole('button', { name: /data contoh/i }))
    await waitFor(() => expect(window.location.hash).toBe('#/app'))

    // Kembali ke halaman depan: sapaan Budi, plus tombol reset.
    window.location.hash = '#/'
    await waitFor(() =>
      expect(document.body.textContent).toContain('Apa kabar hari ini, Budi'),
    )

    await user.click(screen.getByRole('button', { name: /Reset data demo/i }))
    await waitFor(() => expect(loadDB().communities).toHaveLength(0))
    expect(document.body.textContent).not.toContain('Apa kabar hari ini, Budi')
  })
})
