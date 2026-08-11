/**
 * Pengaturan yang bisa diubah dari dalam aplikasi.
 *
 * Gambar QRIS dulu harus ditaruh manual sebagai `public/qris.png`. Itu
 * menyulitkan: pemilik aplikasi belum tentu punya akses ke berkas server,
 * dan berkasnya hilang setiap kali aplikasi dibangun ulang atau dipindah.
 * Sekarang gambarnya bisa diunggah superadmin lewat Konsol dan disimpan
 * di basis data, sehingga ikut terbawa bersama data lain.
 */
import { db, now } from './db.js'

/** Batas ukuran gambar QRIS. Sebuah QR wajar jauh di bawah ini. */
export const QRIS_MAX_BYTES = 1_000_000

/** Jenis berkas yang diterima untuk gambar QRIS. */
export const QRIS_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const

export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value, at) VALUES (?,?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, at=excluded.at`,
  ).run(key, value, now())
}

export function clearSetting(key: string): void {
  db.prepare('DELETE FROM settings WHERE key=?').run(key)
}

/* ---------------- gambar QRIS ---------------- */

const QRIS_KEY = 'qris.image'

export interface QrisImage {
  mime: string
  /** Isi berkas dalam base64. */
  data: string
}

export function getQrisImage(): QrisImage | null {
  const raw = getSetting(QRIS_KEY)
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as QrisImage
    return v.mime && v.data ? v : null
  } catch {
    return null
  }
}

export function setQrisImage(mime: string, data: string): void {
  setSetting(QRIS_KEY, JSON.stringify({ mime, data }))
}

export function clearQrisImage(): void {
  clearSetting(QRIS_KEY)
}

/**
 * URL gambar QRIS yang berlaku saat ini.
 *
 * Yang diunggah lewat aplikasi menang; bila belum ada, dipakai nilai dari
 * .env (`WJW_QRIS_IMAGE_URL`, bawaan `/qris.png`) supaya pemasangan lama
 * tetap berjalan.
 *
 * Ditambahi penanda waktu agar browser dan klien email tidak menampilkan
 * gambar lama setelah QRIS diganti.
 */
export function qrisImagePath(fallback: string): string {
  const row = db.prepare('SELECT at FROM settings WHERE key=?').get(QRIS_KEY) as
    | { at: number }
    | undefined
  return row ? `/api/qris.png?v=${row.at}` : fallback
}

/* ---------------- nama & nomor pemilik QRIS ---------------- */

/**
 * Nama dan nomor pemilik akun QRIS.
 *
 * Sama seperti gambarnya, ini dulu hanya bisa diisi lewat `.env` di
 * server. Kini bisa diubah superadmin dari Konsol; nilai di .env tetap
 * dipakai sebagai cadangan agar pemasangan lama tidak berubah perilaku.
 */
export function qrisName(fallback: string): string {
  return getSetting('qris.name') ?? fallback
}

export function qrisPhone(fallback: string): string {
  return getSetting('qris.phone') ?? fallback
}

export function setQrisOwner(name: string, phone: string): void {
  setSetting('qris.name', name)
  setSetting('qris.phone', phone)
}
