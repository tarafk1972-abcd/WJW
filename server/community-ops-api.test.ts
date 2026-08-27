/**
 * Kontrak operasi komunitas: Admin 1/2/3 bukan label kosmetik. Server
 * membatasi setiap mandat, iuran tidak bercampur dengan billing SaaS, dan
 * tenant lain tidak dapat membaca/mengubah data keuangan atau patroli.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as pathJoin } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let app: { fetch: (request: Request) => Response | Promise<Response> }
let dir: string
let sequence = 0

beforeAll(async () => {
  dir = mkdtempSync(pathJoin(tmpdir(), 'wjw-community-ops-'))
  process.env.WJW_DB = pathJoin(dir, 'test.sqlite')
  process.env.WJW_NO_LISTEN = '1'
  process.env.WJW_SUPERADMIN_PASSWORD = 'test-only-password'
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

async function superadmin() {
  const loggedIn = await call('POST', '/api/auth/login', {
    identifier: 'tarafk1972@gmail.com',
    password: 'test-only-password',
  })
  if (!loggedIn.body?.token) throw new Error(`login superadmin gagal: ${JSON.stringify(loggedIn)}`)
  return { token: loggedIn.body.token as string }
}

async function founder() {
  sequence += 1
  const registered = await call('POST', '/api/auth/register', {
    name: `Pendiri ${sequence}`,
    phone: `0819${String(sequence).padStart(9, '0')}`,
    email: `founder-${sequence}@ops.id`,
    password: 'rahasia123',
    house: 'A-01',
    mode: 'create',
    communityName: `Komunitas Operasi ${sequence}`,
  })
  if (!registered.body?.token) throw new Error(JSON.stringify(registered))
  return {
    id: registered.body.member.id as string,
    communityId: registered.body.member.communityId as string,
    token: registered.body.token as string,
  }
}

async function joinMember(
  communityId: string,
  founderToken: string,
  role: 'admin' | 'satpam' | 'warga',
) {
  sequence += 1
  const email = `member-${sequence}@ops.id`
  const registered = await call('POST', '/api/auth/register', {
    name: `Anggota ${sequence}`,
    phone: `0828${String(sequence).padStart(9, '0')}`,
    email,
    password: 'rahasia123',
    house: `Blok B-${sequence}`,
    mode: 'join',
    communityId,
  })
  const id = registered.body.member.id as string
  expect(
    (await call('POST', `/api/members/${id}/decide`, { decision: 'accept', role }, founderToken)).status,
  ).toBe(200)
  const loggedIn = await call('POST', '/api/auth/login', {
    identifier: email,
    password: 'rahasia123',
  })
  return { id, token: loggedIn.body.token as string }
}

describe('mandat Admin 1 dan Admin 3', () => {
  it('membatasi peta/titik pantau dan jadwal patroli pada admin yang ditugaskan', async () => {
    const owner = await founder()
    const mapAdmin = await joinMember(owner.communityId, owner.token, 'admin')
    const scheduleAdmin = await joinMember(owner.communityId, owner.token, 'admin')
    const guard = await joinMember(owner.communityId, owner.token, 'satpam')
    const otherGuard = await joinMember(owner.communityId, owner.token, 'satpam')

    const assignedMap = await call(
      'PUT',
      '/api/management-responsibilities/map_patrol',
      { memberId: mapAdmin.id },
      owner.token,
    )
    expect(assignedMap.status).toBe(200)
    expect(
      (await call(
        'PUT',
        '/api/management-responsibilities/patrol_schedule',
        { memberId: scheduleAdmin.id },
        owner.token,
      )).status,
    ).toBe(200)
    // Konsol superadmin dapat memperbaiki penugasan tenant tertentu tanpa
    // menjadi anggota tenant tersebut; target tenant harus eksplisit.
    const root = await superadmin()
    expect(
      (await call(
        'PUT',
        '/api/management-responsibilities/patrol_schedule',
        { memberId: scheduleAdmin.id, communityId: owner.communityId },
        root.token,
      )).status,
    ).toBe(200)

    // Admin 1 dapat mengubah batas dan titik pantau, bukan jadwal.
    expect(
      (await call(
        'PUT',
        '/api/community/area',
        {
          area: [
            { lat: -6.9, lng: 107.6 },
            { lat: -6.91, lng: 107.61 },
            { lat: -6.92, lng: 107.6 },
          ],
        },
        mapAdmin.token,
      )).status,
    ).toBe(200)
    const checkpoint = await call(
      'POST',
      '/api/checkpoints',
      { name: 'Pos Gerbang', lat: -6.9, lng: 107.6, radiusM: 40 },
      mapAdmin.token,
    )
    expect(checkpoint.status).toBe(201)
    expect(
      (await call(
        'POST',
        '/api/schedules',
        { label: 'Ronda malam', startMinute: 1320, endMinute: 60, days: [], satpamIds: [guard.id] },
        mapAdmin.token,
      )).status,
    ).toBe(403)

    // Admin 3 dapat menjadwalkan satpam yang berada di tenant yang sama,
    // tetapi tidak dapat menggeser titik pantau.
    expect(
      (await call(
        'POST',
        '/api/checkpoints',
        { name: 'Pos lain', lat: -6.91, lng: 107.61, radiusM: 40 },
        scheduleAdmin.token,
      )).status,
    ).toBe(403)
    const scheduled = await call(
      'POST',
      '/api/schedules',
      // start=end berarti shift 24 jam: membuat kontrak filter assignee tidak
      // bergantung pada jam saat runner test berjalan.
      { label: 'Ronda khusus', startMinute: 0, endMinute: 0, days: [], graceMin: 15, satpamIds: [guard.id] },
      scheduleAdmin.token,
    )
    expect(scheduled.status).toBe(201)

    // Server, bukan sekadar UI, hanya mencocokkan shift ini untuk satpam
    // yang ditugaskan. Keduanya berdiri di titik pantau yang sama.
    const assignedLog = await call(
      'POST',
      '/api/patrol/log',
      { lat: -6.9, lng: 107.6, accuracy: 5 },
      guard.token,
    )
    expect(assignedLog.status).toBe(201)
    expect(assignedLog.body.log.scheduleId).toBe(scheduled.body.id)
    const unassignedLog = await call(
      'POST',
      '/api/patrol/log',
      { lat: -6.9, lng: 107.6, accuracy: 5 },
      otherGuard.token,
    )
    expect(unassignedLog.status).toBe(201)
    expect(unassignedLog.body.log.scheduleId).toBeNull()
    expect(unassignedLog.body.log.status).toBe('offschedule')

    const state = await call('GET', '/api/state', undefined, guard.token)
    expect(state.body.managementResponsibilities.find((x: { scope: string }) => x.scope === 'map_patrol').memberId).toBe(mapAdmin.id)
    expect(state.body.schedules[0].assignedSatpamIds).toEqual([guard.id])
  })
})

describe('iuran pengelolaan oleh Admin 2', () => {
  it('mengisolasi rincian tagihan, melacak claim/verifikasi, dan menolak tenant/admin tanpa mandat', async () => {
    const owner = await founder()
    const duesAdmin = await joinMember(owner.communityId, owner.token, 'admin')
    const mapAdmin = await joinMember(owner.communityId, owner.token, 'admin')
    const scheduleAdmin = await joinMember(owner.communityId, owner.token, 'admin')
    const otherAdmin = await joinMember(owner.communityId, owner.token, 'admin')
    const residentA = await joinMember(owner.communityId, owner.token, 'warga')
    const residentB = await joinMember(owner.communityId, owner.token, 'warga')
    const otherTenant = await founder()

    expect(
      (await call(
        'PUT',
        '/api/management-responsibilities/dues',
        { memberId: duesAdmin.id },
        owner.token,
      )).status,
    ).toBe(200)
    expect(
      (await call(
        'PUT',
        '/api/management-responsibilities/map_patrol',
        { memberId: mapAdmin.id },
        owner.token,
      )).status,
    ).toBe(200)
    expect(
      (await call(
        'PUT',
        '/api/management-responsibilities/patrol_schedule',
        { memberId: scheduleAdmin.id },
        owner.token,
      )).status,
    ).toBe(200)

    // Admin biasa bukan Admin 2: tidak boleh mengubah pengaturan/menagih.
    expect(
      (await call(
        'PUT',
        '/api/dues/settings',
        { label: 'IPL', amount: 150000, dueDay: 10 },
        otherAdmin.token,
      )).status,
    ).toBe(403)

    expect(
      (await call(
        'PUT',
        '/api/dues/settings',
        {
          label: 'Iuran Pengelolaan Lingkungan',
          amount: 150000,
          dueDay: 10,
          paymentInstructions: 'Transfer ke rekening kas lalu tulis nomor referensi.',
        },
        duesAdmin.token,
      )).status,
    ).toBe(200)

    const generated = await call(
      'POST',
      '/api/dues/invoices/generate',
      { period: '2026-09', memberIds: [residentA.id, residentB.id] },
      duesAdmin.token,
    )
    expect(generated.status).toBe(201)
    expect(generated.body.created).toBe(2)
    // Hak Admin 1/Admin 3 tidak boleh menjadi pintu samping ke total iuran
    // lewat jawaban natural-language Assistant.
    for (const token of [mapAdmin.token, scheduleAdmin.token, otherAdmin.token]) {
      const answer = await call('POST', '/api/assistant', { question: 'Berapa total iuran lingkungan?' }, token)
      expect(answer.body.source).toBe('none')
      expect(answer.body.answer).toBe('Saya tidak menemukan informasi tersebut di sistem.')
    }
    const duesAnswer = await call('POST', '/api/assistant', { question: 'Berapa total iuran lingkungan?' }, duesAdmin.token)
    expect(duesAnswer).toMatchObject({ status: 200, body: { source: 'dues' } })
    expect(duesAnswer.body.answer).toMatch(/Rp\s?300\.000/)

    const residentState = await call('GET', '/api/dues', undefined, residentA.token)
    expect(residentState.status).toBe(200)
    expect(residentState.body.canManage).toBe(false)
    expect(residentState.body.members).toEqual([])
    expect(residentState.body.invoices).toHaveLength(1)
    expect(residentState.body.invoices[0].memberName).toBeUndefined()
    // Total seluruh tenant adalah Rp300.000, tetapi warga hanya dapat melihat
    // agregat dari tagihan Rp150.000 miliknya sendiri.
    expect(residentState.body.summary).toMatchObject({ billed: 150000, invoices: 1 })

    const invoiceId = residentState.body.invoices[0].id as string
    expect(
      (await call('POST', `/api/dues/${invoiceId}/claim`, { paymentNote: 'Transfer 9 Sept, bank pengirim.' }, residentA.token)).status,
    ).toBe(200)
    // Tombol/permintaan ulang tidak menciptakan dua transisi claim.
    expect(
      (await call('POST', `/api/dues/${invoiceId}/claim`, { paymentNote: 'Klaim ulang' }, residentA.token)).status,
    ).toBe(409)
    expect(
      (await call('POST', `/api/dues/${invoiceId}/verify`, { approve: true }, otherAdmin.token)).status,
    ).toBe(403)
    expect(
      (await call('POST', `/api/dues/${invoiceId}/verify`, { approve: true }, otherTenant.token)).status,
    ).toBe(403)
    expect(
      (await call('POST', `/api/dues/${invoiceId}/verify`, { approve: true, note: 'Mutasi cocok.' }, duesAdmin.token)).status,
    ).toBe(200)
    expect(
      (await call('POST', `/api/dues/${invoiceId}/verify`, { approve: true }, duesAdmin.token)).status,
    ).toBe(409)

    const managerState = await call('GET', '/api/dues', undefined, duesAdmin.token)
    const paid = managerState.body.invoices.find((invoice: { id: string }) => invoice.id === invoiceId)
    expect(paid.status).toBe('paid')
    expect(paid.memberName).toBeDefined()
    expect(managerState.body.summary.paid).toBe(150000)
  })
})
