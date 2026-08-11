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

    const pay = submitPayment(res.community.id, res.member.id, 'yearly')
    // nomor referensi ditentukan sistem, bukan diisi admin
    expect(pay.reference).toMatch(/^WJW[A-HJ-NP-Z2-9]{5}$/)
    expect(pay.method).toBe('QRIS ShopeePay')
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
    const pay = submitPayment(res.community.id, res.member.id, 'monthly')
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

describe('panic alerts, tips & two-way updates', () => {
  beforeEach(fresh)

  it('records a panic alert as an open SOS carrying its location', async () => {
    const { addReport } = await import('../lib/db')
    const res = makeCommunity()
    if (!res.ok) return
    saveArea(res.member.id, res.community.id, [
      { lat: -1, lng: -1 },
      { lat: -1, lng: 1 },
      { lat: 1, lng: 1 },
      { lat: 1, lng: -1 },
    ])

    const rep = addReport({
      communityId: res.community.id,
      authorId: res.member.id,
      kind: 'sos',
      category: 'medical',
      note: 'help',
      at: { lat: 0, lng: 0 },
      address: 'A1',
    })
    expect(rep.kind).toBe('sos')
    expect(rep.status).toBe('open')
    expect(rep.insideArea).toBe(true)
    expect(rep.responders).toEqual([])
    expect(rep.messages).toEqual([])
  })

  it('flags a panic alert raised outside the neighbourhood area', async () => {
    const { addReport } = await import('../lib/db')
    const res = makeCommunity()
    if (!res.ok) return
    saveArea(res.member.id, res.community.id, [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
      { lat: 1, lng: 1 },
      { lat: 1, lng: 0 },
    ])
    const rep = addReport({
      communityId: res.community.id,
      authorId: res.member.id,
      kind: 'sos',
      category: 'fire',
      note: '',
      at: { lat: 50, lng: 50 },
      address: '',
    })
    expect(rep.insideArea).toBe(false)
  })

  it('lets a guard respond, which acknowledges the incident once', async () => {
    const { addReport, respondToReport } = await import('../lib/db')
    const res = makeCommunity()
    if (!res.ok) return
    const guard = register({
      name: 'Pak Joko',
      phone: '0899999999',
      email: 'joko@x.id',
      password: 'secret1',
      house: 'Pos',
      language: 'id',
      mode: 'join',
      communityId: res.community.id,
    })
    if (!guard.ok) return
    decideMember(res.member.id, guard.member.id, 'accept', 'satpam')

    const rep = addReport({
      communityId: res.community.id,
      authorId: res.member.id,
      kind: 'sos',
      category: 'theft',
      note: '',
      at: null,
      address: '',
    })
    respondToReport(guard.member.id, rep.id)
    respondToReport(guard.member.id, rep.id) // idempotent

    const after = loadDB().reports.find((r) => r.id === rep.id)!
    expect(after.status).toBe('ack')
    expect(after.handledBy).toBe(guard.member.id)
    expect(after.responders).toEqual([guard.member.id])
  })

  it('keeps an anonymous tip anonymous while storing the author for admins', async () => {
    const { addReport } = await import('../lib/db')
    const res = makeCommunity()
    if (!res.ok) return
    const tip = addReport({
      communityId: res.community.id,
      authorId: res.member.id,
      kind: 'tip',
      category: 'drugs',
      note: 'suspicious dealing',
      at: null,
      address: '',
      anonymous: true,
    })
    expect(tip.kind).toBe('tip')
    expect(tip.anonymous).toBe(true)
    expect(tip.authorId).toBe(res.member.id)
  })

  it('appends chat and photo evidence to an incident', async () => {
    const { addReport, addIncidentMessage, addAttachment } = await import('../lib/db')
    const res = makeCommunity()
    if (!res.ok) return
    const rep = addReport({
      communityId: res.community.id,
      authorId: res.member.id,
      kind: 'incident',
      category: 'flood',
      note: '',
      at: null,
      address: '',
    })
    addIncidentMessage(rep.id, res.member.id, 'water is rising')
    addAttachment(rep.id, 'data:image/jpeg;base64,AAA')

    const after = loadDB().reports.find((r) => r.id === rep.id)!
    expect(after.messages).toHaveLength(1)
    expect(after.messages[0].body).toBe('water is rising')
    expect(after.attachments).toHaveLength(1)
  })
})

describe('mass notification & safety check', () => {
  beforeEach(fresh)

  it('sends a broadcast and tallies safety responses without duplicates', async () => {
    const { sendBroadcast, respondSafety } = await import('../lib/db')
    const res = makeCommunity()
    if (!res.ok) return

    const bc = sendBroadcast({
      communityId: res.community.id,
      authorId: res.member.id,
      severity: 'critical',
      title: 'Kebakaran',
      body: '',
      instruction: 'Evakuasi ke lapangan',
      requireSafetyCheck: true,
    })
    expect(bc.responses).toEqual([])

    respondSafety(bc.id, res.member.id, 'safe')
    respondSafety(bc.id, res.member.id, 'need_help', 'terjebak')

    const after = loadDB().broadcasts.find((b) => b.id === bc.id)!
    expect(after.responses).toHaveLength(1) // updated, not duplicated
    expect(after.responses[0].status).toBe('need_help')
    expect(after.responses[0].note).toBe('terjebak')
  })
})

describe('emergency profile', () => {
  beforeEach(fresh)

  it('stores the profile that responders see on a panic alert', async () => {
    const { saveEmergencyProfile } = await import('../lib/db')
    const res = makeCommunity()
    if (!res.ok) return
    saveEmergencyProfile(res.member.id, {
      bloodType: 'O',
      allergies: 'Penisilin',
      conditions: 'Hipertensi',
      contactName: 'Siti',
      contactPhone: '0812',
      notes: '',
    })
    const m = loadDB().members.find((x) => x.id === res.member.id)!
    expect(m.emergency?.bloodType).toBe('O')
    expect(m.emergency?.contactPhone).toBe('0812')
  })
})
