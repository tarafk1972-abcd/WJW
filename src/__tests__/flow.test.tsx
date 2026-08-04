import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { SUPERADMIN_EMAIL, invalidateCache, loadDB } from '../lib/db'

// Leaflet needs a real layout engine; stub the map for DOM tests.
vi.mock('../ui/MapView', () => ({
  MapView: () => <div data-testid="map" />,
  pinIcon: () => null,
}))

function resetAll() {
  localStorage.clear()
  invalidateCache()
  window.dispatchEvent(new CustomEvent('wjw:db'))
}

async function registerFirstResident(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Daftar Sekarang/i }))
  // step 1: language (Indonesian is preselected)
  await user.click(screen.getByRole('button', { name: /Lanjut/i }))
  // step 2: choose how to join → create a new neighbourhood
  await user.click(screen.getByRole('button', { name: /Buat lingkungan baru/i }))
  // step 3: community details
  await user.type(
    screen.getByPlaceholderText('RW 05 Griya Soreang'),
    'RW 05 Griya Soreang',
  )
  expect(screen.getByText(/Anda warga pertama/i)).toBeTruthy()
  await user.click(screen.getByRole('button', { name: /Lanjut/i }))
  // step 4: profile
  await user.type(screen.getByPlaceholderText('Budi Santoso'), 'Budi Santoso')
  await user.type(screen.getByPlaceholderText('0812xxxxxxx'), '081234567890')
  await user.type(screen.getByPlaceholderText('nama@email.com'), 'budi@mail.com')
  await user.type(screen.getByPlaceholderText('••••••'), 'rahasia123')
  await user.type(screen.getByPlaceholderText('Blok C No. 12'), 'Blok C No. 12')
  await user.click(screen.getByRole('button', { name: /Buat lingkungan baru/i }))
}

describe('Warga Jaga Warga', () => {
  beforeEach(() => {
    resetAll()
    window.location.hash = '#/'
  })

  it('defaults to Indonesian on the landing screen', () => {
    render(<App />)
    expect(screen.getAllByText('Warga Jaga Warga').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /Daftar Sekarang/i })).toBeTruthy()
    expect(screen.getByText(/Warga pertama yang mendaftar/i)).toBeTruthy()
  })

  it('switches the landing language to English', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /English/i }))
    expect(screen.getByRole('button', { name: /Register now/i })).toBeTruthy()
  })

  it('makes the first resident an Admin and greets them by name', async () => {
    const user = userEvent.setup()
    render(<App />)
    await registerFirstResident(user)

    await waitFor(() => expect(window.location.hash).toBe('#/app'))
    // /app is now the one-screen panic view; the greeting lives on the feed tab
    expect(await screen.findByRole('button', { name: 'DARURAT' })).toBeTruthy()
    await user.click(screen.getByRole('link', { name: /Beranda/i }))
    expect(await screen.findByText(/Apa kabar hari ini, Budi\?/i)).toBeTruthy()

    const db = loadDB()
    const budi = db.members.find((m) => m.email === 'budi@mail.com')!
    expect(budi.role).toBe('admin')
    expect(budi.status).toBe('active')
    expect(db.communities[0].name).toBe('RW 05 Griya Soreang')
    // 14-day trial started
    const days = Math.round((db.communities[0].trialEndsAt - Date.now()) / 86400000)
    expect(days).toBe(14)
  })

  it('replaces the register button with a greeting once the device is approved', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<App />)
    await registerFirstResident(user)
    await waitFor(() => expect(window.location.hash).toBe('#/app'))
    unmount()

    window.location.hash = '#/'
    render(<App />)
    expect(screen.queryByRole('button', { name: /Daftar Sekarang/i })).toBeNull()
    expect(screen.getByText(/Apa kabar hari ini, Budi\?/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Masuk ke aplikasi/i })).toBeTruthy()
  })

  it('queues a second resident for approval and lets the admin accept them as Satpam', async () => {
    const user = userEvent.setup()
    // seed admin + community directly for speed
    const { unmount } = render(<App />)
    await registerFirstResident(user)
    await waitFor(() => expect(window.location.hash).toBe('#/app'))
    unmount()

    // second resident registers on the same "device" but different identity
    localStorage.removeItem('wjw.session.v1')
    localStorage.setItem('wjw.device.v1', 'dev_second')
    window.location.hash = '#/register'
    const r2 = render(<App />)
    await user.click(screen.getByRole('button', { name: /Lanjut/i }))
    // choose "search for a neighbourhood", pick the one Budi created
    await user.click(screen.getByRole('button', { name: /Cari lingkungan/i }))
    await user.click(await screen.findByText('RW 05 Griya Soreang'))
    await user.click(screen.getByRole('button', { name: /Ajukan permintaan gabung/i }))
    await user.type(screen.getByPlaceholderText('Budi Santoso'), 'Siti Aminah')
    await user.type(screen.getByPlaceholderText('0812xxxxxxx'), '081298765432')
    await user.type(screen.getByPlaceholderText('nama@email.com'), 'siti@mail.com')
    await user.type(screen.getByPlaceholderText('••••••'), 'rahasia123')
    await user.type(screen.getByPlaceholderText('Blok C No. 12'), 'Blok A No. 3')
    await user.click(screen.getByRole('button', { name: /Ajukan permintaan gabung/i }))

    await waitFor(() => expect(window.location.hash).toBe('#/pending'))
    expect(
      screen.getAllByText(/Menunggu persetujuan admin/i).length,
    ).toBeGreaterThan(0)
    const siti = loadDB().members.find((m) => m.email === 'siti@mail.com')!
    expect(siti.status).toBe('pending')
    expect(siti.role).toBe('warga')
    r2.unmount()

    // admin logs back in and approves her as Satpam
    localStorage.setItem('wjw.device.v1', 'dev_first')
    window.location.hash = '#/login'
    render(<App />)
    await user.type(screen.getByPlaceholderText('nama@email.com'), 'budi@mail.com')
    await user.type(screen.getByPlaceholderText('••••••'), 'rahasia123')
    await user.click(screen.getByRole('button', { name: /^Masuk$/i }))
    await waitFor(() => expect(window.location.hash).toBe('#/app'))

    await user.click(screen.getByRole('link', { name: /Admin/i }))
    await waitFor(() => expect(screen.getByText('Siti Aminah')).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /Konfirmasi/i }))

    const sheet = await screen.findByRole('dialog')
    await user.click(within(sheet).getByRole('button', { name: /^Satpam$/i }))
    await user.click(within(sheet).getByRole('button', { name: /Terima · Satpam/i }))

    await waitFor(() => {
      const updated = loadDB().members.find((m) => m.email === 'siti@mail.com')!
      expect(updated.status).toBe('active')
      expect(updated.role).toBe('satpam')
    })
  })

  it('routes the superadmin email to the console', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/login'
    render(<App />)
    await user.type(screen.getByPlaceholderText('nama@email.com'), SUPERADMIN_EMAIL)
    await user.type(screen.getByPlaceholderText('••••••'), 'superadmin')
    await user.click(screen.getByRole('button', { name: /^Masuk$/i }))
    await waitFor(() => expect(window.location.hash).toBe('#/console'))
    expect(await screen.findByText(/Konsol Superadmin/i)).toBeTruthy()
  })
})
