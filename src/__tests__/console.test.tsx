/**
 * Konsol superadmin.
 *
 * Tanpa server, Konsol hanya melihat data di perangkat ini. Pada
 * perangkat baru itu berarti nol di semua kolom — yang mudah disalahbaca
 * sebagai "belum ada lingkungan" padahal artinya "tidak terhubung".
 */
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { setToken } from '../lib/api'
import { invalidateCache, loadDB, setSession } from '../lib/db'

vi.mock('../ui/MapView', () => ({ MapView: () => <div />, pinIcon: () => null }))

function signInLocalSuperadmin() {
  const db = loadDB()
  const sa = db.members.find((m) => m.role === 'superadmin')
  if (!sa) throw new Error('superadmin tidak ada di data lokal')
  setSession(sa.id)
}

describe('konsol tanpa server', () => {
  beforeEach(() => {
    localStorage.clear()
    invalidateCache()
    setToken(null)
    window.location.hash = '#/'
  })

  it('menjelaskan bahwa angkanya bukan data sebenarnya', async () => {
    signInLocalSuperadmin()
    window.location.hash = '#/console'
    render(<App />)
    await new Promise((r) => setTimeout(r, 100))

    const txt = document.body.textContent ?? ''
    // Angka nol memang benar untuk perangkat kosong…
    expect(txt).toContain('Lingkungan')
    // …tetapi harus disertai sebabnya, bukan dibiarkan menyesatkan.
    expect(txt).toContain('Tidak terhubung ke server')
    expect(txt).toContain('npm run server')
  })
})

/**
 * Terhubung ke server, tetapi basis datanya masih kosong.
 *
 * Ini bentuk yang paling membingungkan: tidak ada peringatan luring, dan
 * semua kolom nol — tampak seperti aplikasi rusak, padahal itu keadaan
 * wajar pemasangan baru.
 */
describe('konsol terhubung tetapi kosong', () => {
  beforeEach(() => {
    localStorage.clear()
    invalidateCache()
    setToken(null)
    window.location.hash = '#/'
  })

  it('menjelaskan bahwa server memang belum punya lingkungan', async () => {
    // Ada token → mode server; /state menjawab kosong.
    setToken('token-uji')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          me: {
            id: 'superadmin',
            name: 'Superadmin',
            email: 'tarafk1972@gmail.com',
            role: 'superadmin',
            status: 'active',
            communityId: null,
            language: 'id',
          },
          communities: [],
          members: [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    setSession('superadmin')

    window.location.hash = '#/console'
    render(<App />)
    await waitFor(() =>
      expect(document.body.textContent).toContain('Konsol Superadmin'),
    )

    const txt = document.body.textContent ?? ''
    // Bukan masalah sambungan, jadi peringatan luring tidak boleh muncul…
    expect(txt).not.toContain('Tidak terhubung ke server')
    // …tetapi sebab nol-nya tetap harus dijelaskan.
    await waitFor(() => expect(document.body.textContent).toContain('belum ada lingkungan'))
  })
})
