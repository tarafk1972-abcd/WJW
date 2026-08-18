/**
 * Layar ronda harus menjelaskan kenapa lokasi tidak bisa diambil.
 *
 * Satpam membuka aplikasi lewat Wi-Fi (http://192.168.1.5:5173) lalu
 * berdiri tepat di titik ronda, dan tombolnya tetap tidak mau merekam.
 * Yang tertulis di layar hanya "lokasi tidak tersedia" — kalimat yang
 * menyuruhnya menunggu sinyal yang tidak akan pernah datang, karena
 * peramban memang memblokir GPS di alamat http biasa.
 *
 * Untuk satpam yang sedang berkeliling malam-malam, keterangan yang
 * salah lebih buruk daripada tidak ada keterangan: ia akan berdiri
 * menunggu, mengira dirinya atau HP-nya yang bermasalah.
 */
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { invalidateCache, register, setSession, saveDB, loadDB } from '../lib/db'

vi.mock('../ui/MapView', () => ({ MapView: () => <div />, pinIcon: () => null }))

/** Halaman dibuka lewat http:// di alamat LAN — bukan konteks aman. */
function alamatTidakAman() {
  Object.defineProperty(globalThis, 'isSecureContext', {
    value: false,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(navigator, 'geolocation', {
    value: {
      getCurrentPosition: (_ok: PositionCallback, err?: PositionErrorCallback) =>
        err?.({ code: 1, message: 'Only secure origins are allowed' } as
          GeolocationPositionError),
      watchPosition: () => 0,
      clearWatch: () => {},
    },
    configurable: true,
    writable: true,
  })
}

/** Satu satpam dengan satu titik ronda. */
function siapkanSatpam() {
  localStorage.clear()
  invalidateCache()
  const f = register({
    name: 'Pak Satpam',
    phone: '0811222333',
    email: 'satpam@x.id',
    password: 'rahasia1',
    house: 'Pos',
    language: 'id',
    mode: 'create',
    communityName: 'RW Ronda',
  })
  if (!f.ok) throw new Error('setup gagal')

  const db = loadDB()
  const me = db.members.find((m) => m.id === f.member.id)!
  me.role = 'satpam'
  db.checkpoints.push({
    id: 'cp1',
    communityId: f.community.id,
    name: 'Pos Depan',
    lat: f.community.center.lat,
    lng: f.community.center.lng,
    radiusM: 40,
    order: 1,
    createdBy: f.member.id,
    createdAt: Date.now(),
    active: true,
  })
  saveDB(db)
  setSession(f.member.id)
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('ronda di alamat http Wi-Fi', () => {
  it('menyebut alamatnya sebagai sebab, bukan menyuruh menunggu sinyal', async () => {
    alamatTidakAman()
    siapkanSatpam()

    window.location.hash = '#/app/patrol-check'
    render(<App />)

    /*
     * Yang harus terbaca satpam: masalahnya pada ALAMAT, dan ada jalan
     * keluarnya. Bukan "lokasi tidak tersedia" yang menyiratkan tunggu
     * sebentar lagi.
     */
    await waitFor(
      () => expect(document.body.textContent).toMatch(/alamat aman|https/i),
      { timeout: 8000 },
    )
    expect(document.body.textContent).not.toMatch(/^Lokasi tidak tersedia$/)
  }, 30000)

  it('tidak menyalahkan alamat saat halamannya aman', async () => {
    Object.defineProperty(globalThis, 'isSecureContext', {
      value: true,
      configurable: true,
      writable: true,
    })
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition: (ok: PositionCallback) =>
          ok({
            coords: { latitude: -6.98, longitude: 107.52, accuracy: 12 },
          } as GeolocationPosition),
        watchPosition: () => 0,
        clearWatch: () => {},
      },
      configurable: true,
      writable: true,
    })
    siapkanSatpam()

    window.location.hash = '#/app/patrol-check'
    render(<App />)

    await waitFor(() => expect(document.body.textContent).toContain('Pos Depan'), {
      timeout: 8000,
    })
    expect(document.body.textContent).not.toMatch(/alamat aman/i)
  }, 30000)
})
