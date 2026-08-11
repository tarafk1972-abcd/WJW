/**
 * Halaman Langganan (#/app/billing).
 *
 * Aturan yang dijaga di sini:
 *   1. Satu-satunya metode pembayaran adalah QRIS ShopeePay.
 *   2. Nomor referensi ditentukan sistem — tidak ada kolom isian
 *      untuk mengetiknya, baik saat memakai server maupun mode lokal.
 *   3. Tidak ada permintaan "bukti transfer".
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import {
  PAYMENT_METHOD,
  invalidateCache,
  loadDB,
  register,
  submitPayment,
} from '../lib/db'
import { DICTS } from '../lib/i18n'

vi.mock('../ui/MapView', () => ({ MapView: () => <div />, pinIcon: () => null }))

function makeAdmin() {
  const f = register({
    name: 'Budi',
    phone: '0811000001',
    email: 'b@x.id',
    password: 'secret1',
    house: 'C12',
    language: 'id',
    mode: 'create',
    communityName: 'RW 05 Test',
  })
  if (!f.ok) throw new Error('setup gagal')
  return f
}

async function openBilling() {
  window.location.hash = '#/app/billing'
  render(<App />)
  await waitFor(() => expect(document.body.textContent).toContain('Langganan'))
}

describe('halaman langganan', () => {
  beforeEach(() => {
    localStorage.clear()
    invalidateCache()
    window.location.hash = '#/'
  })

  it('tidak menyediakan kolom untuk mengetik nomor referensi', async () => {
    makeAdmin()
    await openBilling()
    // Satu-satunya isian yang boleh ada: tidak ada sama sekali.
    expect(document.querySelectorAll('input')).toHaveLength(0)
    expect(document.body.textContent).not.toMatch(/bukti transfer/i)
  })

  it('membuat tagihan lokal dengan referensi dari sistem', async () => {
    const user = userEvent.setup()
    const f = makeAdmin()
    await openBilling()

    await user.click(screen.getByRole('button', { name: /Buat tagihan/i }))

    const pay = loadDB().payments.find((p) => p.communityId === f.community.id)
    expect(pay).toBeTruthy()
    expect(pay!.method).toBe(PAYMENT_METHOD)
    expect(pay!.reference).toMatch(/^WJW[A-HJ-NP-Z2-9]{5}$/)

    // Referensinya tampil di layar, dan tetap tanpa kolom isian.
    await waitFor(() => expect(screen.getByText(pay!.reference)).toBeTruthy())
    expect(document.querySelectorAll('input')).toHaveLength(0)
  })

  it('menampilkan kartu QRIS ShopeePay untuk tagihan yang berjalan', async () => {
    const f = makeAdmin()
    const pay = submitPayment(f.community.id, f.member.id, 'monthly')
    await openBilling()

    await waitFor(() => expect(screen.getByText(pay.reference)).toBeTruthy())
    expect(document.body.textContent).toContain('QRIS')
    const img = document.querySelector('img.qris-img') as HTMLImageElement | null
    expect(img).toBeTruthy()
    expect(img!.getAttribute('src')).toBe('/qris.png')
  })

  it('tidak menawarkan paket baru selama masih ada tagihan berjalan', async () => {
    const f = makeAdmin()
    submitPayment(f.community.id, f.member.id, 'yearly')
    await openBilling()

    await waitFor(() => expect(document.body.textContent).toContain('QRIS'))
    expect(screen.queryByRole('button', { name: /Buat tagihan/i })).toBeNull()
  })

  it('setiap tagihan memperoleh nomor referensi yang berbeda', () => {
    const f = makeAdmin()
    const refs = new Set(
      Array.from({ length: 30 }, () =>
        submitPayment(f.community.id, f.member.id, 'monthly').reference,
      ),
    )
    expect(refs.size).toBe(30)
  })
})

describe('kamus bahasa', () => {
  it('tidak lagi menyebut bukti transfer di bahasa mana pun', () => {
    for (const [lang, dict] of Object.entries(DICTS)) {
      for (const [key, value] of Object.entries(dict)) {
        expect(
          /bukti transfer|transfer proof/i.test(value),
          `${lang}.${key}`,
        ).toBe(false)
      }
    }
  })

  it('menyediakan semua kunci pembayaran di ketiga bahasa', () => {
    const keys = [
      'qrisShopee',
      'refFixed',
      'refWhy',
      'copyRef',
      'copyFailed',
      'localBillNote',
      'billCreatedLocal',
    ] as const
    for (const [lang, dict] of Object.entries(DICTS)) {
      for (const k of keys) {
        expect(typeof dict[k], `${lang}.${k}`).toBe('string')
        expect(dict[k].length, `${lang}.${k}`).toBeGreaterThan(0)
      }
    }
  })
})

/**
 * Regresi: penulisan lokal dilakukan dengan mengubah isi array
 * (`db.payments.unshift(...)`), sehingga identitas arraynya tetap sama.
 * Layar memakai `useMemo(..., [db.payments])`, jadi tanpa identitas baru
 * data yang baru ditulis tidak pernah muncul sampai halaman dimuat ulang.
 */
describe('perubahan lokal terlihat oleh useMemo', () => {
  beforeEach(() => {
    localStorage.clear()
    invalidateCache()
  })

  it('mengganti identitas array koleksi setiap kali menyimpan', () => {
    const f = makeAdmin()
    const before = loadDB().payments
    const countBefore = before.length
    submitPayment(f.community.id, f.member.id, 'monthly')
    const after = loadDB().payments
    // Identitas array harus baru, kalau tidak useMemo tidak menghitung ulang.
    expect(after).not.toBe(before)
    expect(after.length).toBe(countBefore + 1)
  })
})
