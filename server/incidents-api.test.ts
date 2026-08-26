/**
 * Kontrak Phase 1 SOS: retry tidak menduplikasi insiden, lifecycle selalu
 * legal, dan data sensitif tidak keluar dari tenant/peserta yang salah.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let app: { fetch: (req: Request) => Response | Promise<Response> }
let dir: string
let seq = 0

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'wjw-incident-'))
  process.env.WJW_DB = join(dir, 'test.sqlite')
  process.env.WJW_SUPERADMIN_PASSWORD = 'not-used-in-test'
  process.env.WJW_NO_LISTEN = '1'
  app = (await import('./index.js')).app
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

async function call(method: string, path: string, body?: unknown, token?: string) {
  const response = await app.fetch(
    new Request(`http://test${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

async function admin() {
  seq += 1
  const result = await call('POST', '/api/auth/register', {
    name: `Admin insiden ${seq}`,
    phone: `0818${String(seq).padStart(9, '0')}`,
    email: `incident-admin-${seq}@x.id`,
    password: 'rahasia123',
    house: 'A-01',
    mode: 'create',
    communityName: `RW Incident ${seq}`,
  })
  if (!result.body?.token) throw new Error(JSON.stringify(result))
  return {
    id: result.body.member.id as string,
    communityId: result.body.member.communityId as string,
    token: result.body.token as string,
  }
}

async function member(communityId: string, adminToken: string, role: 'warga' | 'satpam') {
  seq += 1
  const email = `incident-user-${seq}@x.id`
  const registered = await call('POST', '/api/auth/register', {
    name: `Warga insiden ${seq}`,
    phone: `0828${String(seq).padStart(9, '0')}`,
    email,
    password: 'rahasia123',
    house: `B-${seq}`,
    mode: 'join',
    communityId,
  })
  const id = registered.body.member.id as string
  expect((await call('POST', `/api/members/${id}/decide`, { decision: 'accept', role }, adminToken)).status).toBe(200)
  const loggedIn = await call('POST', '/api/auth/login', { identifier: email, password: 'rahasia123' })
  if (!loggedIn.body?.token) throw new Error(`login member gagal: ${JSON.stringify(loggedIn)}`)
  return { id, token: loggedIn.body.token as string }
}

async function raise(token: string, key: string) {
  return call(
    'POST',
    '/api/alerts',
    {
      category: 'medical',
      at: { lat: -6.914744, lng: 107.60981 },
      accuracy: 12,
      idempotencyKey: key,
    },
    token,
  )
}

describe('lifecycle SOS', () => {
  it('menggunakan idempotency key agar retry tidak menciptakan dua SOS', async () => {
    const a = await admin()
    const key = `retry-${Date.now()}-abcdef`
    const first = await raise(a.token, key)
    const second = await raise(a.token, key)

    expect(first.status).toBe(201)
    expect(second.status).toBe(200)
    expect(second.body.reused).toBe(true)
    expect(second.body.report.id).toBe(first.body.report.id)

    const { db } = await import('./db.js')
    const count = db
      .prepare("SELECT count(*) AS n FROM reports WHERE author_id=? AND idempotency_key=?")
      .get(a.id, key) as { n: number }
    expect(count.n).toBe(1)
  })

  it('mencatat NEW → ACKNOWLEDGED → RESPONDING → ON_SITE → RESOLVED secara immutable', async () => {
    const a = await admin()
    const guard = await member(a.communityId, a.token, 'satpam')
    const created = await raise(a.token, `lifecycle-${Date.now()}-abcdef`)
    const id = created.body.report.id as string

    expect((await call('POST', `/api/alerts/${id}/respond`, {}, guard.token)).status).toBe(200)
    expect((await call('POST', `/api/alerts/${id}/status`, { status: 'ON_SITE' }, guard.token)).status).toBe(200)
    expect((await call('POST', `/api/alerts/${id}/status`, { status: 'RESOLVED' }, guard.token)).status).toBe(200)

    const state = await call('GET', '/api/state', undefined, guard.token)
    const report = state.body.reports.find((row: { id: string }) => row.id === id)
    expect(report.incidentStatus).toBe('RESOLVED')
    expect(report.status).toBe('resolved')
    expect(report.responders).toContain(guard.id)
    expect(report.timeline.map((entry: { toStatus: string | null }) => entry.toStatus)).toEqual([
      'NEW',
      'ACKNOWLEDGED',
      'RESPONDING',
      'ON_SITE',
      'RESOLVED',
    ])

    // Status terminal tidak dapat kembali menjadi status aktif.
    const backwards = await call('POST', `/api/alerts/${id}/status`, { status: 'RESPONDING' }, guard.token)
    expect(backwards.status).toBe(409)
    expect(backwards.body.error).toBe('invalid_transition')
  })

  it('menyembunyikan lokasi, profil snapshot, bukti, dan timeline dari warga bukan peserta', async () => {
    const a = await admin()
    const bystander = await member(a.communityId, a.token, 'warga')
    const created = await raise(a.token, `privacy-${Date.now()}-abcdef`)
    const id = created.body.report.id as string

    const theirs = await call('GET', '/api/state', undefined, bystander.token)
    const hidden = theirs.body.reports.find((row: { id: string }) => row.id === id)
    expect(hidden.at).toBeNull()
    expect(hidden.address).toBe('')
    expect(hidden.snapshot).toBeNull()
    expect(hidden.track).toEqual([])
    expect(hidden.attachments).toEqual([])
    expect(hidden.messages).toEqual([])
    expect(hidden.timeline).toEqual([])
  })

  it('menolak admin tenant lain membaca atau mengubah SOS', async () => {
    const owner = await admin()
    const otherTenant = await admin()
    const created = await raise(owner.token, `tenant-${Date.now()}-abcdef`)
    const id = created.body.report.id as string

    expect((await call('POST', `/api/alerts/${id}/respond`, {}, otherTenant.token)).status).toBe(403)
    expect(
      (await call('POST', `/api/alerts/${id}/status`, { status: 'RESOLVED' }, otherTenant.token)).status,
    ).toBe(403)
    expect((await call('POST', `/api/alerts/${id}/close`, {}, otherTenant.token)).status).toBe(403)
  })
})
