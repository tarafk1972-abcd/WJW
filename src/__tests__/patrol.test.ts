import { beforeEach, describe, expect, it } from 'vitest'
import {
  activeSchedule,
  addCheckpoint,
  addSchedule,
  checkpointsOf,
  decideMember,
  distanceMeters,
  invalidateCache,
  loadDB,
  logsForDay,
  recordPatrol,
  register,
  removeCheckpoint,
} from '../lib/db'

function fresh() {
  localStorage.clear()
  invalidateCache()
}

function setup() {
  const admin = register({
    name: 'Budi', phone: '0811000001', email: 'b@x.id', password: 'secret1',
    house: 'C12', language: 'id', mode: 'create', communityName: 'RW 05',
  })
  if (!admin.ok) throw new Error('setup')
  const g = register({
    name: 'Joko', phone: '0811000002', email: 'j@x.id', password: 'secret1',
    house: 'Pos', language: 'id', mode: 'join', communityId: admin.community.id,
  })
  if (!g.ok) throw new Error('setup guard')
  decideMember(admin.member.id, g.member.id, 'accept', 'satpam')
  return { cid: admin.community.id, aid: admin.member.id, gid: g.member.id }
}

/** 22:00 hari ini sebagai timestamp. */
function at(h: number, m = 0) {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

describe('jarak GPS', () => {
  it('menghitung jarak dua koordinat dalam meter', () => {
    // ~111 m per 0.001 derajat lintang
    const d = distanceMeters({ lat: -6.98, lng: 107.51 }, { lat: -6.981, lng: 107.51 })
    expect(d).toBeGreaterThan(105)
    expect(d).toBeLessThan(118)
  })

  it('jarak ke titik yang sama adalah nol', () => {
    expect(distanceMeters({ lat: 1, lng: 1 }, { lat: 1, lng: 1 })).toBe(0)
  })
})

describe('titik ronda', () => {
  beforeEach(fresh)

  it('admin menambah titik dan urutannya otomatis', () => {
    const { cid, aid } = setup()
    const a = addCheckpoint(aid, { communityId: cid, name: 'Pos 1', lat: -6.98, lng: 107.51, radiusM: 50 })
    const b = addCheckpoint(aid, { communityId: cid, name: 'Pos 2', lat: -6.982, lng: 107.512, radiusM: 50 })
    expect(a.order).toBe(1)
    expect(b.order).toBe(2)
    expect(checkpointsOf(loadDB(), cid)).toHaveLength(2)
  })

  it('titik yang dihapus tidak lagi muncul', () => {
    const { cid, aid } = setup()
    const a = addCheckpoint(aid, { communityId: cid, name: 'Pos 1', lat: -6.98, lng: 107.51, radiusM: 50 })
    removeCheckpoint(aid, a.id)
    expect(checkpointsOf(loadDB(), cid)).toHaveLength(0)
  })
})

describe('jadwal ronda', () => {
  beforeEach(fresh)

  it('mengenali jadwal yang sedang berjalan', () => {
    const { cid, aid } = setup()
    addSchedule(aid, {
      communityId: cid, label: 'Ronda Malam',
      startMinute: 22 * 60, endMinute: 23 * 60, days: [], graceMin: 15,
    })
    const act = activeSchedule(loadDB(), cid, at(22, 5))
    expect(act?.schedule.label).toBe('Ronda Malam')
    expect(act?.late).toBe(false)
  })

  it('menandai terlambat setelah masa toleransi', () => {
    const { cid, aid } = setup()
    addSchedule(aid, {
      communityId: cid, label: 'Ronda Malam',
      startMinute: 22 * 60, endMinute: 23 * 60, days: [], graceMin: 15,
    })
    expect(activeSchedule(loadDB(), cid, at(22, 40))?.late).toBe(true)
  })

  it('mengembalikan null di luar jam jadwal', () => {
    const { cid, aid } = setup()
    addSchedule(aid, {
      communityId: cid, label: 'Ronda Malam',
      startMinute: 22 * 60, endMinute: 23 * 60, days: [], graceMin: 15,
    })
    expect(activeSchedule(loadDB(), cid, at(15, 0))).toBeNull()
  })

  it('menangani jadwal yang melewati tengah malam', () => {
    const { cid, aid } = setup()
    addSchedule(aid, {
      communityId: cid, label: 'Ronda Dini Hari',
      startMinute: 23 * 60, endMinute: 2 * 60, days: [], graceMin: 10,
    })
    const db = loadDB()
    // 23:30 (sebelum tengah malam) dan 01:00 (sesudah) sama-sama di dalam jadwal
    expect(activeSchedule(db, cid, at(23, 30))?.schedule.label).toBe('Ronda Dini Hari')
    expect(activeSchedule(db, cid, at(1, 0))?.schedule.label).toBe('Ronda Dini Hari')
    expect(activeSchedule(db, cid, at(5, 0))).toBeNull()
  })

  it('menghormati batasan hari', () => {
    const { cid, aid } = setup()
    const today = new Date().getDay()
    const other = (today + 3) % 7
    addSchedule(aid, {
      communityId: cid, label: 'Khusus', startMinute: 0, endMinute: 1439,
      days: [other], graceMin: 0,
    })
    expect(activeSchedule(loadDB(), cid, at(12, 0))).toBeNull()
  })
})

describe('rekam ronda (satu tombol)', () => {
  beforeEach(fresh)

  function withPoint() {
    const s = setup()
    const cp = addCheckpoint(s.aid, {
      communityId: s.cid, name: 'Pos 1', lat: -6.98, lng: 107.51, radiusM: 50,
    })
    return { ...s, cp }
  }

  it('mencatat ronda saat satpam berada di titik', () => {
    const { cid, gid, cp } = withPoint()
    const res = recordPatrol({
      communityId: cid, satpamId: gid, at: { lat: cp.lat, lng: cp.lng },
    })
    expect(res.ok).toBe(true)
    expect(res.log?.checkpointName).toBe('Pos 1')
    expect(res.log?.insideRadius).toBe(true)
    expect(res.log?.distanceM).toBe(0)
  })

  it('menolak bila satpam terlalu jauh dari titik', () => {
    const { cid, gid } = withPoint()
    const res = recordPatrol({
      communityId: cid, satpamId: gid, at: { lat: -6.99, lng: 107.52 },
    })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('errTooFar')
    expect(res.distanceM).toBeGreaterThan(50)
    expect(loadDB().patrolLogs).toHaveLength(0)
  })

  it('tetap bisa merekam dengan force, dan ditandai di luar radius', () => {
    const { cid, gid } = withPoint()
    const res = recordPatrol({
      communityId: cid, satpamId: gid, at: { lat: -6.99, lng: 107.52 }, force: true,
    })
    expect(res.ok).toBe(true)
    expect(res.log?.insideRadius).toBe(false)
  })

  it('memilih titik terdekat secara otomatis', () => {
    const { cid, aid, gid } = withPoint()
    addCheckpoint(aid, {
      communityId: cid, name: 'Pos 2', lat: -6.9805, lng: 107.5105, radiusM: 50,
    })
    const res = recordPatrol({
      communityId: cid, satpamId: gid, at: { lat: -6.98049, lng: 107.51049 },
    })
    expect(res.log?.checkpointName).toBe('Pos 2')
  })

  it('memberi status tepat waktu / terlambat / di luar jadwal', () => {
    const { cid, aid, gid, cp } = withPoint()
    addSchedule(aid, {
      communityId: cid, label: 'Ronda Malam',
      startMinute: 22 * 60, endMinute: 23 * 60, days: [], graceMin: 15,
    })
    const here = { lat: cp.lat, lng: cp.lng }

    const ontime = recordPatrol({ communityId: cid, satpamId: gid, at: here, now: at(22, 5) })
    expect(ontime.log?.status).toBe('ontime')
    expect(ontime.log?.scheduleLabel).toBe('Ronda Malam')

    const late = recordPatrol({ communityId: cid, satpamId: gid, at: here, now: at(22, 45) })
    expect(late.log?.status).toBe('late')

    const off = recordPatrol({ communityId: cid, satpamId: gid, at: here, now: at(15, 0) })
    expect(off.log?.status).toBe('offschedule')
    expect(off.log?.scheduleLabel).toBe('')
  })

  it('mencegah dobel-catat dalam 5 menit', () => {
    const { cid, gid, cp } = withPoint()
    const here = { lat: cp.lat, lng: cp.lng }
    recordPatrol({ communityId: cid, satpamId: gid, at: here, now: at(22, 0) })
    const dup = recordPatrol({ communityId: cid, satpamId: gid, at: here, now: at(22, 2) })
    expect(dup.ok).toBe(false)
    expect(dup.error).toBe('errAlreadyLogged')
    // setelah lewat 5 menit boleh lagi
    const ok = recordPatrol({ communityId: cid, satpamId: gid, at: here, now: at(22, 30) })
    expect(ok.ok).toBe(true)
  })

  it('gagal bila lingkungan belum punya titik ronda', () => {
    const { cid, gid } = setup()
    const res = recordPatrol({ communityId: cid, satpamId: gid, at: { lat: -6.98, lng: 107.51 } })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('errNoCheckpoint')
  })

  it('rekap harian hanya memuat log hari itu', () => {
    const { cid, gid, cp } = withPoint()
    const here = { lat: cp.lat, lng: cp.lng }
    recordPatrol({ communityId: cid, satpamId: gid, at: here, now: at(22, 0) })

    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
    expect(logsForDay(loadDB(), cid, todayStart.getTime())).toHaveLength(1)
    // kemarin kosong
    expect(logsForDay(loadDB(), cid, todayStart.getTime() - 86400000)).toHaveLength(0)
  })
})
