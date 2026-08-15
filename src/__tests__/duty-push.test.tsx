/**
 * Notifikasi darurat bagi satpam.
 *
 * Bagi satpam ini bukan pilihan melainkan bagian dari tugas: selama ia
 * berada di dalam area, notifikasi menyala sendiri. Ajakan biasa — yang
 * punya tombol "tutup" — justru cara termudah kehilangan peringatan, jadi
 * ia tidak boleh muncul pada perangkat satpam.
 */
import { readFileSync } from 'node:fs'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import {
  SILENCE_MS,
  onDutyInArea,
  resumeDutyPush,
  silenceWhileResponding,
  silencedFor,
} from '../lib/dutyPush'
import { invalidateCache, loadDB, register, saveDB } from '../lib/db'
import type { Community, Member } from '../lib/types'

vi.mock('../ui/MapView', () => ({ MapView: () => <div />, pinIcon: () => null }))

const KOTAK = [
  { lat: 0, lng: 0 },
  { lat: 0, lng: 2 },
  { lat: 2, lng: 2 },
  { lat: 2, lng: 0 },
]

const satpam = { role: 'satpam', status: 'active' } as Member
const komunitas = { area: KOTAK } as Community

describe('onDutyInArea', () => {
  it('benar untuk satpam aktif di dalam area', () => {
    expect(onDutyInArea(satpam, komunitas, { lat: 1, lng: 1 })).toBe(true)
  })

  it('salah bila satpam berada di luar area', () => {
    expect(onDutyInArea(satpam, komunitas, { lat: 9, lng: 9 })).toBe(false)
  })

  it('salah untuk peran selain satpam, walau di dalam area', () => {
    const warga = { role: 'warga', status: 'active' } as Member
    expect(onDutyInArea(warga, komunitas, { lat: 1, lng: 1 })).toBe(false)
    const admin = { role: 'admin', status: 'active' } as Member
    expect(onDutyInArea(admin, komunitas, { lat: 1, lng: 1 })).toBe(false)
  })

  it('salah bila satpam belum disetujui admin', () => {
    const menunggu = { role: 'satpam', status: 'pending' } as Member
    expect(onDutyInArea(menunggu, komunitas, { lat: 1, lng: 1 })).toBe(false)
  })

  it('salah bila admin belum menggambar area — jangan menebak', () => {
    const tanpaArea = { area: [] } as unknown as Community
    expect(onDutyInArea(satpam, tanpaArea, { lat: 1, lng: 1 })).toBe(false)
  })

  it('salah bila posisi belum diketahui', () => {
    expect(onDutyInArea(satpam, komunitas, null)).toBe(false)
  })
})

describe('peredaman saat merespons', () => {
  beforeEach(() => localStorage.clear())

  it('tidak diredam secara bawaan', () => {
    expect(silencedFor()).toBe(0)
  })

  it('meredam untuk jangka terbatas, lalu pulih sendiri', () => {
    const t0 = Date.now()
    silenceWhileResponding(t0)
    expect(silencedFor(t0 + 60_000)).toBeGreaterThan(0)
    // Setelah jangkanya lewat, notifikasi menyala lagi tanpa diminta.
    expect(silencedFor(t0 + SILENCE_MS + 1)).toBe(0)
  })

  it('bisa dibatalkan lebih awal', () => {
    silenceWhileResponding()
    resumeDutyPush()
    expect(silencedFor()).toBe(0)
  })
})

describe('tampilan pada perangkat', () => {
  beforeEach(() => {
    localStorage.clear()
    invalidateCache()
    window.location.hash = '#/'
  })

  /** Daftarkan admin, lalu jadikan perannya sesuai kebutuhan tes. */
  function masukSebagai(role: Member['role']) {
    const f = register({
      name: 'Joko',
      phone: '0811000009',
      email: 'joko@x.id',
      password: 'secret1',
      house: 'Pos 1',
      language: 'id',
      mode: 'create',
      communityName: 'RW 05 Griya Soreang',
    })
    if (!f.ok) throw new Error('setup gagal')
    const db = loadDB()
    db.members.find((m) => m.id === f.member.id)!.role = role
    saveDB(db)
    return f
  }

  it('tidak menawarkan "Aktifkan notifikasi darurat" kepada satpam', async () => {
    masukSebagai('satpam')
    window.location.hash = '#/app'
    render(<App />)
    await waitFor(() => expect(document.body.textContent).toBeTruthy())

    // Ajakan opsional itu tidak boleh ada di perangkat satpam.
    expect(screen.queryByText('Aktifkan notifikasi darurat')).toBeNull()
    expect(
      screen.queryByText('Agar peringatan tetap berbunyi walau aplikasi tertutup.'),
    ).toBeNull()
  })

  it('membedakan satpam dari peran lain, bukan menyembunyikan dari semua', () => {
    /*
     * Tes di atas mudah lulus karena alasan yang keliru: di jsdom push
     * memang tidak didukung, jadi ajakan itu tidak pernah muncul untuk
     * siapa pun. Yang benar-benar perlu dijamin adalah keputusannya:
     * satpam dikecualikan berdasarkan perannya.
     */
    const kode = readFileSync('src/ui/PushPrompt.tsx', 'utf8')
    expect(kode).toContain("me?.role === 'satpam'")
    expect(kode).toContain('if (!roleKnown || isSatpam) return null')
  })
})

/**
 * Bagian yang sempat terlewat: keluar area harus benar-benar MEMATIKAN
 * notifikasi, bukan sekadar berhenti menyalakannya. Tanpa itu, satpam
 * yang pulang tetap dibunyikan peringatan sepanjang malam.
 */
describe('notifikasi mengikuti keberadaan di area', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('mencabut langganan ketika satpam berada di luar area', async () => {
    const { ensureDutyPush } = await import('../lib/dutyPush')
    const pc = await import('../lib/pushClient')
    vi.spyOn(pc, 'pushSupported').mockReturnValue(true)
    const off = vi.spyOn(pc, 'disablePush').mockResolvedValue()

    expect(await ensureDutyPush(false)).toBe('off')
    expect(off).toHaveBeenCalled()
  })

  it('mencabut langganan selama diredam karena merespons', async () => {
    const { ensureDutyPush, silenceWhileResponding } = await import('../lib/dutyPush')
    const pc = await import('../lib/pushClient')
    vi.spyOn(pc, 'pushSupported').mockReturnValue(true)
    const off = vi.spyOn(pc, 'disablePush').mockResolvedValue()

    silenceWhileResponding()
    expect(await ensureDutyPush(true)).toBe('off')
    expect(off).toHaveBeenCalled()
  })

  it('menyalakan tanpa bertanya ketika izin sudah ada dan berada di area', async () => {
    const { ensureDutyPush } = await import('../lib/dutyPush')
    const pc = await import('../lib/pushClient')
    vi.spyOn(pc, 'pushSupported').mockReturnValue(true)
    vi.spyOn(pc, 'permission').mockReturnValue('granted')
    const on = vi.spyOn(pc, 'enablePush').mockResolvedValue(true)

    expect(await ensureDutyPush(true)).toBe('on')
    expect(on).toHaveBeenCalled()
  })
})

/**
 * Ajakan opsional tidak boleh berkedip sebelum peran diketahui: sekali
 * satpam menekan "tutup", pilihan itu menetap di perangkatnya.
 */
describe('PushPrompt menunggu peran diketahui', () => {
  it('tidak menampilkan apa pun selama me masih null', async () => {
    const { readFileSync } = await import('node:fs')
    const kode = readFileSync('src/ui/PushPrompt.tsx', 'utf8')
    expect(kode).toContain('const roleKnown = !!me')
    expect(kode).toContain('if (!roleKnown || isSatpam) return null')
  })
})
