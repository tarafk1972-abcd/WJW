import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  StorageFullError,
  addAttachment,
  invalidateCache,
  loadDB,
  raiseAlert,
  register,
  saveDB,
  storageBytes,
} from '../lib/db'

function fresh() {
  localStorage.clear()
  invalidateCache()
}

function founder() {
  const r = register({
    name: 'Budi', phone: '0811000001', email: 'b@x.id', password: 'secret1',
    house: 'C12', language: 'id', mode: 'create', communityName: 'RW 05',
  })
  if (!r.ok) throw new Error('setup')
  return r
}

/** Tiru kuota penuh sampai payload turun di bawah `limit` karakter. */
function quotaCap(limit: number) {
  const real = Storage.prototype.setItem
  return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
    this: Storage,
    k: string,
    v: string,
  ) {
    if (k.startsWith('wjw.db') && v.length > limit) {
      const e = new Error('QuotaExceededError')
      e.name = 'QuotaExceededError'
      throw e
    }
    return real.call(this, k, v)
  })
}

describe('ketahanan penyimpanan', () => {
  beforeEach(fresh)

  it('membuang media laporan lama agar peringatan baru tetap tersimpan', () => {
    const f = founder()
    const big = 'data:image/jpeg;base64,' + 'A'.repeat(60_000)

    // laporan lama dengan lampiran besar
    const old = raiseAlert({ member: f.member, category: 'other', at: null })
    old.live = false
    saveDB(loadDB())
    addAttachment(old.id, big, 'photo')
    expect(loadDB().reports.find((r) => r.id === old.id)!.attachments).toHaveLength(1)

    const before = storageBytes()
    expect(before).toBeGreaterThan(60_000)

    // sekarang kuota mengecil: penyimpanan harus mengosongkan media lama
    const spy = quotaCap(40_000)
    expect(() => saveDB(loadDB())).not.toThrow()
    spy.mockRestore()

    expect(loadDB().reports.find((r) => r.id === old.id)!.attachments).toHaveLength(0)
  })

  it('tidak pernah membuang media peringatan yang masih aktif', () => {
    const f = founder()
    const live = raiseAlert({ member: f.member, category: 'medical', at: null })
    addAttachment(live.id, 'data:image/jpeg;base64,' + 'B'.repeat(50_000), 'photo')

    const spy = quotaCap(1_000) // mustahil dipenuhi
    expect(() => saveDB(loadDB())).toThrow(StorageFullError)
    spy.mockRestore()

    // lampiran peringatan aktif tetap utuh
    const after = loadDB().reports.find((r) => r.id === live.id)!
    expect(after.live).toBe(true)
    expect(after.attachments).toHaveLength(1)
  })

  it('melempar StorageFullError, bukan error mentah, saat benar-benar mentok', () => {
    founder()
    const spy = quotaCap(10)
    let err: unknown
    try {
      saveDB(loadDB())
    } catch (e) {
      err = e
    }
    spy.mockRestore()
    expect(err).toBeInstanceOf(StorageFullError)
  })

  it('peringatan darurat tetap tercatat walau lampiran gagal disimpan', () => {
    const f = founder()
    const alert = raiseAlert({ member: f.member, category: 'fire', at: { lat: 1, lng: 1 } })

    const spy = quotaCap(100)
    let attachFailed = false
    try {
      addAttachment(alert.id, 'data:image/jpeg;base64,' + 'C'.repeat(90_000), 'photo')
    } catch {
      attachFailed = true
    }
    spy.mockRestore()

    expect(attachFailed).toBe(true)
    // yang penting: peringatannya sendiri sudah tersimpan sebelum lampiran
    const saved = loadDB().reports.find((r) => r.id === alert.id)
    expect(saved).toBeTruthy()
    expect(saved!.recipients.length).toBeGreaterThanOrEqual(0)
  })
})
