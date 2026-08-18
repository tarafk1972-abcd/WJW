/**
 * Skrip `npm run dev:https` harus menemukan OpenSSL sendiri di Windows.
 *
 * OpenSSL memang ikut terpasang bersama Git for Windows, tetapi hanya
 * terdaftar di PATH milik Git Bash — bukan di Command Prompt. Padahal
 * seluruh panduan proyek ini memakai Command Prompt.
 *
 * Kalau skripnya menyerah begitu `openssl` tidak ada di PATH, pengguna
 * Windows mendapat kegagalan untuk program yang sebenarnya SUDAH ADA di
 * komputernya — hanya di folder yang tidak dicari. Menyuruhnya "pakai
 * Git Bash" memindahkan pekerjaan ke pengguna untuk sesuatu yang bisa
 * diselesaikan sendiri oleh skripnya.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const src = readFileSync('scripts/dev-https.mjs', 'utf8')

describe('mencari OpenSSL', () => {
  it('tidak hanya mengandalkan PATH', () => {
    // Harus ada daftar lokasi cadangan, bukan sekadar memanggil 'openssl'.
    expect(src).toMatch(/Git\\\\usr\\\\bin|Git\/usr\/bin|usr.bin.openssl/i)
  })

  it('mencari di kedua lokasi pemasangan Git yang lazim', () => {
    // Git 64-bit dan 32-bit mendarat di folder yang berbeda; keduanya lazim.
    expect(src).toMatch(/Program Files\\\\Git|Program Files\/Git/)
    expect(src).toMatch(/Program Files \(x86\)/)
  })

  it('masih memakai openssl dari PATH bila memang ada', () => {
    // Di Linux/macOS, dan di Git Bash, PATH sudah benar — jangan diabaikan.
    expect(src).toMatch(/'openssl'/)
  })

  it('menyebut sertifikatnya berlaku untuk alamat LAN', () => {
    // subjectAltName wajib memuat IP-nya, kalau tidak Chrome menolak
    // sebelum sempat menawarkan "Lanjutkan".
    expect(src).toMatch(/subjectAltName/)
    expect(src).toMatch(/IP:\$\{ip\}/)
  })
})
