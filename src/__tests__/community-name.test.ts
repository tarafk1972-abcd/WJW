/**
 * Nama lingkungan berdiri sendiri, bukan nama pendaftarnya.
 *
 * Judul di bagian atas aplikasi memakai nama lingkungan. Bila kosong,
 * satu-satunya nama yang terlihat di situ tinggal nama admin — seolah
 * lingkungan itu bernama seperti orangnya. Pengurus berganti, sedangkan
 * lingkungannya tetap.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { invalidateCache, loadDB, register } from '../lib/db'

const dasar = {
  name: 'Budi Santoso',
  phone: '0811000001',
  email: 'budi@x.id',
  password: 'secret1',
  house: 'C12',
  language: 'id' as const,
  mode: 'create' as const,
}

describe('nama lingkungan saat membuat klaster', () => {
  beforeEach(() => {
    localStorage.clear()
    invalidateCache()
  })

  it('menolak nama kosong', () => {
    const r = register({ ...dasar, communityName: '' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('errCommunityName')
    expect(loadDB().communities).toHaveLength(0)
  })

  it('menolak nama yang hanya berisi spasi', () => {
    const r = register({ ...dasar, communityName: '   ' })
    expect(r.ok).toBe(false)
    // Tidak boleh ada lingkungan tanpa nama yang tertinggal di basis data.
    expect(loadDB().communities).toHaveLength(0)
  })

  it('menolak nama yang sama persis dengan nama pendaftar', () => {
    const r = register({ ...dasar, communityName: 'Budi Santoso' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('errCommunityNameIsPerson')
  })

  it('menolaknya tanpa memandang besar-kecil huruf dan spasi berlebih', () => {
    const r = register({ ...dasar, communityName: '  budi santoso  ' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('errCommunityNameIsPerson')
  })

  it('menerima nama tempat, dan pendaftarnya tetap menjadi Admin', () => {
    const r = register({ ...dasar, communityName: 'RW 05 Griya Soreang' })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    // Aturan lama tetap berlaku: pendaftar pertama otomatis Admin.
    expect(r.firstAdmin).toBe(true)
    expect(r.member.role).toBe('admin')
    expect(r.member.status).toBe('active')

    // Nama lingkungan berdiri sendiri, terpisah dari nama orangnya.
    expect(r.community.name).toBe('RW 05 Griya Soreang')
    expect(r.community.name).not.toBe(r.member.name)
  })

  it('membiarkan nama tempat yang kebetulan memuat nama orang', () => {
    // "Griya Budi Santoso" adalah nama tempat yang sah.
    const r = register({ ...dasar, communityName: 'Griya Budi Santoso' })
    expect(r.ok).toBe(true)
  })
})
