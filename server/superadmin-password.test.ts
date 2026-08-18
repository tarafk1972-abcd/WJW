/**
 * Sandi superadmin tidak boleh ditimpa diam-diam.
 *
 * `WJW_SUPERADMIN_PASSWORD` adalah jalan pemulihan bila sandi hilang.
 * Tetapi dulu nilainya ditulis ulang pada SETIAP boot, sehingga
 * `npm run reset-password` seolah berhasil lalu dibatalkan tanpa
 * pemberitahuan saat server dinyalakan ulang — dan login gagal tanpa
 * sebab yang terlihat.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as pathJoin } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

let m: typeof import('./db.js')

/** Baca ulang hash sandi superadmin dari basis data. */
function hash(): string {
  return (
    m.db.prepare("SELECT password_hash h FROM members WHERE role='superadmin'").get() as {
      h: string
    }
  ).h
}

beforeAll(async () => {
  process.env.WJW_DB = pathJoin(mkdtempSync(pathJoin(tmpdir(), 'wjw-sap-')), 't.sqlite')
  process.env.WJW_SUPERADMIN_PASSWORD = 'sandi-env-awal'
  m = await import('./db.js')
  m.ensureSuperadmin()
})

describe('sandi superadmin', () => {
  it('memakai nilai .env saat akun pertama dibuat', () => {
    expect(m.verifyPassword('sandi-env-awal', hash())).toBe(true)
  })

  it('mempertahankan hasil reset-password ketika server dinyalakan ulang', () => {
    // Meniru `npm run reset-password`.
    m.db
      .prepare('UPDATE members SET password_hash=? WHERE id=?')
      .run(m.hashPassword('sandi-baru-dari-reset'), 'superadmin')

    // Boot berikutnya, .env TIDAK berubah.
    m.ensureSuperadmin()

    expect(m.verifyPassword('sandi-baru-dari-reset', hash())).toBe(true)
    expect(m.verifyPassword('sandi-env-awal', hash())).toBe(false)
  })

  it('boot berulang tidak mengubah apa pun', () => {
    m.ensureSuperadmin()
    m.ensureSuperadmin()
    expect(m.verifyPassword('sandi-baru-dari-reset', hash())).toBe(true)
  })

  it('tetap memulihkan akses ketika operator mengubah .env', () => {
    process.env.WJW_SUPERADMIN_PASSWORD = 'sandi-env-diubah'
    m.ensureSuperadmin()

    expect(m.verifyPassword('sandi-env-diubah', hash())).toBe(true)
    expect(m.verifyPassword('sandi-baru-dari-reset', hash())).toBe(false)
  })

  it('tidak menyimpan sandi dalam bentuk yang bisa dibaca kembali', () => {
    const row = m.db
      .prepare("SELECT value FROM settings WHERE key='superadmin.envPassword'")
      .get() as { value: string }
    expect(row.value).not.toContain('sandi-env-diubah')
  })
})
