/**
 * Tes penagihan lewat email + verifikasi manual superadmin.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as pathJoin } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

let app: { fetch: (r: Request) => Response | Promise<Response> }
let db: import('better-sqlite3').Database

const DAY = 86_400_000

beforeAll(async () => {
  process.env.WJW_DB = pathJoin(mkdtempSync(pathJoin(tmpdir(), 'wjw-bill-')), 't.sqlite')
  process.env.WJW_NO_LISTEN = '1'
  process.env.WJW_SUPERADMIN_PASSWORD = 'super-secret'
  process.env.WJW_BANK_INFO = 'BCA 1234567890 a.n. Yayasan Uji'
  app = (await import('./index.js')).app
  db = (await import('./db.js')).db
})

async function call(m: string, p: string, b?: unknown, t?: string) {
  const r = await app.fetch(
    new Request('http://x' + p, {
      method: m,
      headers: {
        'content-type': 'application/json',
        ...(t ? { Authorization: `Bearer ${t}` } : {}),
      },
      body: b === undefined ? undefined : JSON.stringify(b),
    }),
  )
  const x = await r.text()
  return { status: r.status, body: x ? JSON.parse(x) : null }
}

async function superToken() {
  const r = await call('POST', '/api/auth/login', {
    identifier: 'tarafk1972@gmail.com',
    password: 'super-secret',
  })
  return r.body.token as string
}

let seq = 0
async function makeAdmin() {
  seq += 1
  const email = `bill${seq}@x.id`
  const r = await call('POST', '/api/auth/register', {
    name: `Admin${seq}`,
    phone: `0819${String(seq).padStart(9, '0')}`,
    email,
    password: 'secret123',
    house: 'A1',
    mode: 'create',
    communityName: `RW Bill ${seq}`,
  })
  return {
    token: r.body.token as string,
    id: r.body.member.id as string,
    communityId: r.body.member.communityId as string,
    email,
  }
}

describe('membuat tagihan', () => {
  it('menyimpan tagihan pending dan mencatat email tagihan', async () => {
    const a = await makeAdmin()
    const r = await call('POST', '/api/billing/checkout', { plan: 'monthly' }, a.token)

    expect(r.status).toBe(201)
    expect(r.body.invoice.status).toBe('pending')
    expect(r.body.invoice.amount).toBe(149000)
    // hanya huruf/angka setelah awalan — tanpa tanda hubung ganda
    expect(r.body.invoice.invoiceNo).toMatch(/^WJW-\d{6}-[A-Z0-9]{5}$/)

    const mail = db
      .prepare("SELECT to_email, kind FROM emails WHERE community_id=? AND kind='bill'")
      .get(a.communityId) as { to_email: string; kind: string }
    expect(mail.to_email).toBe(a.email)
  })

  it('membagikan info rekening lewat GET /api/billing', async () => {
    const a = await makeAdmin()
    const r = await call('GET', '/api/billing', undefined, a.token)
    expect(r.body.bankInfo).toContain('BCA 1234567890')
    expect(r.body.prices.monthly).toBe(149000)
    expect(r.body.prices.yearly).toBe(1490000)
  })

  it('memakai ulang tagihan berjalan, tidak membuat dua kali', async () => {
    const a = await makeAdmin()
    const r1 = await call('POST', '/api/billing/checkout', { plan: 'monthly' }, a.token)
    const r2 = await call('POST', '/api/billing/checkout', { plan: 'yearly' }, a.token)

    expect(r2.body.reused).toBe(true)
    expect(r2.body.invoice.id).toBe(r1.body.invoice.id)

    const n = db
      .prepare('SELECT count(*) n FROM invoices WHERE community_id=?')
      .get(a.communityId) as { n: number }
    expect(n.n).toBe(1)
  })

  it('warga biasa tidak boleh membuat tagihan', async () => {
    const a = await makeAdmin()
    seq += 1
    const w = await call('POST', '/api/auth/register', {
      name: 'W',
      phone: `0818${String(seq).padStart(9, '0')}`,
      email: `w${seq}@x.id`,
      password: 'secret123',
      house: 'B',
      mode: 'join',
      communityId: a.communityId,
    })
    await call(
      'POST',
      `/api/members/${w.body.member.id}/decide`,
      { decision: 'accept', role: 'warga' },
      a.token,
    )
    const login = await call('POST', '/api/auth/login', {
      identifier: `w${seq}@x.id`,
      password: 'secret123',
    })
    const r = await call(
      'POST',
      '/api/billing/checkout',
      { plan: 'monthly' },
      login.body.token,
    )
    expect(r.status).toBe(403)
  })
})

describe('konfirmasi pembayaran oleh admin', () => {
  it('menandai sudah bayar tanpa mengaktifkan langganan', async () => {
    const a = await makeAdmin()
    const inv = await call('POST', '/api/billing/checkout', { plan: 'monthly' }, a.token)

    const r = await call(
      'POST',
      `/api/billing/${inv.body.invoice.id}/claim`,
      { reference: '4821' },
      a.token,
    )
    expect(r.status).toBe(200)

    const row = db
      .prepare('SELECT status, reference FROM invoices WHERE id=?')
      .get(inv.body.invoice.id) as { status: string; reference: string }
    expect(row.status).toBe('awaiting_verification')
    expect(row.reference).toBe('4821')

    // langganan BELUM aktif — superadmin yang memutuskan
    const com = db
      .prepare('SELECT plan, paid_until FROM communities WHERE id=?')
      .get(a.communityId) as { plan: string; paid_until: number | null }
    expect(com.plan).toBe('trial')
    expect(com.paid_until).toBeNull()
  })

  it('menolak klaim tanpa nomor rujukan', async () => {
    const a = await makeAdmin()
    const inv = await call('POST', '/api/billing/checkout', { plan: 'monthly' }, a.token)
    const r = await call(
      'POST',
      `/api/billing/${inv.body.invoice.id}/claim`,
      { reference: '  ' },
      a.token,
    )
    expect(r.status).toBe(400)
  })

  it('admin lain tidak bisa mengklaim tagihan bukan miliknya', async () => {
    const a = await makeAdmin()
    const b = await makeAdmin()
    const inv = await call('POST', '/api/billing/checkout', { plan: 'monthly' }, a.token)
    const r = await call(
      'POST',
      `/api/billing/${inv.body.invoice.id}/claim`,
      { reference: '1' },
      b.token,
    )
    expect(r.status).toBe(403)
  })
})

describe('verifikasi oleh superadmin', () => {
  async function claimed() {
    const a = await makeAdmin()
    const inv = await call('POST', '/api/billing/checkout', { plan: 'monthly' }, a.token)
    await call(
      'POST',
      `/api/billing/${inv.body.invoice.id}/claim`,
      { reference: '9911' },
      a.token,
    )
    return { admin: a, invoiceId: inv.body.invoice.id as string }
  }

  it('mencantumkan tagihan yang menunggu verifikasi', async () => {
    const { admin, invoiceId } = await claimed()
    const st = await superToken()
    const r = await call('GET', '/api/billing/pending', undefined, st)

    const found = r.body.invoices.find((i: { id: string }) => i.id === invoiceId)
    expect(found).toBeTruthy()
    expect(found.memberEmail).toBe(admin.email)
    expect(found.reference).toBe('9911')
  })

  it('menyetujui pembayaran mengaktifkan langganan dan mengirim kuitansi', async () => {
    const { admin, invoiceId } = await claimed()
    const st = await superToken()

    const r = await call('POST', `/api/billing/${invoiceId}/verify`, { approve: true }, st)
    expect(r.body.approved).toBe(true)

    const com = db
      .prepare('SELECT plan, paid_until FROM communities WHERE id=?')
      .get(admin.communityId) as { plan: string; paid_until: number }
    expect(com.plan).toBe('active')
    expect(com.paid_until).toBeGreaterThan(Date.now())

    const mail = db
      .prepare("SELECT kind FROM emails WHERE community_id=? AND kind='paid'")
      .get(admin.communityId)
    expect(mail).toBeTruthy()
  })

  it('menolak klaim mengembalikan tagihan ke pending dengan catatan', async () => {
    const { admin, invoiceId } = await claimed()
    const st = await superToken()

    await call(
      'POST',
      `/api/billing/${invoiceId}/verify`,
      { approve: false, note: 'Bukti transfer tidak jelas' },
      st,
    )

    const row = db
      .prepare('SELECT status, note FROM invoices WHERE id=?')
      .get(invoiceId) as { status: string; note: string }
    expect(row.status).toBe('pending')
    expect(row.note).toBe('Bukti transfer tidak jelas')

    // langganan tetap belum aktif
    const com = db
      .prepare('SELECT plan FROM communities WHERE id=?')
      .get(admin.communityId) as { plan: string }
    expect(com.plan).toBe('trial')
  })

  it('perpanjangan menambah dari tanggal berakhir, bukan hari ini', async () => {
    const { admin, invoiceId } = await claimed()
    const st = await superToken()
    await call('POST', `/api/billing/${invoiceId}/verify`, { approve: true }, st)

    const first = db
      .prepare('SELECT paid_until FROM communities WHERE id=?')
      .get(admin.communityId) as { paid_until: number }

    // bayar lagi sebelum habis
    const inv2 = await call(
      'POST',
      '/api/billing/checkout',
      { plan: 'monthly' },
      admin.token,
    )
    await call(
      'POST',
      `/api/billing/${inv2.body.invoice.id}/claim`,
      { reference: '2' },
      admin.token,
    )
    await call('POST', `/api/billing/${inv2.body.invoice.id}/verify`, { approve: true }, st)

    const second = db
      .prepare('SELECT paid_until FROM communities WHERE id=?')
      .get(admin.communityId) as { paid_until: number }
    const added = Math.round((second.paid_until - first.paid_until) / DAY)
    expect(added).toBe(30) // sisa masa aktif tidak hangus
  })

  it('admin biasa tidak boleh memverifikasi', async () => {
    const { admin, invoiceId } = await claimed()
    const r = await call(
      'POST',
      `/api/billing/${invoiceId}/verify`,
      { approve: true },
      admin.token,
    )
    expect(r.status).toBe(403)
  })

  it('tidak bisa memverifikasi dua kali', async () => {
    const { invoiceId } = await claimed()
    const st = await superToken()
    await call('POST', `/api/billing/${invoiceId}/verify`, { approve: true }, st)
    const again = await call(
      'POST',
      `/api/billing/${invoiceId}/verify`,
      { approve: true },
      st,
    )
    expect(again.status).toBe(400)
  })
})
