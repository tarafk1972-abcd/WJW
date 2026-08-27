/**
 * Kontrak Phase 3–5: aturan server tetap berlaku jika klien diubah/dipalsukan.
 * Cakupan fokus pada KK/iuran, surat PDF, lifecycle aduan, voting/donasi,
 * assistant data-tenant, dan provisioning/suspensi SaaS.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let app: { fetch: (request: Request) => Response | Promise<Response> }
let db: import('better-sqlite3').Database
let dir = ''
let n = 0

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'wjw-community-os-'))
  process.env.WJW_DB = join(dir, 'test.sqlite')
  process.env.WJW_NO_LISTEN = '1'
  process.env.WJW_SUPERADMIN_PASSWORD = 'community-os-password'
  process.env.WJW_BASE_DOMAIN = 'wjw.test'
  process.env.WJW_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64url')
  app = (await import('./index.js')).app
  db = (await import('./db.js')).db
})

afterAll(() => {
  delete process.env.WJW_BASE_DOMAIN
  delete process.env.WJW_DATA_ENCRYPTION_KEY
  rmSync(dir, { recursive: true, force: true })
})

async function call(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
  host = 'http://apex.test',
) {
  const response = await app.fetch(new Request(`${host}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
  const text = await response.text()
  let json: unknown = null
  try { json = text ? JSON.parse(text) : null } catch { /* PDF */ }
  return { status: response.status, body: json as Record<string, any> | null, raw: text, headers: response.headers }
}

async function createFounder() {
  n += 1
  const response = await call('POST', '/api/auth/register', {
    name: `Admin OS ${n}`,
    phone: `0817${String(n).padStart(9, '0')}`,
    email: `admin-os-${n}@example.id`,
    password: 'rahasia123',
    house: 'Jl. Mawar No. 1',
    mode: 'create',
    communityName: `RW OS ${n}`,
    city: 'Bandung',
  })
  if (!response.body?.token) throw new Error(JSON.stringify(response))
  return {
    token: response.body.token as string,
    id: response.body.member.id as string,
    communityId: response.body.member.communityId as string,
  }
}

async function addResident(communityId: string, founderToken: string, house = 'Jl Mawar, No 1') {
  n += 1
  const email = `warga-os-${n}@example.id`
  const registered = await call('POST', '/api/auth/register', {
    name: `Warga OS ${n}`,
    phone: `0821${String(n).padStart(9, '0')}`,
    email,
    password: 'rahasia123',
    house,
    mode: 'join',
    communityId,
  })
  const id = registered.body?.member?.id as string
  await call('POST', `/api/members/${id}/decide`, { decision: 'accept', role: 'warga' }, founderToken)
  const login = await call('POST', '/api/auth/login', { identifier: email, password: 'rahasia123' })
  return { id, token: login.body?.token as string }
}

describe('KK, iuran, surat dan aduan', () => {
  it('menjaga satu kepala keluarga/alamat, menerbitkan iuran hanya ke kepala, dan menerbitkan PDF hanya setelah disetujui', async () => {
    const founder = await createFounder()
    const resident = await addResident(founder.communityId, founder.token)
    // Pendaftar pending dengan alamat berbeda tetap terlihat admin untuk
    // ditinjau, tetapi belum boleh menambah statistik KK/residen resmi.
    n += 1
    const pending = await call('POST', '/api/auth/register', {
      name: `Pending OS ${n}`,
      phone: `0831${String(n).padStart(9, '0')}`,
      email: `pending-os-${n}@example.id`,
      password: 'rahasia123',
      house: 'Jl Pending No. 99',
      mode: 'join',
      communityId: founder.communityId,
    })
    expect(pending.status).toBe(201)

    const population = await call('GET', '/api/population', undefined, founder.token)
    expect(population.status).toBe(200)
    expect(population.body?.summary.households).toBe(1)
    expect(population.body?.summary.residents).toBe(2)
    expect(population.body?.summary.pending).toBe(1)
    expect(population.body?.households).toHaveLength(2)
    expect(population.body?.households.some((entry: { members: { name: string; status: string }[] }) =>
      entry.members.some((member) => member.name === pending.body?.member.name && member.status === 'pending'),
    )).toBe(true)
    const household = population.body?.households.find((entry: { members: { id: string }[] }) =>
      entry.members.some((member) => member.id === founder.id),
    )
    expect(household.headMemberId).toBe(founder.id)
    expect(household.members).toHaveLength(2)

    const privacyPeer = await addResident(founder.communityId, founder.token, 'Blok Privasi 01')
    const residentState = await call('GET', '/api/state', undefined, resident.token)
    expect(residentState.headers.get('cache-control')).toContain('private')
    const peerForResident = residentState.body?.members.find((member: { id: string }) => member.id === privacyPeer.id)
    expect(peerForResident).toMatchObject({ phone: '', email: '', house: '' })
    const founderForResident = residentState.body?.members.find((member: { id: string }) => member.id === founder.id)
    // Nomor petugas/admin tetap operasional untuk koordinasi darurat, tetapi
    // alamat dan emailnya bukan cache warga umum.
    expect(founderForResident).toMatchObject({ email: '', house: '' })
    expect(founderForResident.phone).not.toBe('')
    const adminContactState = await call('GET', '/api/state', undefined, founder.token)
    const peerForAdmin = adminContactState.body?.members.find((member: { id: string }) => member.id === privacyPeer.id)
    expect(peerForAdmin).toMatchObject({
      phone: expect.any(String), email: expect.stringContaining('@'), house: 'Blok Privasi 01',
    })

    await call('PUT', '/api/dues/settings', {
      label: 'Iuran Lingkungan', amount: 50000, dueDay: 10, paymentInstructions: 'Kas RT',
    }, founder.token)
    const invalidBill = await call('POST', '/api/dues/invoices/generate', {
      period: '2026-09', memberIds: [resident.id],
    }, founder.token)
    expect(invalidBill.status).toBe(422)
    expect(invalidBill.body?.error).toBe('invalid_household_head')
    const validBill = await call('POST', '/api/dues/invoices/generate', {
      period: '2026-09', memberIds: [founder.id],
    }, founder.token)
    expect(validBill.status).toBe(201)
    expect(validBill.body?.created).toBe(1)
    // Pengalihan kepala tetap tunggal dan memindahkan hanya tagihan terbuka.
    const movedHead = await call('PUT', `/api/population/households/${household.id}/head`, { memberId: resident.id }, founder.token)
    expect(movedHead.body?.household.headMemberId).toBe(resident.id)
    expect(movedHead.body?.household.members.find((member: { id: string }) => member.id === founder.id).relationship).toBe('Anggota keluarga')
    const duesAfterHeadMove = await call('GET', '/api/dues', undefined, founder.token)
    expect(duesAfterHeadMove.body?.invoices[0].memberId).toBe(resident.id)

    const requested = await call('POST', '/api/hub/items', {
      kind: 'letter', title: 'Surat Domisili', body: 'Untuk administrasi sekolah.',
      metadata: { letterType: 'Surat Domisili', purpose: 'Administrasi sekolah' },
    }, resident.token)
    expect(requested.status).toBe(201)
    const letterId = requested.body?.item.id as string
    expect((await call('GET', `/api/hub/letters/${letterId}/pdf`, undefined, resident.token)).status).toBe(409)

    const approved = await call('POST', `/api/hub/letters/${letterId}/decision`, {
      approve: true, note: 'Data lengkap.', signerName: 'Ketua RT', signerTitle: 'Ketua RT 05',
    }, founder.token)
    expect(approved.body?.item.status).toBe('APPROVED')
    expect(approved.body?.item.metadata.letterNumber).toMatch(/^001\/WJW\//)
    const pdf = await call('GET', `/api/hub/letters/${letterId}/pdf`, undefined, resident.token)
    expect(pdf.status).toBe(200)
    expect(pdf.headers.get('content-type')).toContain('application/pdf')
    expect(pdf.raw.startsWith('%PDF-1.4')).toBe(true)

    const complaint = await call('POST', '/api/hub/items', {
      kind: 'complaint', title: 'Lampu gang mati', body: 'Lampu di depan pos mati sejak kemarin.',
      metadata: { category: 'Fasilitas', priority: 'HIGH' },
    }, resident.token)
    const complaintId = complaint.body?.item.id as string
    expect(complaint.body?.item.status).toBe('SUBMITTED')
    expect((await call('PATCH', `/api/hub/items/${complaintId}`, { status: 'RESOLVED' }, founder.token)).status).toBe(409)
    expect((await call('PATCH', `/api/hub/items/${complaintId}`, { status: 'REVIEWING', note: 'Diperiksa malam ini.' }, founder.token)).body?.item.status).toBe('REVIEWING')
    expect((await call('PATCH', `/api/hub/items/${complaintId}`, { status: 'IN_PROGRESS' }, founder.token)).body?.item.status).toBe('IN_PROGRESS')
    expect((await call('PATCH', `/api/hub/items/${complaintId}`, { status: 'RESOLVED' }, founder.token)).body?.item.status).toBe('RESOLVED')
    expect((await call('PATCH', `/api/hub/items/${complaintId}`, { status: 'CLOSED' }, founder.token)).body?.item.status).toBe('CLOSED')
  })
})

describe('partisipasi dan Assistant berbasis data tenant', () => {
  it('membatasi opsi/one-vote, menutup tenggat, menyajikan progres donasi, dan tidak mengarang jawaban', async () => {
    const founder = await createFounder()
    const resident = await addResident(founder.communityId, founder.token, 'Blok B-03')
    const deadline = Date.now() + 120_000
    const rejected = await call('POST', '/api/hub/items', {
      kind: 'poll', title: 'Terlalu banyak opsi',
      metadata: { closesAt: deadline, choices: Array.from({ length: 11 }, (_, i) => `Opsi ${i}`) },
    }, founder.token)
    expect(rejected.status).toBe(422)
    const poll = await call('POST', '/api/hub/items', {
      kind: 'poll', title: 'Pilih jadwal kerja bakti',
      metadata: { closesAt: deadline, anonymous: true, choices: ['Sabtu', 'Minggu'] },
    }, founder.token)
    const pollId = poll.body?.item.id as string
    await call('POST', `/api/hub/items/${pollId}/actions`, { action: 'vote', value: 'Sabtu' }, resident.token)
    // Bukan sekadar tombol UI: request kedua tidak boleh mengganti suara.
    expect((await call('POST', `/api/hub/items/${pollId}/actions`, { action: 'vote', value: 'Minggu' }, resident.token)).status).toBe(409)
    const listed = await call('GET', '/api/hub', undefined, founder.token)
    const item = listed.body?.items.find((entry: { id: string }) => entry.id === pollId)
    expect(item.summary.votes).toEqual({ Sabtu: 1, Minggu: 0 })
    expect(item.participants).toEqual([])

    db.prepare('UPDATE community_hub_items SET metadata=? WHERE id=?').run(
      JSON.stringify({ choices: ['Sabtu', 'Minggu'], closesAt: Date.now() - 1, anonymous: true }), pollId,
    )
    const closed = await call('GET', '/api/hub', undefined, resident.token)
    expect(closed.body?.items.find((entry: { id: string }) => entry.id === pollId).status).toBe('closed')

    const donation = await call('POST', '/api/hub/items', {
      kind: 'donation', title: 'Bantuan pos ronda',
      metadata: { targetAmount: 100000, deadline },
    }, founder.token)
    const donationId = donation.body?.item.id as string
    // Nominal kontribusi tidak dibatasi ke pilihan/paket nominal tertentu.
    await call('POST', `/api/hub/items/${donationId}/actions`, { action: 'donation', value: 1 }, resident.token)
    const afterDonation = await call('GET', '/api/hub', undefined, resident.token)
    expect(afterDonation.body?.items.find((entry: { id: string }) => entry.id === donationId).summary.contributedAmount).toBe(1)

    const arisan = await call('POST', '/api/hub/items', {
      kind: 'arisan', title: 'Arisan September', metadata: { contribution: 50000 },
    }, founder.token)
    const rukun = await call('POST', '/api/hub/items', {
      kind: 'bereavement', title: 'Rukun Kematian', metadata: { contribution: 10000 },
    }, founder.token)
    await call('POST', `/api/hub/items/${arisan.body?.item.id}/actions`, { action: 'join' }, resident.token)
    const analytics = await call('GET', '/api/hub/analytics', undefined, founder.token)
    expect(analytics.body?.analytics.engagement.arisanParticipants).toBe(1)
    expect(analytics.body?.analytics.engagement.bereavementParticipants).toBe(0)
    expect(rukun.status).toBe(201)

    const guest = await call('POST', '/api/guests', {
      name: 'Kurir Paket', purpose: 'Mengantar paket', plate: 'D 1234 ABC', idCard: '3204-aman-disimpan',
    }, founder.token)
    expect(guest.status).toBe(201)
    expect((await call('POST', '/api/guests', { name: 'Tidak berwenang' }, resident.token)).status).toBe(403)
    const guestStateForResident = await call('GET', '/api/state', undefined, resident.token)
    expect(guestStateForResident.body?.guests).toEqual([])
    const guestStateForAdmin = await call('GET', '/api/state', undefined, founder.token)
    expect(guestStateForAdmin.body?.guests?.[0]?.idCard).toBeUndefined()
    const storedGuest = db.prepare('SELECT id_card FROM guests WHERE id=?').get(guest.body?.guest.id) as { id_card: string }
    expect(storedGuest.id_card.startsWith('enc:v1:')).toBe(true)
    const guestAnswer = await call('POST', '/api/assistant', { question: 'Berapa tamu yang tercatat?' }, founder.token)
    expect(guestAnswer.body?.source).toBe('guests')
    expect(guestAnswer.body?.answer).toContain('1 kunjungan')

    // Kanal tip anonimus hanya untuk pelapor dan admin tenant. Tidak cukup
    // menyembunyikan nama: warga/satpam tidak boleh menerima catatan/foto
    // yang dapat mengungkap penulis lewat konteks.
    const ordinary = await addResident(founder.communityId, founder.token, 'Blok C-01')
    const satpam = await addResident(founder.communityId, founder.token, 'Blok C-02')
    db.prepare("UPDATE members SET role='satpam' WHERE id=?").run(satpam.id)
    const anonymousReportId = 'anon-tip-community-os'
    db.prepare(
      `INSERT INTO reports (id,community_id,author_id,kind,category,note,status,created_at,anonymous)
       VALUES (?,?,?,'tip','suspicious','Catatan yang hanya untuk admin','open',?,1)`,
    ).run(anonymousReportId, founder.communityId, resident.id, Date.now())
    const ordinaryState = await call('GET', '/api/state', undefined, ordinary.token)
    expect(ordinaryState.body?.reports.some((report: { id: string }) => report.id === anonymousReportId)).toBe(false)
    const satpamState = await call('GET', '/api/state', undefined, satpam.token)
    expect(satpamState.body?.reports.some((report: { id: string }) => report.id === anonymousReportId)).toBe(false)
    const ownerState = await call('GET', '/api/state', undefined, resident.token)
    expect(ownerState.body?.reports.find((report: { id: string }) => report.id === anonymousReportId)?.authorId).toBe(resident.id)
    const adminState = await call('GET', '/api/state', undefined, founder.token)
    expect(adminState.body?.reports.find((report: { id: string }) => report.id === anonymousReportId)?.authorId).toBe(resident.id)

    const none = await call('POST', '/api/assistant', { question: 'Siapa ketua kelas saya?' }, resident.token)
    expect(none.body?.answer).toBe('Saya tidak menemukan informasi tersebut di sistem.')
    expect(none.body?.source).toBe('none')
    const letters = await call('POST', '/api/assistant', { question: 'Bagaimana status surat saya?' }, resident.token)
    expect(letters.body?.answer).toBe('Saya tidak menemukan informasi tersebut di sistem.')
    const history = await call('GET', '/api/assistant/history', undefined, resident.token)
    expect(history.body?.entries[0].question).toBe('Bagaimana status surat saya?')
    const stored = db.prepare('SELECT question FROM assistant_history WHERE member_id=? LIMIT 1').get(resident.id) as { question: string }
    expect(stored.question.startsWith('enc:v1:')).toBe(true)
  })
})

describe('provisioning tenant dan isolasi subdomain', () => {
  it('membuat admin tenant dengan trial 14 hari, lalu dapat menyuspensi dan memisahkan login host tenant', async () => {
    const rootLogin = await call('POST', '/api/auth/login', {
      identifier: 'tarafk1972@gmail.com', password: 'community-os-password',
    })
    const root = rootLogin.body?.token as string
    const created = await call('POST', '/api/superadmin/tenants', {
      name: 'RW Subdomain', address: 'Jl. Kenanga', city: 'Bandung', subdomain: 'rw-subdomain', tier: 'PROFESSIONAL',
      adminName: 'Admin Subdomain', adminPhone: '08910000001', adminEmail: 'admin-subdomain@example.id',
      adminPassword: 'rahasia123', adminHouse: 'Blok C-1',
    }, root)
    expect(created.status).toBe(201)
    expect(created.body?.tenant.subscriptionTier).toBe('PROFESSIONAL')
    expect(created.body?.tenant.trialEndsAt).toBeGreaterThan(Date.now() + 13 * 86_400_000)
    const tenantId = created.body?.tenant.id as string
    const host = 'http://rw-subdomain.wjw.test'
    const tenantLogin = await call('POST', '/api/auth/login', {
      identifier: 'admin-subdomain@example.id', password: 'rahasia123',
    }, undefined, host)
    expect(tenantLogin.status).toBe(200)
    const token = tenantLogin.body?.token as string
    expect((await call('GET', '/api/population', undefined, token, host)).status).toBe(200)
    // Batas tier hanya berlaku untuk operasi DNS/white-label, bukan fitur
    // keselamatan atau administrasi inti tenant PROFESSIONAL.
    const brandingDenied = await call('PUT', '/api/hub/branding', {
      brandName: 'RW Subdomain', accentColor: '#2ec27e', logoUrl: '', customDomain: 'warga-contoh.id', whiteLabelRequested: false,
    }, token, host)
    expect(brandingDenied.status).toBe(403)
    expect(brandingDenied.body?.error).toBe('tier_required')
    expect((await call('PUT', '/api/hub/branding', {
      brandName: 'RW Subdomain', accentColor: '#2ec27e', logoUrl: '', customDomain: '', whiteLabelRequested: false,
    }, token, host)).status).toBe(200)
    // Token admin tenant tidak dapat dipakai pada subdomain tenant lain (host
    // tidak dikenal juga tidak dapat dipakai sebagai login endpoint).
    expect((await call('GET', '/api/population', undefined, token, 'http://other.wjw.test')).status).toBe(404)
    const suspended = await call('PUT', `/api/superadmin/tenants/${tenantId}/subscription`, {
      status: 'suspended', reason: 'Uji suspend',
    }, root)
    expect(suspended.body?.tenant.effectiveSubscriptionStatus).toBe('suspended')
    expect((await call('GET', '/api/population', undefined, token, host)).status).toBe(403)
  })
})
