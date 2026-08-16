/**
 * Admin harus bisa menyimpan gambar QRIS ke perangkatnya.
 *
 * Pembayaran dilakukan di aplikasi ShopeePay, yang memindai QR dari
 * galeri — bukan dari layar aplikasi ini. Tanpa cara menyimpan, admin
 * hanya bisa menangkap layar, yang ikut memotong pinggiran dan kadang
 * membuat QR gagal terbaca.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProvider } from '../lib/store'
import { ToastProvider } from '../ui/Toast'
import { QrisCard } from '../ui/QrisCard'
import { invalidateCache } from '../lib/db'

const QRIS = {
  name: 'FADLUL KHAIRA',
  phone: '(+62)81****781',
  imageUrl: '/api/qris.png?v=1',
  info: '',
}

function tampilkan() {
  return render(
    <AppProvider>
      <ToastProvider>
        <QrisCard qris={QRIS} reference="WJWAB123" amount={149000} />
      </ToastProvider>
    </AppProvider>,
  )
}

describe('menyimpan gambar QRIS', () => {
  beforeEach(() => {
    localStorage.clear()
    invalidateCache()
    vi.restoreAllMocks()
  })

  it('menyediakan tombol simpan di samping QR', async () => {
    tampilkan()
    expect(await screen.findByRole('button', { name: /Simpan gambar QR/i })).toBeTruthy()
  })

  it('mengunduh gambarnya sebagai berkas, bukan membuka tab baru', async () => {
    const user = userEvent.setup()

    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      blob: async () => blob,
    } as unknown as Response)

    const buatUrl = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:uji')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    // Tangkap elemen <a> yang diklik untuk mengunduh.
    let diunduh: { download: string | null; href: string | null } | null = null
    const klikAsli = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      diunduh = {
        download: this.getAttribute('download'),
        href: this.getAttribute('href'),
      }
    }

    try {
      tampilkan()
      await user.click(await screen.findByRole('button', { name: /Simpan gambar QR/i }))

      await waitFor(() => expect(diunduh).not.toBeNull())
      // Atribut download inilah yang membuatnya tersimpan, bukan terbuka.
      expect(diunduh!.download).toBe('qris-wjw.png')
      expect(diunduh!.href).toBe('blob:uji')
      expect(buatUrl).toHaveBeenCalled()
    } finally {
      HTMLAnchorElement.prototype.click = klikAsli
    }
  })

  it('memberi tahu bila gambar gagal diambil, bukan diam saja', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false } as unknown as Response)

    tampilkan()
    await user.click(await screen.findByRole('button', { name: /Simpan gambar QR/i }))

    await waitFor(() =>
      expect(document.body.textContent).toContain('Gagal menyimpan gambar'),
    )
  })

  it('tidak menawarkan simpan bila QRIS belum dipasang', async () => {
    render(
      <AppProvider>
        <ToastProvider>
          <QrisCard
            qris={{ ...QRIS, imageUrl: '' }}
            reference="WJWAB123"
            amount={149000}
          />
        </ToastProvider>
      </AppProvider>,
    )
    await waitFor(() => expect(document.body.textContent).toBeTruthy())
    expect(screen.queryByRole('button', { name: /Simpan gambar QR/i })).toBeNull()
  })
})
