/**
 * Kolom kata sandi bisa diperiksa isinya.
 *
 * Sandi yang diketik tanpa bisa dilihat adalah sebab umum gagal masuk —
 * huruf besar/kecil tertukar atau papan ketik ponsel menyisipkan spasi.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { invalidateCache } from '../lib/db'

vi.mock('../ui/MapView', () => ({ MapView: () => <div />, pinIcon: () => null }))

const pwInput = () => document.querySelector('.pw-input') as HTMLInputElement
const toggle = () =>
  document.querySelector('.pw-toggle') as HTMLButtonElement

async function openLogin() {
  window.location.hash = '#/login'
  render(<App />)
  await waitFor(() => expect(document.body.textContent).toContain('Masuk'))
}

describe('melihat kata sandi', () => {
  beforeEach(() => {
    localStorage.clear()
    invalidateCache()
    window.location.hash = '#/'
  })

  it('tersembunyi secara bawaan', async () => {
    await openLogin()
    expect(pwInput().type).toBe('password')
  })

  it('menampilkan lalu menyembunyikan lagi saat tombol ditekan', async () => {
    const user = userEvent.setup()
    await openLogin()
    await user.type(pwInput(), 'RahasiaKu1')

    await user.click(toggle())
    expect(pwInput().type).toBe('text')
    // Yang terlihat memang persis yang diketik.
    expect(pwInput().value).toBe('RahasiaKu1')

    await user.click(toggle())
    expect(pwInput().type).toBe('password')
    expect(pwInput().value).toBe('RahasiaKu1')
  })

  it('memberi label yang berubah sesuai keadaan, untuk pembaca layar', async () => {
    const user = userEvent.setup()
    await openLogin()

    expect(screen.getByLabelText('Tampilkan kata sandi')).toBeTruthy()
    expect(toggle().getAttribute('aria-pressed')).toBe('false')

    await user.click(toggle())
    expect(screen.getByLabelText('Sembunyikan kata sandi')).toBeTruthy()
    expect(toggle().getAttribute('aria-pressed')).toBe('true')
  })

  it('tidak ikut mengirim formulir saat ditekan', async () => {
    const user = userEvent.setup()
    // Bila tombol ini bertipe submit, menekannya akan mencoba masuk.
    const spy = vi.spyOn(globalThis, 'fetch')
    await openLogin()
    await user.type(pwInput(), 'abc123')
    await user.click(toggle())

    expect(toggle().getAttribute('type')).toBe('button')
    expect(spy).not.toHaveBeenCalled()
    expect(window.location.hash).toBe('#/login')
  })

  it('tidak mengganggu urutan Tab', async () => {
    await openLogin()
    // Tombol mata dilewati agar Tab dari sandi langsung ke tombol Masuk.
    expect(toggle().tabIndex).toBe(-1)
  })

  it('tersedia juga saat mendaftar, lengkap dengan syarat panjangnya', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/register'
    render(<App />)
    await waitFor(() => expect(document.body.textContent).toContain('Lanjut'))

    await user.click(screen.getByRole('button', { name: /Lanjut/i }))
    await user.click(screen.getByRole('button', { name: /Buat lingkungan baru/i }))
    await user.type(screen.getByPlaceholderText('RW 05 Griya Soreang'), 'RW Uji')
    await user.click(screen.getByRole('button', { name: /Lanjut/i }))

    await waitFor(() => expect(pwInput()).toBeTruthy())
    expect(pwInput().type).toBe('password')
    expect(document.body.textContent).toContain('Minimal 6 karakter')

    await user.type(pwInput(), 'rahasia123')
    await user.click(toggle())
    expect(pwInput().type).toBe('text')
    expect(pwInput().value).toBe('rahasia123')
  })
})
