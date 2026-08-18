/**
 * Layar masuk.
 *
 * Layar ini dulu selalu menampilkan "Superadmin: <email> / superadmin".
 * Sandi itu hanya berlaku pada data contoh di perangkat; saat memakai
 * server, sandinya ditentukan operator lewat WJW_SUPERADMIN_PASSWORD.
 * Menampilkannya menyesatkan — pengguna mencoba lalu ditolak.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { invalidateCache } from '../lib/db'

vi.mock('../ui/MapView', () => ({ MapView: () => <div />, pinIcon: () => null }))

async function openLogin() {
  window.location.hash = '#/login'
  render(<App />)
  await waitFor(() => expect(document.body.textContent).toContain('Masuk'))
}

describe('layar masuk', () => {
  beforeEach(() => {
    localStorage.clear()
    invalidateCache()
    window.location.hash = '#/'
    vi.restoreAllMocks()
  })

  it('tidak menawarkan sandi demo selama server masih terjangkau', async () => {
    const user = userEvent.setup()
    // Server menjawab: kredensial salah.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'errLogin' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await openLogin()
    await user.type(screen.getByPlaceholderText(/nama@email.com|08/i), 'x@y.id')
    await user.type(screen.getByPlaceholderText('••••••'), 'salah123')
    await user.click(screen.getByRole('button', { name: /^Masuk$/i }))

    await waitFor(() =>
      expect(document.body.textContent).toContain('Email/HP atau kata sandi salah.'),
    )
    // Sandi contoh tidak boleh dijanjikan: di server ia pasti ditolak.
    expect(document.body.textContent).not.toContain('Akun demo')
  })

  it('menawarkan bantuan pemulihan saat kredensial ditolak', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'errLogin' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await openLogin()
    await user.type(screen.getByPlaceholderText(/nama@email.com|08/i), 'x@y.id')
    await user.type(screen.getByPlaceholderText('••••••'), 'salah123')
    await user.click(screen.getByRole('button', { name: /^Masuk$/i }))

    const link = await screen.findByRole('button', { name: /Lupa sandi/i })
    await user.click(link)
    // Menyebut perintah yang benar-benar ada di package.json
    await waitFor(() =>
      expect(document.body.textContent).toContain('npm run reset-password'),
    )
  })

  it('menampilkan akun demo hanya setelah server terbukti tak terjangkau', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('failed to fetch'))

    await openLogin()
    expect(document.body.textContent).not.toContain('Akun demo')

    await user.type(screen.getByPlaceholderText(/nama@email.com|08/i), 'x@y.id')
    await user.type(screen.getByPlaceholderText('••••••'), 'salah123')
    await user.click(screen.getByRole('button', { name: /^Masuk$/i }))

    await waitFor(() => expect(document.body.textContent).toContain('Akun demo'))
    // dan dijelaskan bahwa itu bukan untuk server
    expect(document.body.textContent).toContain('bukan untuk server')
  })
})
