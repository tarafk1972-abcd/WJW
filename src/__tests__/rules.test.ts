import { beforeEach, describe, expect, it } from 'vitest'
import {
  DAY,
  PRICE_YEARLY,
  TRIAL_DAYS,
  decideMember,
  invalidateCache,
  loadDB,
  planState,
  pointInPolygon,
  register,
  saveArea,
  saveDB,
  submitPayment,
  verifyPayment,
} from '../lib/db'
import type { LatLng } from '../lib/types'

function fresh() {
  localStorage.clear()
  invalidateCache()
}

function makeCommunity(name = 'RW 01') {
  return register({
    name: 'Admin Satu',
    phone: '0811111111',
    email: `admin${Math.random().toString(36).slice(2, 7)}@mail.com`,
    password: 'secret1',
    house: 'A1',
    language: 'id',
    mode: 'create',
    communityName: name,
  })
}

describe('membership rules', () => {
  beforeEach(fresh)

  it('gives the first resident the admin role and an active status', () => {
    const res = makeCommunity()
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.firstAdmin).toBe(true)
    expect(res.member.role).toBe('admin')
    expect(res.member.status).toBe('active')
  })

  it('starts a 14-day trial for a new community', () => {
    const res = makeCommunity()
    if (!res.ok) return
    const days = Math.round((res.community.trialEndsAt - Date.now()) / DAY)
    expect(days).toBe(TRIAL_DAYS)
    expect(planState(res.community).status).toBe('trial')
  })

  it('puts later residents in the pending queue as warga', () => {
    const first = makeCommunity()
    if (!first.ok) return
    const second = register({
      name: 'Warga Dua',
      phone: '0822222222',
      email: 'dua@mail.com',
      password: 'secret1',
      house: 'B2',
      language: 'en',
      mode: 'join',
      communityId: first.community.id,
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.firstAdmin).toBe(false)
    expect(second.member.status).toBe('pending')
    expect(second.member.role).toBe('warga')
    // chosen language is stored per member
    expect(second.member.language).toBe('en')
  })

  it('lets an admin accept a pending member with any role', () => {
    const first = makeCommunity()
    if (!first.ok) return
    const second = register({
      name: 'Satpam Tiga',
      phone: '0833333333',
      email: 'tiga@mail.com',
      password: 'secret1',
      house: 'Pos',
      language: 'id',
      mode: 'join',
      communityId: first.community.id,
    })
    if (!second.ok) return

    decideMember(first.member.id, second.member.id, 'accept', 'satpam')
    const after = loadDB().members.find((m) => m.id === second.member.id)!
    expect(after.status).toBe('active')
    expect(after.role).toBe('satpam')
    expect(after.decidedBy).toBe(first.member.id)
  })

  it('records a rejection with its reason', () => {
    const first = makeCommunity()
    if (!first.ok) return
    const second = register({
      name: 'Orang Asing',
      phone: '0844444444',
      email: 'asing@mail.com',
      password: 'secret1',
      house: '-',
      language: 'id',
      mode: 'join',
      communityId: first.community.id,
    })
    if (!second.ok) return

    decideMember(first.member.id, second.member.id, 'reject', 'warga', 'Bukan warga')
    const after = loadDB().members.find((m) => m.id === second.member.id)!
    expect(after.status).toBe('rejected')
    expect(after.rejectedReason).toBe('Bukan warga')
  })

  it('rejects duplicate email and phone', () => {
    const first = makeCommunity()
    if (!first.ok) return
    const dup = register({
      name: 'Kembar',
      phone: first.member.phone,
      email: 'lain@mail.com',
      password: 'secret1',
      house: 'C3',
      language: 'id',
      mode: 'join',
      communityId: first.community.id,
    })
    expect(dup.ok).toBe(false)
    if (!dup.ok) expect(dup.error).toBe('errPhoneTaken')
  })
})

describe('billing', () => {
  beforeEach(fresh)

  it('reports expired once the trial elapses', () => {
    const res = makeCommunity()
    if (!res.ok) return
    const db = loadDB()
    const c = db.communities[0]
    c.trialEndsAt = Date.now() - DAY
    saveDB(db)
    expect(planState(c).status).toBe('expired')
  })

  it('activates the plan when the superadmin verifies a payment', () => {
    const res = makeCommunity()
    if (!res.ok) return
    const db = loadDB()
    db.communities[0].trialEndsAt = Date.now() - DAY
    saveDB(db)

    const pay = submitPayment(
      res.community.id,
      res.member.id,
      'yearly',
      'QRIS',
      'TRX-1',
    )
    expect(pay.amount).toBe(PRICE_YEARLY)
    expect(planState(loadDB().communities[0]).status).toBe('expired')

    verifyPayment('superadmin', pay.id, true)
    const after = loadDB().communities[0]
    expect(planState(after).status).toBe('active')
    expect(after.paidUntil).toBeGreaterThan(Date.now())
  })

  it('does not activate a rejected payment', () => {
    const res = makeCommunity()
    if (!res.ok) return
    const db = loadDB()
    db.communities[0].trialEndsAt = Date.now() - DAY
    saveDB(db)
    const pay = submitPayment(res.community.id, res.member.id, 'monthly', 'QRIS', 'X')
    verifyPayment('superadmin', pay.id, false)
    expect(planState(loadDB().communities[0]).status).toBe('expired')
  })
})

describe('neighbourhood area', () => {
  beforeEach(fresh)

  const square: LatLng[] = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 2 },
    { lat: 2, lng: 2 },
    { lat: 2, lng: 0 },
  ]

  it('detects points inside and outside the polygon', () => {
    expect(pointInPolygon({ lat: 1, lng: 1 }, square)).toBe(true)
    expect(pointInPolygon({ lat: 3, lng: 1 }, square)).toBe(false)
  })

  it('treats a degenerate polygon as no area', () => {
    expect(pointInPolygon({ lat: 1, lng: 1 }, square.slice(0, 2))).toBe(false)
  })

  it('stores the admin-drawn area on the community for every member', () => {
    const res = makeCommunity()
    if (!res.ok) return
    saveArea(res.member.id, res.community.id, square)
    const c = loadDB().communities[0]
    expect(c.area).toHaveLength(4)
    expect(c.areaUpdatedBy).toBe(res.member.id)
    // centre recomputed from the polygon
    expect(c.center.lat).toBeCloseTo(1)
    expect(c.center.lng).toBeCloseTo(1)
  })
})

describe('demo seeder', () => {
  beforeEach(fresh)

  it('builds a complete demo neighbourhood and signs in the admin', async () => {
    const { seedDemo } = await import('../lib/seed')
    const adminId = seedDemo()
    expect(adminId).toBeTruthy()

    const db = loadDB()
    expect(db.communities).toHaveLength(1)
    expect(db.communities[0].area.length).toBeGreaterThanOrEqual(3)

    const admins = db.members.filter((m) => m.role === 'admin')
    const satpam = db.members.filter((m) => m.role === 'satpam')
    const pending = db.members.filter((m) => m.status === 'pending')
    expect(admins.length).toBe(2) // Budi + Siti
    expect(satpam.length).toBe(2)
    expect(pending.length).toBe(2) // waiting for approval

    expect(db.reports.length).toBeGreaterThan(0)
    expect(db.guests.length).toBeGreaterThan(0)
    expect(db.patrols[0].endedAt).toBeTruthy()
    expect(db.tickets.length).toBe(1)

    // the seeded session must belong to the admin, not the last registrant
    expect(localStorage.getItem('wjw.session.v1')).toBe(adminId)
    // still inside the trial window
    expect(planState(db.communities[0]).status).toBe('trial')
  })

  it('is a no-op when data already exists', async () => {
    const { seedDemo } = await import('../lib/seed')
    seedDemo()
    const before = loadDB().members.length
    expect(seedDemo()).toBeNull()
    expect(loadDB().members.length).toBe(before)
  })
})
