/**
 * Menandai ronda dengan GPS yang tidak sempurna.
 *
 * Titik GPS ponsel biasa meleset 10-30 meter di antara bangunan atau di
 * bawah atap pos ronda. Sebelumnya jarak mentah dibandingkan langsung
 * dengan radius titik, sehingga satpam yang BERDIRI TEPAT di lokasi
 * ditolak dengan alasan "di luar area".
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  GPS_SLACK_MAX_M,
  addCheckpoint,
  invalidateCache,
  loadDB,
  patrolAllowedRadius,
  recordPatrol,
  register,
  saveDB,
} from '../lib/db'

const POS = { lat: -6.9829, lng: 107.5197 }
/** Geser kira-kira n meter ke utara. */
const utara = (m: number) => ({ lat: POS.lat + m / 111_320, lng: POS.lng })

describe('patrolAllowedRadius', () => {
  it('tidak melonggarkan apa pun bila GPS akurat', () => {
    expect(patrolAllowedRadius(50, 0)).toBe(50)
    expect(patrolAllowedRadius(50, null)).toBe(50)
  })

  it('melonggarkan sebesar ketidakpastian GPS', () => {
    expect(patrolAllowedRadius(50, 20)).toBe(70)
  })

  it('membatasi kelonggaran agar tidak jadi celah', () => {
    // Fix yang sangat buruk tidak boleh membuat titik bisa ditandai
    // dari mana saja.
    expect(patrolAllowedRadius(50, 5000)).toBe(50 + GPS_SLACK_MAX_M)
  })

  it('mengabaikan nilai akurasi yang tidak masuk akal', () => {
    expect(patrolAllowedRadius(50, -10)).toBe(50)
    expect(patrolAllowedRadius(50, Number.NaN)).toBe(50)
  })
})

describe('recordPatrol dengan GPS meleset', () => {
  let cid = ''
  let sid = ''

  beforeEach(() => {
    localStorage.clear()
    invalidateCache()
    const f = register({
      name: 'Satpam 1',
      phone: '0811000088',
      email: 'sat8@x.id',
      password: 'secret1',
      house: 'Pos',
      language: 'id',
      mode: 'create',
      communityName: 'The Regent',
    })
    if (!f.ok) throw new Error('setup gagal')
    cid = f.community.id
    sid = f.member.id
    const db = loadDB()
    db.members.find((m) => m.id === sid)!.role = 'satpam'
    saveDB(db)
    addCheckpoint(sid, {
      communityId: cid,
      name: 'Pos Utama',
      lat: POS.lat,
      lng: POS.lng,
      radiusM: 30,
    })
  })

  it('menerima satpam yang berdiri di titik walau GPS melaporkan 45 m', () => {
    // Inti keluhannya: sudah di lokasi, tetapi ditolak.
    const r = recordPatrol({
      communityId: cid,
      satpamId: sid,
      at: utara(45),
      accuracy: 30,
    })
    expect(r.ok).toBe(true)
  })

  it('tetap menolak yang benar-benar jauh, sekalipun GPS buruk', () => {
    const r = recordPatrol({
      communityId: cid,
      satpamId: sid,
      at: utara(400),
      accuracy: 9999,
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('errTooFar')
  })

  it('menolak 45 m bila GPS mengaku akurat — di situ memang di luar', () => {
    const r = recordPatrol({
      communityId: cid,
      satpamId: sid,
      at: utara(45),
      accuracy: 3,
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('errTooFar')
  })

  it('tetap menerima yang jelas berada di dalam radius', () => {
    const r = recordPatrol({
      communityId: cid,
      satpamId: sid,
      at: utara(10),
      accuracy: 5,
    })
    expect(r.ok).toBe(true)
  })
})
