import { beforeEach, describe, expect, it } from 'vitest'
import {
  acknowledgeAlert,
  addAttachment,
  alertAudience,
  attachAudio,
  cancelAlert,
  decideMember,
  invalidateCache,
  loadDB,
  pushLocation,
  raiseAlert,
  register,
  saveEmergencyProfile,
  stopLive,
  addContact,
} from '../lib/db'
import type { Member } from '../lib/types'

function fresh() {
  localStorage.clear()
  invalidateCache()
}

function makeCommunity() {
  const r = register({
    name: 'Budi',
    phone: '0811000001',
    email: 'budi@x.id',
    password: 'secret1',
    house: 'C12',
    language: 'id',
    mode: 'create',
    communityName: 'RW 05',
  })
  if (!r.ok) throw new Error('seed failed')
  return r
}

function join(
  communityId: string,
  adminId: string,
  name: string,
  phone: string,
  role: 'warga' | 'satpam' | 'admin',
): Member {
  const r = register({
    name,
    phone,
    email: `${name.toLowerCase()}@x.id`,
    password: 'secret1',
    house: 'X',
    language: 'id',
    mode: 'join',
    communityId,
  })
  if (!r.ok) throw new Error('join failed')
  decideMember(adminId, r.member.id, 'accept', role)
  return loadDB().members.find((m) => m.id === r.member.id)!
}

describe('alert payload', () => {
  beforeEach(fresh)

  it('captures location, profile, timestamp and recipients in one shot', () => {
    const admin = makeCommunity()
    saveEmergencyProfile(admin.member.id, {
      bloodType: 'O',
      allergies: 'Penisilin',
      conditions: 'Hipertensi',
      contactName: 'Siti',
      contactPhone: '0812',
      notes: '',
    })
    const me = loadDB().members.find((m) => m.id === admin.member.id)!

    const before = Date.now()
    const alert = raiseAlert({
      member: me,
      category: 'other',
      at: { lat: -6.98, lng: 107.51 },
      accuracy: 12,
    })

    expect(alert.kind).toBe('sos')
    expect(alert.live).toBe(true)
    expect(alert.createdAt).toBeGreaterThanOrEqual(before)
    // GPS seeds the live track
    expect(alert.track).toHaveLength(1)
    expect(alert.track[0].accuracy).toBe(12)
    // profile is frozen onto the alert
    expect(alert.snapshot?.name).toBe('Budi')
    expect(alert.snapshot?.bloodType).toBe('O')
    expect(alert.snapshot?.contactPhone).toBe('0812')
    expect(alert.audio).toBeNull()
    expect(alert.cancelledAt).toBeNull()
  })

  it('still raises an alert when GPS is unavailable', () => {
    const admin = makeCommunity()
    const alert = raiseAlert({ member: admin.member, category: 'other', at: null })
    expect(alert.track).toEqual([])
    expect(alert.at).toBeNull()
    expect(alert.live).toBe(true)
  })

  it('streams live location and ignores duplicate fixes', () => {
    const admin = makeCommunity()
    const alert = raiseAlert({
      member: admin.member,
      category: 'other',
      at: { lat: 1, lng: 1 },
    })
    pushLocation(alert.id, { lat: 1, lng: 1, at: Date.now(), accuracy: 5 }) // duplicate
    pushLocation(alert.id, { lat: 2, lng: 2, at: Date.now(), accuracy: 5 })

    const after = loadDB().reports.find((r) => r.id === alert.id)!
    expect(after.track).toHaveLength(2)
    expect(after.at).toEqual({ lat: 2, lng: 2 })
  })

  it('stops accepting pings once live sharing ends', () => {
    const admin = makeCommunity()
    const alert = raiseAlert({ member: admin.member, category: 'other', at: null })
    stopLive(alert.id)
    pushLocation(alert.id, { lat: 9, lng: 9, at: Date.now(), accuracy: null })

    const after = loadDB().reports.find((r) => r.id === alert.id)!
    expect(after.live).toBe(false)
    expect(after.liveEndedAt).toBeTruthy()
    expect(after.track).toHaveLength(0)
  })

  it('stores the 15s voice note and media attachments', () => {
    const admin = makeCommunity()
    const alert = raiseAlert({ member: admin.member, category: 'other', at: null })
    attachAudio(alert.id, 'data:audio/webm;base64,AAAA', 15)
    addAttachment(alert.id, 'data:image/jpeg;base64,BBBB', 'photo')
    addAttachment(alert.id, 'data:video/mp4;base64,CCCC', 'video')

    const after = loadDB().reports.find((r) => r.id === alert.id)!
    expect(after.audioSeconds).toBe(15)
    expect(after.audio).toContain('audio/webm')
    expect(after.attachments.map((a) => a.kind)).toEqual(['photo', 'video'])
    expect(after.attachments[0].bytes).toBeGreaterThan(0)
  })

  it('lets the caller cancel a false alarm', () => {
    const admin = makeCommunity()
    const alert = raiseAlert({ member: admin.member, category: 'other', at: null })
    cancelAlert(alert.id, admin.member.id)

    const after = loadDB().reports.find((r) => r.id === alert.id)!
    expect(after.cancelledAt).toBeTruthy()
    expect(after.status).toBe('resolved')
    expect(after.live).toBe(false)
  })
})

describe('alert audience', () => {
  beforeEach(fresh)

  it('includes family, friends, guards, admins and verified volunteers only', () => {
    const admin = makeCommunity()
    const cid = admin.community.id
    const aid = admin.member.id

    const guard = join(cid, aid, 'Joko', '0811000002', 'satpam')
    const coadmin = join(cid, aid, 'Siti', '0811000003', 'admin')
    join(cid, aid, 'Warga', '0811000004', 'warga') // plain resident: not a responder

    addContact({
      ownerId: aid,
      communityId: cid,
      name: 'Kakak',
      phone: '0899000001',
      kind: 'family',
      verified: true,
      memberId: null,
    })
    addContact({
      ownerId: aid,
      communityId: cid,
      name: 'Teman',
      phone: '0899000002',
      kind: 'friend',
      verified: true,
      memberId: null,
    })
    addContact({
      ownerId: null,
      communityId: cid,
      name: 'Relawan Terverifikasi',
      phone: '0899000003',
      kind: 'volunteer',
      verified: true,
      memberId: null,
    })
    addContact({
      ownerId: null,
      communityId: cid,
      name: 'Relawan Belum Verifikasi',
      phone: '0899000004',
      kind: 'volunteer',
      verified: false,
      memberId: null,
    })

    const me = loadDB().members.find((m) => m.id === aid)!
    const audience = alertAudience(loadDB(), me)
    const names = audience.map((a) => a.name)

    expect(names).toContain('Kakak')
    expect(names).toContain('Teman')
    expect(names).toContain('Relawan Terverifikasi')
    expect(names).toContain(guard.name)
    expect(names).toContain(coadmin.name)
    // unverified volunteers and plain residents are excluded
    expect(names).not.toContain('Relawan Belum Verifikasi')
    expect(names).not.toContain('Warga')
    // never the caller
    expect(names).not.toContain('Budi')
  })

  it('does not leak another member\u2019s personal contacts', () => {
    const admin = makeCommunity()
    const other = join(admin.community.id, admin.member.id, 'Rina', '0811000009', 'warga')
    addContact({
      ownerId: other.id,
      communityId: admin.community.id,
      name: 'Ibu Rina',
      phone: '0899111111',
      kind: 'family',
      verified: true,
      memberId: null,
    })
    const me = loadDB().members.find((m) => m.id === admin.member.id)!
    expect(alertAudience(loadDB(), me).map((a) => a.name)).not.toContain('Ibu Rina')
  })

  it('deduplicates a person who is both a contact and a member', () => {
    const admin = makeCommunity()
    const guard = join(admin.community.id, admin.member.id, 'Joko', '0811000002', 'satpam')
    addContact({
      ownerId: admin.member.id,
      communityId: admin.community.id,
      name: 'Joko (satpam)',
      phone: guard.phone,
      kind: 'friend',
      verified: true,
      memberId: guard.id,
    })
    const me = loadDB().members.find((m) => m.id === admin.member.id)!
    const audience = alertAudience(loadDB(), me)
    expect(audience.filter((a) => a.memberId === guard.id)).toHaveLength(1)
  })

  it('records delivery and lets a recipient acknowledge once', () => {
    const admin = makeCommunity()
    const guard = join(admin.community.id, admin.member.id, 'Joko', '0811000002', 'satpam')
    const me = loadDB().members.find((m) => m.id === admin.member.id)!

    const alert = raiseAlert({ member: me, category: 'medical', at: null })
    const rec = alert.recipients.find((r) => r.memberId === guard.id)!
    expect(rec.deliveredAt).toBeGreaterThan(0)
    expect(rec.acknowledgedAt).toBeNull()

    acknowledgeAlert(alert.id, guard.id)
    const firstAck = loadDB().reports.find((r) => r.id === alert.id)!
      .recipients.find((r) => r.memberId === guard.id)!.acknowledgedAt
    acknowledgeAlert(alert.id, guard.id)

    const after = loadDB().reports.find((r) => r.id === alert.id)!
    expect(after.status).toBe('ack')
    expect(after.responders).toEqual([guard.id])
    expect(after.recipients.find((r) => r.memberId === guard.id)!.acknowledgedAt).toBe(
      firstAck,
    )
  })
})
