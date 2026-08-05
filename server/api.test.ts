/**
 * Tes API. Setiap tes memakai basis data sementara sendiri.
 * Jalankan: npx vitest run server/api.test.ts
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as pathJoin } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let app: { fetch: (req: Request) => Response | Promise<Response> }
let dir: string

beforeAll(async () => {
  dir = mkdtempSync(pathJoin(tmpdir(), 'wjw-'))
  process.env.WJW_DB = pathJoin(dir, 'test.sqlite')
  process.env.WJW_SUPERADMIN_PASSWORD = 'super-secret'
  process.env.WJW_NO_LISTEN = '1'
  const mod = await import('./index.js')
  app = mod.app
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

const BASE = 'http://x'

async function call(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
) {
  const res = await app.fetch(
    new Request(BASE + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

let seq = 0
async function makeAdmin() {
  seq += 1
  const r = await call('POST', '/api/auth/register', {
    name: `Admin${seq}`,
    phone: `0811${String(seq).padStart(9, '0')}`,
    email: `admin${seq}@x.id`,
    password: 'secret123',
    house: 'C12',
    mode: 'create',
    communityName: `RW ${seq}`,
    city: 'Bandung',
  })
  if (!r.body?.token)
    throw new Error(`makeAdmin gagal: ${r.status} ${JSON.stringify(r.body)}`)
  return {
    token: r.body.token as string,
    id: r.body.member.id as string,
    communityId: r.body.member.communityId as string,
  }
}

async function join(communityId: string, role?: string, adminToken?: string) {
  seq += 1
  const email = `user${seq}@x.id`
  const r = await call('POST', '/api/auth/register', {
    name: `User${seq}`,
    phone: `0822${String(seq).padStart(9, '0')}`,
    email,
    password: 'secret123',
    house: `B${seq}`,
    mode: 'join',
    communityId,
  })
  if (!r.body?.member)
    throw new Error(`join gagal: ${r.status} ${JSON.stringify(r.body)}`)
  const id = r.body.member.id as string
  if (role && adminToken) {
    await call('POST', `/api/members/${id}/decide`, { decision: 'accept', role }, adminToken)
  }
  // login ulang agar token membawa peran terbaru
  const login = await call('POST', '/api/auth/login', {
    identifier: email,
    password: 'secret123',
  })
  if (!login.body?.token)
    throw new Error(`login gagal: ${login.status} ${JSON.stringify(login.body)}`)
  return { id, token: login.body.token as string }
}

describe('autentikasi', () => {
  it('tidak pernah mengembalikan sandi atau hash-nya', async () => {
    const a = await makeAdmin()
    const me = await call('GET', '/api/me', undefined, a.token)
    expect(JSON.stringify(me.body)).not.toContain('password')
    expect(JSON.stringify(me.body)).not.toContain('$2a$')
  })

  it('menyimpan sandi sebagai hash bcrypt, bukan teks biasa', async () => {
    seq += 1
    await call('POST', '/api/auth/register', {
      name: 'Hash', phone: '0899000001', email: 'hash@x.id',
      password: 'rahasia-sekali', house: 'A1', mode: 'create', communityName: 'RW Hash',
    })
    const { db } = await import('./db.js')
    const row = db.prepare('SELECT password_hash FROM members WHERE email=?')
      .get('hash@x.id') as { password_hash: string }
    expect(row.password_hash).not.toBe('rahasia-sekali')
    expect(row.password_hash.startsWith('$2')).toBe(true)
  })

  it('menolak sandi salah dan email tak dikenal', async () => {
    const a = await makeAdmin()
    const me = await call('GET', '/api/me', undefined, a.token)
    const email = me.body.member.email
    expect((await call('POST', '/api/auth/login', { identifier: email, password: 'x' })).status).toBe(401)
    expect((await call('POST', '/api/auth/login', { identifier: 'nobody@x.id', password: 'y' })).status).toBe(401)
  })

  it('menolak akses tanpa token', async () => {
    expect((await call('GET', '/api/state')).status).toBe(401)
  })

  it('menolak email dan telepon ganda', async () => {
    const a = await makeAdmin()
    const me = await call('GET', '/api/me', undefined, a.token)
    const dup = await call('POST', '/api/auth/register', {
      name: 'Dup', phone: '0899999991', email: me.body.member.email,
      password: 'secret123', house: 'X', mode: 'join', communityId: a.communityId,
    })
    expect(dup.status).toBe(409)
    expect(dup.body.error).toBe('errEmailTaken')
  })

  it('logout membatalkan token', async () => {
    const a = await makeAdmin()
    await call('POST', '/api/auth/logout', {}, a.token)
    expect((await call('GET', '/api/state', undefined, a.token)).status).toBe(401)
  })
})

describe('data lintas perangkat', () => {
  it('admin melihat pendaftar yang dibuat dari perangkat lain', async () => {
    const a = await makeAdmin()
    await join(a.communityId)
    const state = await call('GET', '/api/state', undefined, a.token)
    const pending = state.body.members.filter(
      (m: { status: string }) => m.status === 'pending',
    )
    expect(pending).toHaveLength(1)
  })

  it('anggota yang disetujui langsung aktif di sesinya sendiri', async () => {
    const a = await makeAdmin()
    const u = await join(a.communityId, 'satpam', a.token)
    const me = await call('GET', '/api/me', undefined, u.token)
    expect(me.body.member.role).toBe('satpam')
    expect(me.body.member.status).toBe('active')
  })
})

describe('otorisasi peran', () => {
  it('warga tidak boleh menyetujui anggota', async () => {
    const a = await makeAdmin()
    const w = await join(a.communityId, 'warga', a.token)
    const other = await join(a.communityId)
    const r = await call('POST', `/api/members/${other.id}/decide`, { decision: 'accept' }, w.token)
    expect(r.status).toBe(403)
  })

  it('warga tidak boleh mengubah area lingkungan', async () => {
    const a = await makeAdmin()
    const w = await join(a.communityId, 'warga', a.token)
    expect((await call('PUT', '/api/community/area', { area: [] }, w.token)).status).toBe(403)
  })

  it('admin lingkungan lain tidak boleh menyentuh anggota kita', async () => {
    const a = await makeAdmin()
    const b = await makeAdmin()
    const target = await join(a.communityId)
    const r = await call('POST', `/api/members/${target.id}/decide`, { decision: 'accept' }, b.token)
    expect(r.status).toBe(403)
  })

  it('anggota pending tidak melihat data anggota lain', async () => {
    const a = await makeAdmin()
    seq += 1
    const reg = await call('POST', '/api/auth/register', {
      name: 'Pend', phone: `0813000${seq}`, email: `pend${seq}@x.id`,
      password: 'secret123', house: 'P1', mode: 'join', communityId: a.communityId,
    })
    const state = await call('GET', '/api/state', undefined, reg.body.token)
    expect(state.body.members).toEqual([])
  })
})

describe('privasi profil darurat', () => {
  it('warga biasa tidak melihat data medis anggota lain, satpam boleh', async () => {
    const a = await makeAdmin()
    await call('PUT', '/api/me/profile', { emergency: { bloodType: 'O' } }, a.token)
    const w = await join(a.communityId, 'warga', a.token)
    const g = await join(a.communityId, 'satpam', a.token)

    const asWarga = await call('GET', '/api/state', undefined, w.token)
    const adminSeenByWarga = asWarga.body.members.find((m: { id: string }) => m.id === a.id)
    expect(adminSeenByWarga.emergency).toBeUndefined()

    const asGuard = await call('GET', '/api/state', undefined, g.token)
    const adminSeenByGuard = asGuard.body.members.find((m: { id: string }) => m.id === a.id)
    expect(adminSeenByGuard.emergency).toEqual({ bloodType: 'O' })
  })

  it('kontak pribadi anggota lain tidak bocor', async () => {
    const a = await makeAdmin()
    const w = await join(a.communityId, 'warga', a.token)
    await call('POST', '/api/contacts', { name: 'Ibu Warga', phone: '0899', kind: 'family' }, w.token)
    const asAdmin = await call('GET', '/api/state', undefined, a.token)
    const names = asAdmin.body.contacts.map((x: { name: string }) => x.name)
    expect(names).not.toContain('Ibu Warga')
  })
})

describe('peringatan darurat', () => {
  it('menyimpan lokasi, snapshot profil dan penerima', async () => {
    const a = await makeAdmin()
    await join(a.communityId, 'satpam', a.token)
    const r = await call('POST', '/api/alerts',
      { category: 'medical', at: { lat: -6.98, lng: 107.51 }, accuracy: 10 }, a.token)
    expect(r.status).toBe(201)
    const rep = r.body.report
    expect(rep.live).toBe(true)
    expect(rep.track).toHaveLength(1)
    expect(rep.snapshot.name).toBeTruthy()
    expect(rep.recipients.length).toBeGreaterThan(0)
  })

  it('penerima di perangkat lain melihat peringatan itu', async () => {
    const a = await makeAdmin()
    const g = await join(a.communityId, 'satpam', a.token)
    await call('POST', '/api/alerts', { category: 'fire', at: { lat: 1, lng: 1 } }, a.token)
    const state = await call('GET', '/api/state', undefined, g.token)
    const live = state.body.reports.filter((x: { live: boolean }) => x.live)
    expect(live.length).toBe(1)
  })

  it('hanya pemilik yang boleh mengirim lokasi langsung', async () => {
    const a = await makeAdmin()
    const g = await join(a.communityId, 'satpam', a.token)
    const r = await call('POST', '/api/alerts', { category: 'other', at: { lat: 1, lng: 1 } }, a.token)
    const id = r.body.report.id
    expect((await call('POST', `/api/alerts/${id}/location`, { lat: 2, lng: 2 }, g.token)).status).toBe(403)
    expect((await call('POST', `/api/alerts/${id}/location`, { lat: 2, lng: 2 }, a.token)).status).toBe(200)
  })

  it('mengabaikan titik ganda dan berhenti setelah ditutup', async () => {
    const a = await makeAdmin()
    const r = await call('POST', '/api/alerts', { category: 'other', at: { lat: 1, lng: 1 } }, a.token)
    const id = r.body.report.id
    await call('POST', `/api/alerts/${id}/location`, { lat: 1, lng: 1 }, a.token)
    await call('POST', `/api/alerts/${id}/location`, { lat: 2, lng: 2 }, a.token)
    await call('POST', `/api/alerts/${id}/close`, {}, a.token)
    await call('POST', `/api/alerts/${id}/location`, { lat: 3, lng: 3 }, a.token)

    const s = await call('GET', '/api/state', undefined, a.token)
    const rep = s.body.reports.find((x: { id: string }) => x.id === id)
    expect(rep.track).toHaveLength(2)
    expect(rep.live).toBe(false)
  })

  it('mencatat siapa yang merespons', async () => {
    const a = await makeAdmin()
    const g = await join(a.communityId, 'satpam', a.token)
    const r = await call('POST', '/api/alerts', { category: 'other', at: null }, a.token)
    const id = r.body.report.id
    await call('POST', `/api/alerts/${id}/ack`, {}, g.token)
    const s = await call('GET', '/api/state', undefined, a.token)
    const rep = s.body.reports.find((x: { id: string }) => x.id === id)
    expect(rep.status).toBe('ack')
    expect(rep.responders).toContain(g.id)
  })
})

describe('ronda satpam', () => {
  async function withCheckpoint() {
    const a = await makeAdmin()
    const g = await join(a.communityId, 'satpam', a.token)
    await call('POST', '/api/checkpoints',
      { name: 'Pos 1', lat: -6.98, lng: 107.51, radiusM: 50 }, a.token)
    return { a, g }
  }

  it('menolak ronda dari luar radius dan menyebut jaraknya', async () => {
    const { g } = await withCheckpoint()
    const r = await call('POST', '/api/patrol/log', { lat: -6.99, lng: 107.53 }, g.token)
    expect(r.status).toBe(422)
    expect(r.body.error).toBe('errTooFar')
    expect(r.body.distanceM).toBeGreaterThan(50)
  })

  it('mencatat ronda saat berada di titik', async () => {
    const { g } = await withCheckpoint()
    const r = await call('POST', '/api/patrol/log', { lat: -6.98, lng: 107.51 }, g.token)
    expect(r.status).toBe(201)
    expect(r.body.log.checkpointName).toBe('Pos 1')
    expect(r.body.log.insideRadius).toBe(true)
  })

  it('mencegah dobel-catat dalam 5 menit', async () => {
    const { g } = await withCheckpoint()
    await call('POST', '/api/patrol/log', { lat: -6.98, lng: 107.51 }, g.token)
    const dup = await call('POST', '/api/patrol/log', { lat: -6.98, lng: 107.51 }, g.token)
    expect(dup.status).toBe(409)
  })

  it('warga biasa tidak boleh mencatat ronda', async () => {
    const { a } = await withCheckpoint()
    const w = await join(a.communityId, 'warga', a.token)
    const r = await call('POST', '/api/patrol/log', { lat: -6.98, lng: 107.51 }, w.token)
    expect(r.status).toBe(403)
  })

  it('admin melihat log ronda satpam', async () => {
    const { a, g } = await withCheckpoint()
    await call('POST', '/api/patrol/log', { lat: -6.98, lng: 107.51 }, g.token)
    const s = await call('GET', '/api/state', undefined, a.token)
    expect(s.body.patrolLogs).toHaveLength(1)
  })
})

describe('undangan', () => {
  it('kode undangan TETAP butuh persetujuan admin', async () => {
    const a = await makeAdmin()
    const inv = await call('POST', '/api/invites', { role: 'satpam', days: 7 }, a.token)
    const code = inv.body.invite.code
    seq += 1
    const reg = await call('POST', '/api/auth/register', {
      name: 'Undangan', phone: `0814000${seq}`, email: `inv${seq}@x.id`,
      password: 'secret123', house: 'U1', mode: 'join',
      communityId: a.communityId, inviteCode: code,
    })
    expect(reg.body.member.status).toBe('pending')
    expect(reg.body.member.role).toBe('satpam')
    expect(reg.body.member.joinMethod).toBe('invite')
  })

  it('kode dicabut tidak bisa dipakai', async () => {
    const a = await makeAdmin()
    const inv = await call('POST', '/api/invites', { role: 'warga' }, a.token)
    await call('DELETE', `/api/invites/${inv.body.invite.id}`, undefined, a.token)
    const look = await call('GET', `/api/invites/${inv.body.invite.code}`)
    expect(look.status).toBe(404)
  })

  it('warga tidak boleh membuat undangan', async () => {
    const a = await makeAdmin()
    const w = await join(a.communityId, 'warga', a.token)
    expect((await call('POST', '/api/invites', { role: 'admin' }, w.token)).status).toBe(403)
  })
})

describe('superadmin', () => {
  it('memakai sandi dari environment, bukan bawaan', async () => {
    const ok = await call('POST', '/api/auth/login', {
      identifier: 'tarafk1972@gmail.com', password: 'super-secret',
    })
    expect(ok.status).toBe(200)
    expect(ok.body.member.role).toBe('superadmin')
    const bad = await call('POST', '/api/auth/login', {
      identifier: 'tarafk1972@gmail.com', password: 'superadmin',
    })
    expect(bad.status).toBe(401)
  })
})

describe('pemulihan akses superadmin', () => {
  it('menerapkan ulang sandi dari environment pada server yang sudah punya akun', async () => {
    const { db, ensureSuperadmin, hashPassword, verifyPassword } = await import('./db.js')

    // Simulasi akun terkunci: sandi acak yang catatannya hilang.
    db.prepare('UPDATE members SET password_hash=? WHERE id=?').run(
      hashPassword('sandi-acak-yang-hilang'),
      'superadmin',
    )
    const before = db
      .prepare('SELECT password_hash h FROM members WHERE id=?')
      .get('superadmin') as { h: string }
    expect(verifyPassword('super-secret', before.h)).toBe(false)

    // Menjalankan ulang server dengan WJW_SUPERADMIN_PASSWORD memulihkan akses.
    ensureSuperadmin()
    const after = db
      .prepare('SELECT password_hash h FROM members WHERE id=?')
      .get('superadmin') as { h: string }
    expect(verifyPassword('super-secret', after.h)).toBe(true)

    const login = await call('POST', '/api/auth/login', {
      identifier: 'tarafk1972@gmail.com',
      password: 'super-secret',
    })
    expect(login.status).toBe(200)
  })

  it('reset-password mengganti sandi dan mencabut sesi lama', async () => {
    const a = await makeAdmin()
    const me = await call('GET', '/api/me', undefined, a.token)
    const email = me.body.member.email

    const { db, hashPassword } = await import('./db.js')
    const sessionsBefore = db
      .prepare('SELECT count(*) n FROM sessions WHERE member_id=?')
      .get(a.id) as { n: number }
    expect(sessionsBefore.n).toBeGreaterThan(0)

    // Yang dilakukan skrip reset-password:
    db.prepare('UPDATE members SET password_hash=? WHERE id=?').run(
      hashPassword('sandi-baru-123'),
      a.id,
    )
    db.prepare('DELETE FROM sessions WHERE member_id=?').run(a.id)

    // token lama tidak berlaku
    expect((await call('GET', '/api/me', undefined, a.token)).status).toBe(401)
    // sandi baru berhasil
    const login = await call('POST', '/api/auth/login', {
      identifier: email,
      password: 'sandi-baru-123',
    })
    expect(login.status).toBe(200)
  })
})
