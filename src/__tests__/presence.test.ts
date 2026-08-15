/**
 * Lokasi hanya dikirim saat ada darurat.
 *
 * Sebelumnya posisi dikirim berkala selama aplikasi terbuka, sehingga
 * server perlahan mengumpulkan keberadaan warga sepanjang hari. Sekarang
 * GPS hanya disentuh ketika benar-benar ada peringatan berlangsung.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  disablePresence,
  enablePresence,
  presenceDisabled,
  resetPresenceState,
  shareLocationForEmergency,
} from '../lib/presence'
import * as capture from '../lib/capture'
import { api } from '../lib/api'

const TITIK = { lat: -6.9829, lng: 107.5197, accuracy: 8 }

describe('shareLocationForEmergency', () => {
  beforeEach(() => {
    localStorage.clear()
    resetPresenceState()
    vi.restoreAllMocks()
  })

  it('mengambil dan mengirim satu titik saat dipanggil', async () => {
    const fix = vi.spyOn(capture, 'getFix').mockResolvedValue(TITIK)
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)

    expect(await shareLocationForEmergency()).toBe(true)
    expect(fix).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith('/me/location', {
      lat: TITIK.lat,
      lng: TITIK.lng,
      accuracy: TITIK.accuracy,
    })
  })

  it('tidak menyentuh GPS bila warga mematikannya', async () => {
    const fix = vi.spyOn(capture, 'getFix').mockResolvedValue(TITIK)
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    vi.spyOn(api, 'del').mockResolvedValue({} as never)

    await disablePresence()
    expect(presenceDisabled()).toBe(true)

    expect(await shareLocationForEmergency()).toBe(false)
    // Yang terpenting: GPS tidak dibuka sama sekali.
    expect(fix).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })

  it('menghapus titik di server ketika dimatikan', async () => {
    const del = vi.spyOn(api, 'del').mockResolvedValue({} as never)
    await disablePresence()
    expect(del).toHaveBeenCalledWith('/me/location')
  })

  it('bisa dinyalakan kembali', async () => {
    vi.spyOn(api, 'del').mockResolvedValue({} as never)
    vi.spyOn(capture, 'getFix').mockResolvedValue(TITIK)
    vi.spyOn(api, 'post').mockResolvedValue({} as never)

    await disablePresence()
    enablePresence()
    expect(presenceDisabled()).toBe(false)
    expect(await shareLocationForEmergency()).toBe(true)
  })

  it('tidak mengirim berulang untuk kejadian yang sama', async () => {
    const fix = vi.spyOn(capture, 'getFix').mockResolvedValue(TITIK)
    vi.spyOn(api, 'post').mockResolvedValue({} as never)

    const t0 = Date.now()
    expect(await shareLocationForEmergency(t0)).toBe(true)
    // Polling berjalan tiap 8 detik; jangan ikut mengirim tiap kali.
    expect(await shareLocationForEmergency(t0 + 5_000)).toBe(false)
    expect(fix).toHaveBeenCalledTimes(1)

    // Kejadian berikutnya, jauh setelahnya, tetap dilayani.
    expect(await shareLocationForEmergency(t0 + 120_000)).toBe(true)
  })

  it('tidak mengirim apa pun bila GPS gagal', async () => {
    vi.spyOn(capture, 'getFix').mockResolvedValue(null)
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)

    expect(await shareLocationForEmergency()).toBe(false)
    expect(post).not.toHaveBeenCalled()
  })

  it('tidak melempar error bila server sedang bermasalah', async () => {
    vi.spyOn(capture, 'getFix').mockResolvedValue(TITIK)
    vi.spyOn(api, 'post').mockRejectedValue(new Error('offline'))

    await expect(shareLocationForEmergency()).resolves.toBe(false)
  })
})

describe('tidak ada pengiriman berkala', () => {
  it('modul presence tidak lagi memantau lokasi terus-menerus', async () => {
    const { readFileSync } = await import('node:fs')
    const kode = readFileSync('src/lib/presence.ts', 'utf8')
    // watchPosition/watchLocation berarti GPS menyala sepanjang aplikasi
    // terbuka — persis yang harus dihindari.
    expect(kode).not.toContain('watchLocation')
    expect(kode).not.toContain('watchPosition')
    expect(kode).not.toContain('setInterval')
  })

  it('warga biasa tidak dipantau GPS oleh DutyAndPresence', async () => {
    const { readFileSync } = await import('node:fs')
    const kode = readFileSync('src/ui/DutyAndPresence.tsx', 'utf8')
    // Pemantauan terus-menerus hanya untuk satpam, demi status bertugas.
    expect(kode).toContain('!isSatpam) return')
    // Pengiriman posisi digantung pada tanda darurat dari server.
    expect(kode).toContain('locationWanted')
  })
})
