/**
 * Penanda versi yang terlihat di layar.
 *
 * Kemarin dua jam terbuang untuk menebak-nebak: apakah yang berjalan di
 * peramban itu kode terbaru atau salinan lama? Tidak ada satu pun cara
 * memastikannya dari layar. Pertanyaan itu harus bisa dijawab dalam satu
 * pandangan, oleh siapa pun, tanpa DevTools.
 *
 * Karena itu waktu build dicetak di halaman depan. Bila angka itu tidak
 * berubah setelah aplikasi dijalankan ulang, berarti yang tampil memang
 * bukan versi baru — dan penyebabnya dicari di situ, bukan di kode fitur.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BUILD_STAMP } from '../lib/meta'

vi.mock('../ui/MapView', () => ({ MapView: () => <div />, pinIcon: () => null }))

describe('penanda versi', () => {
  it('punya nilai yang tidak kosong', () => {
    // Saat build sungguhan berisi waktu ("18 Agt 18.52"); di lingkungan
    // tes tanpa `define` ia jatuh ke 'dev'. Keduanya sah — yang tidak
    // boleh adalah kosong atau undefined, karena itu berarti penandanya
    // hilang diam-diam dan tidak bisa lagi dipercaya.
    expect(BUILD_STAMP).toBeTruthy()
    expect(BUILD_STAMP.trim().length).toBeGreaterThanOrEqual(3)
  })

  it('tampil di halaman depan agar bisa dicocokkan tanpa DevTools', async () => {
    const { default: App } = await import('../App')
    window.location.hash = '#/'
    render(<App />)
    expect(await screen.findByText(new RegExp(BUILD_STAMP))).toBeTruthy()
  })
})
