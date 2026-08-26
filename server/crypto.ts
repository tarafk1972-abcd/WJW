import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * Enkripsi field sensitif di database.
 *
 * Kunci adalah 32 byte yang dikirim lewat secret manager sebagai base64 atau
 * base64url. Format nilai terenkripsi menyimpan IV dan authentication tag
 * bersama ciphertext agar record dapat didekripsi secara mandiri:
 *
 *   enc:v1:<iv>:<tag>:<ciphertext>
 *
 * Nilai JSON lama (tanpa prefix enc:v1) tetap dibaca untuk migrasi mulus,
 * lalu akan terenkripsi saat profil tersebut disimpan lagi.
 */
const PREFIX = 'enc:v1:'

function keyFromEnvironment(): Buffer | null {
  const raw = process.env.WJW_DATA_ENCRYPTION_KEY?.trim()
  if (!raw) return null

  // Buffer menerima alfabet base64url pada Node modern juga. Normalisasi
  // padding agar pesan error di bawah tetap konsisten di semua runtime.
  const padded = raw.replace(/-/g, '+').replace(/_/g, '/')
  const key = Buffer.from(padded, 'base64')
  if (key.length !== 32) {
    throw new Error(
      'WJW_DATA_ENCRYPTION_KEY harus berupa kunci base64/base64url berukuran 32 byte.',
    )
  }
  return key
}

/** Produksi tidak boleh diam-diam menulis data medis dalam teks biasa. */
export function ensureSensitiveEncryptionConfigured(): void {
  const key = keyFromEnvironment()
  if (process.env.NODE_ENV === 'production' && !key) {
    throw new Error(
      'WJW_DATA_ENCRYPTION_KEY wajib di produksi untuk melindungi profil darurat dan snapshot insiden.',
    )
  }
}

export function encryptSensitiveJson(value: unknown): string {
  const plain = JSON.stringify(value)
  const key = keyFromEnvironment()

  // Memudahkan pengembangan dan tes lokal. Server produksi ditolak saat boot
  // bila kunci tidak tersedia (lihat ensureSensitiveEncryptionConfigured).
  if (!key) return plain

  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`
}

export function decryptSensitiveJson<T>(stored: string | null | undefined): T | null {
  if (!stored) return null

  if (!stored.startsWith(PREFIX)) return JSON.parse(stored) as T

  const key = keyFromEnvironment()
  if (!key) {
    throw new Error(
      'Data sensitif terenkripsi ditemukan, tetapi WJW_DATA_ENCRYPTION_KEY tidak tersedia.',
    )
  }

  const parts = stored.split(':')
  if (parts.length !== 5) throw new Error('Format data sensitif terenkripsi tidak valid.')

  const [, , ivText, tagText, dataText] = parts
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
    const plain = Buffer.concat([
      decipher.update(Buffer.from(dataText, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
    return JSON.parse(plain) as T
  } catch {
    // Jangan mengubah data korup menjadi object kosong: itu berisiko membuat
    // responder yakin tidak ada alergi/kondisi medis padahal data gagal dibaca.
    throw new Error('Data sensitif tidak dapat didekripsi dengan aman.')
  }
}
