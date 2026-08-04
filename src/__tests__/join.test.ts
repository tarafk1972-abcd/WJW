import { beforeEach, describe, expect, it } from 'vitest'
import {
  createInvite,
  decideMember,
  invalidateCache,
  inviteLink,
  loadDB,
  lookupInvite,
  normalizeCode,
  parseInvitePayload,
  register,
  revokeInvite,
  searchCommunities,
} from '../lib/db'

function fresh() {
  localStorage.clear()
  invalidateCache()
}

function founder(name = 'RW 05 Griya Soreang', city = 'Bandung') {
  const r = register({
    name: 'Budi',
    phone: '0811000001',
    email: `budi${Math.random().toString(36).slice(2, 6)}@x.id`,
    password: 'secret1',
    house: 'C12',
    language: 'id',
    mode: 'create',
    communityName: name,
    city,
  })
  if (!r.ok) throw new Error('founder failed')
  return r
}

let n = 0
function applicant(over: Partial<Parameters<typeof register>[0]> = {}) {
  n += 1
  return register({
    name: `Warga ${n}`,
    phone: `08120000${String(n).padStart(4, '0')}`,
    email: `w${n}@x.id`,
    password: 'secret1',
    house: `B${n}`,
    language: 'id',
    mode: 'join',
    ...over,
  } as Parameters<typeof register>[0])
}

describe('path 3: create a community', () => {
  beforeEach(fresh)

  it('makes the creator an active admin immediately', () => {
    const r = founder()
    expect(r.firstAdmin).toBe(true)
    expect(r.member.role).toBe('admin')
    expect(r.member.status).toBe('active')
    expect(r.member.joinMethod).toBe('founder')
  })
})

describe('path 1: invite code / QR', () => {
  beforeEach(fresh)

  it('generates unambiguous codes and a scannable link', () => {
    const f = founder()
    const inv = createInvite(f.member.id, f.community.id, 'warga')
    expect(inv.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)
    expect(inv.code).not.toMatch(/[OI01]/)
    expect(inviteLink(inv.code)).toContain(`#/join/${inv.code}`)
  })

  it('accepts a code typed in any case or with separators', () => {
    const f = founder()
    const inv = createInvite(f.member.id, f.community.id, 'warga')
    expect(normalizeCode(` ${inv.code.toLowerCase()} `)).toBe(inv.code)
    expect(lookupInvite(inv.code.toLowerCase()).ok).toBe(true)
  })

  it('reads a code from a scanned QR link or a bare code', () => {
    expect(parseInvitePayload('https://x.app/#/join/ABC234')).toBe('ABC234')
    expect(parseInvitePayload('abc-234')).toBe('ABC234')
  })

  it('STILL requires admin approval when an invite code is used', () => {
    const f = founder()
    const inv = createInvite(f.member.id, f.community.id, 'satpam')
    const r = applicant({ communityId: f.community.id, inviteCode: inv.code })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    // the crucial rule: an invite does not skip the queue
    expect(r.member.status).toBe('pending')
    expect(r.member.joinMethod).toBe('invite')
    expect(r.member.joinCode).toBe(inv.code)
    // it only proposes a role
    expect(r.member.role).toBe('satpam')

    decideMember(f.member.id, r.member.id, 'accept', 'satpam')
    const after = loadDB().members.find((m) => m.id === r.member.id)!
    expect(after.status).toBe('active')
    expect(after.decidedBy).toBe(f.member.id)
  })

  it('allows an invite to be reused by several people', () => {
    const f = founder()
    const inv = createInvite(f.member.id, f.community.id, 'warga')
    const a = applicant({ communityId: f.community.id, inviteCode: inv.code })
    const b = applicant({ communityId: f.community.id, inviteCode: inv.code })
    expect(a.ok && b.ok).toBe(true)
    expect(loadDB().invites.find((i) => i.id === inv.id)!.usedBy).toHaveLength(2)
  })

  it('enforces the usage limit', () => {
    const f = founder()
    const inv = createInvite(f.member.id, f.community.id, 'warga', { maxUses: 1 })
    applicant({ communityId: f.community.id, inviteCode: inv.code })
    const second = applicant({ communityId: f.community.id, inviteCode: inv.code })
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error).toBe('errInviteUsed')
  })

  it('rejects expired and revoked codes', () => {
    const f = founder()
    const expiredInv = createInvite(f.member.id, f.community.id, 'warga')
    const db = loadDB()
    db.invites.find((i) => i.id === expiredInv.id)!.expiresAt = Date.now() - 1000
    localStorage.setItem('wjw.db.v1', JSON.stringify(db))
    invalidateCache()
    expect(lookupInvite(expiredInv.code)).toEqual({ ok: false, error: 'errInviteExpired' })

    const f2 = loadDB().communities[0]
    const live = createInvite(f.member.id, f2.id, 'warga')
    revokeInvite(f.member.id, live.id)
    expect(lookupInvite(live.code)).toEqual({ ok: false, error: 'errInvite' })
  })

  it('rejects an unknown code', () => {
    founder()
    expect(lookupInvite('ZZZZZZ')).toEqual({ ok: false, error: 'errInvite' })
  })

  it('rejects a code belonging to a different community', () => {
    const a = founder('RW 01', 'Bandung')
    const inv = createInvite(a.member.id, a.community.id, 'warga')
    // a second community, created by someone else
    const b = register({
      name: 'Citra',
      phone: '0813000009',
      email: 'citra@x.id',
      password: 'secret1',
      house: 'A1',
      language: 'id',
      mode: 'create',
      communityName: 'RW 09',
    })
    if (!b.ok) throw new Error('setup')
    const bad = applicant({ communityId: b.community.id, inviteCode: inv.code })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toBe('errInvite')
  })
})

describe('path 2: search + request to join', () => {
  beforeEach(fresh)

  it('finds a community by name, city or address fragment', () => {
    founder('RW 05 Griya Soreang', 'Bandung')
    expect(searchCommunities('griya')).toHaveLength(1)
    expect(searchCommunities('BANDUNG')).toHaveLength(1)
    expect(searchCommunities('  rw 05 ')).toHaveLength(1)
    expect(searchCommunities('jakarta')).toHaveLength(0)
  })

  it('queues the request as pending warga with the applicant note', () => {
    const f = founder()
    const r = applicant({
      communityId: f.community.id,
      joinNote: 'Saya penghuni baru Blok C.',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.member.status).toBe('pending')
    expect(r.member.role).toBe('warga')
    expect(r.member.joinMethod).toBe('search')
    expect(r.member.joinNote).toBe('Saya penghuni baru Blok C.')
    expect(r.member.joinCode).toBeNull()
  })

  it('lets the admin reject a search request with a reason', () => {
    const f = founder()
    const r = applicant({ communityId: f.community.id })
    if (!r.ok) return
    decideMember(f.member.id, r.member.id, 'reject', 'warga', 'Bukan warga sini')
    const after = loadDB().members.find((m) => m.id === r.member.id)!
    expect(after.status).toBe('rejected')
    expect(after.rejectedReason).toBe('Bukan warga sini')
  })

  it('fails when no community is selected', () => {
    founder()
    const r = applicant({ communityId: undefined })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('errNoCommunity')
  })
})
