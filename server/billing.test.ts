/**
 * Tes penagihan Mayar. Panggilan ke Mayar di-mock; tidak ada jaringan nyata.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as pathJoin } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

let app: { fetch: (r: Request) => Response | Promise<Response> }
let db: import('better-sqlite3').Database

const TOKEN = 'rahasia-webhook'

beforeAll(async () => {
  process.env.WJW_DB = pathJoin(mkdtempSync(pathJoin(tmpdir(), 'wjw-bill-')), 't.sqlite')
  process.env.WJW_NO_LISTEN = '1'
  process.env.MAYAR_API_KEY = 'kunci-uji'
  process.env.MAYAR_WEBHOOK_TOKEN = TOKEN
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

let seq = 0
async function makeAdmin() {
  seq += 1
  const r = await call('POST', '/api/auth/register', {
    name: `Admin${seq}`,
    phone: `0819${String(seq).padStart(9, '0')}`,
    email: `bill${seq}@x.id`,
    password: 'secret123',
    house: 'A1',
    mode: 'create',
    communityName: `RW Bill ${seq}`,
  })
  return {
    token: r.body.token as string,
    id: r.body.member.id as string,
    communityId: r.body.member.communityId as string,
    email: `bill${seq}@x.id`,
  }
}

/** Mock balasan Mayar untuk pembuatan invoice. */
function mockMayar(over: Partial<Record<string, unknown>> = {}) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        statusCode: 200,
        messages: 'success',
        data: {
          id: 'mayar-inv-1',
          transactionId: 'mayar-txn-1',
          link: 'https://toko.mayar.shop/invoices/abc123',
          expiredAt: Date.now() + 7 * 86400000,
          ...over,
        },
      }),
      { status: 200 },
    ),
  )
}

beforeEach(() => vi.restoreAllMocks())

describe('membuat tagihan', () => {
  it('menyimpan tagihan pending dan mengembalikan tautan pembayaran', async () => {
    const a = await makeAdmin()
    const spy = mockMayar()
    const r = await call('POST', '/api/billing/checkout', { plan: 'monthly' }, a.token)
    spy.mockRestore()

    expect(r.status).toBe(201)
    expect(r.body.invoice.status).toBe('pending')
    expect(r.body.invoice.payUrl).toContain('mayar.shop')
    expect(r.body.invoice.amount).toBe(149000)
  })

  it('mengirim data yang benar ke Mayar', async () => {
    const a = await makeAdmin()
    const spy = mockMayar()
    await call('POST', '/api/billing/checkout', { plan: 'yearly' }, a.token)

    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toContain('/invoice/create')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer kunci-uji')
    const sent = JSON.parse(init.body as string)
    expect(sent.email).toBe(a.email)
    expect(sent.items[0].rate).toBe(1490000)
    // extraData dipakai untuk mencocokkan webhook
    expect(sent.extraData.communityId).toBe(a.communityId)
    expect(sent.extraData.invoiceId).toBeTruthy()
    spy.mockRestore()
  })

  it('memakai ulang tagihan pending, tidak membuat dua kali', async () => {
    const a = await makeAdmin()
    const s1 = mockMayar()
    const r1 = await call('POST', '/api/billing/checkout', { plan: 'monthly' }, a.token)
    s1.mockRestore()

    const s2 = mockMayar()
    const r2 = await call('POST', '/api/billing/checkout', { plan: 'monthly' }, a.token)
    expect(s2).not.toHaveBeenCalled() // Mayar tidak dipanggil lagi
    s2.mockRestore()

    expect(r2.body.reused).toBe(true)
    expect(r2.body.invoice.id).toBe(r1.body.invoice.id)
  })

  it('warga biasa tidak boleh membuat tagihan', async () => {
    const a = await makeAdmin()
    seq += 1
    const w = await call('POST', '/api/auth/register', {
      name: 'W', phone: `0818${String(seq).padStart(9, '0')}`, email: `w${seq}@x.id`,
      password: 'secret123', house: 'B', mode: 'join', communityId: a.communityId,
    })
    await call('POST', `/api/members/${w.body.member.id}/decide`,
      { decision: 'accept', role: 'warga' }, a.token)
    const login = await call('POST', '/api/auth/login',
      { identifier: `w${seq}@x.id`, password: 'secret123' })

    const r = await call('POST', '/api/billing/checkout', { plan: 'monthly' }, login.body.token)
    expect(r.status).toBe(403)
  })

  it('menandai tagihan gagal bila Mayar error, bukan meninggalkan pending menggantung', async () => {
    const a = await makeAdmin()
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"messages":"invalid key"}', { status: 401 }))
    const r = await call('POST', '/api/billing/checkout', { plan: 'monthly' }, a.token)
    spy.mockRestore()

    expect(r.status).toBe(502)
    const row = db
      .prepare('SELECT status FROM invoices WHERE community_id=?')
      .get(a.communityId) as { status: string }
    expect(row.status).toBe('failed')
  })
})

describe('webhook Mayar', () => {
  async function pendingInvoice() {
    const a = await makeAdmin()
    const spy = mockMayar({
      id: `mid-${seq}`,
      transactionId: `txn-${seq}`,
      link: 'https://toko.mayar.shop/invoices/x',
    })
    const r = await call('POST', '/api/billing/checkout', { plan: 'monthly' }, a.token)
    spy.mockRestore()
    return { admin: a, invoiceId: r.body.invoice.id as string, txn: `txn-${seq}` }
  }

  it('menolak webhook tanpa token yang benar', async () => {
    const r = await call('POST', '/api/webhooks/mayar', { event: 'payment.received' })
    expect(r.status).toBe(401)
  })

  it('mengaktifkan langganan saat pembayaran diterima', async () => {
    const { admin, invoiceId, txn } = await pendingInvoice()

    const before = db
      .prepare('SELECT plan, paid_until FROM communities WHERE id=?')
      .get(admin.communityId) as { plan: string; paid_until: number | null }
    expect(before.plan).toBe('trial')
    expect(before.paid_until).toBeNull()

    const r = await call('POST', `/api/webhooks/mayar?token=${TOKEN}`, {
      event: 'payment.received',
      data: { transactionId: txn, status: 'paid', extraData: { invoiceId } },
    })
    expect(r.status).toBe(200)

    const after = db
      .prepare('SELECT plan, paid_until FROM communities WHERE id=?')
      .get(admin.communityId) as { plan: string; paid_until: number }
    expect(after.plan).toBe('active')
    expect(after.paid_until).toBeGreaterThan(Date.now())

    const inv = db
      .prepare('SELECT status, paid_at FROM invoices WHERE id=?')
      .get(invoiceId) as { status: string; paid_at: number }
    expect(inv.status).toBe('paid')
    expect(inv.paid_at).toBeGreaterThan(0)
  })

  it('tidak memproses kejadian yang sama dua kali', async () => {
    const { admin, invoiceId, txn } = await pendingInvoice()
    const body = {
      event: 'payment.received',
      data: { transactionId: txn, status: 'paid', extraData: { invoiceId } },
    }
    await call('POST', `/api/webhooks/mayar?token=${TOKEN}`, body)
    const first = db
      .prepare('SELECT paid_until FROM communities WHERE id=?')
      .get(admin.communityId) as { paid_until: number }

    const dup = await call('POST', `/api/webhooks/mayar?token=${TOKEN}`, body)
    expect(dup.body.duplicate).toBe(true)

    const second = db
      .prepare('SELECT paid_until FROM communities WHERE id=?')
      .get(admin.communityId) as { paid_until: number }
    // masa aktif tidak bertambah dua kali
    expect(second.paid_until).toBe(first.paid_until)
  })

  it('mengabaikan pembayaran yang belum lunas', async () => {
    const { admin, invoiceId, txn } = await pendingInvoice()
    await call('POST', `/api/webhooks/mayar?token=${TOKEN}`, {
      event: 'payment.received',
      data: { transactionId: txn, status: 'pending', extraData: { invoiceId } },
    })
    const c = db
      .prepare('SELECT plan FROM communities WHERE id=?')
      .get(admin.communityId) as { plan: string }
    expect(c.plan).toBe('trial')
  })

  it('mencocokkan lewat email bila id tidak cocok', async () => {
    const { admin } = await pendingInvoice()
    await call('POST', `/api/webhooks/mayar?token=${TOKEN}`, {
      event: 'payment.received',
      data: { transactionId: 'id-yang-berbeda', status: 'paid', customerEmail: admin.email },
    })
    const c = db
      .prepare('SELECT plan FROM communities WHERE id=?')
      .get(admin.communityId) as { plan: string }
    expect(c.plan).toBe('active')
  })

  it('perpanjangan menambah dari tanggal berakhir, bukan dari hari ini', async () => {
    const { admin, invoiceId, txn } = await pendingInvoice()
    await call('POST', `/api/webhooks/mayar?token=${TOKEN}`, {
      event: 'payment.received',
      data: { transactionId: txn, status: 'paid', extraData: { invoiceId } },
    })
    const first = db
      .prepare('SELECT paid_until FROM communities WHERE id=?')
      .get(admin.communityId) as { paid_until: number }

    // tagihan kedua, dibayar sebelum yang pertama habis
    const spy = mockMayar({ id: 'mid-2', transactionId: 'txn-2b', link: 'https://x/y' })
    const r2 = await call('POST', '/api/billing/checkout', { plan: 'monthly' }, admin.token)
    spy.mockRestore()
    await call('POST', `/api/webhooks/mayar?token=${TOKEN}`, {
      event: 'payment.received',
      data: { transactionId: 'txn-2b', status: 'paid', extraData: { invoiceId: r2.body.invoice.id } },
    })

    const second = db
      .prepare('SELECT paid_until FROM communities WHERE id=?')
      .get(admin.communityId) as { paid_until: number }
    const added = Math.round((second.paid_until - first.paid_until) / 86400000)
    expect(added).toBe(30) // sisa masa aktif tidak hangus
  })

  it('menerima status boolean true dari Mayar', async () => {
    const { admin, invoiceId, txn } = await pendingInvoice()
    await call('POST', `/api/webhooks/mayar?token=${TOKEN}`, {
      event: 'payment.received',
      data: { transactionId: txn, status: true, extraData: { invoiceId } },
    })
    const c = db
      .prepare('SELECT plan FROM communities WHERE id=?')
      .get(admin.communityId) as { plan: string }
    expect(c.plan).toBe('active')
  })
})

describe('daftar tagihan', () => {
  it('admin melihat riwayat tagihan lingkungannya', async () => {
    const a = await makeAdmin()
    const spy = mockMayar({ id: 'm9', transactionId: 't9', link: 'https://x/9' })
    await call('POST', '/api/billing/checkout', { plan: 'yearly' }, a.token)
    spy.mockRestore()

    const r = await call('GET', '/api/billing', undefined, a.token)
    expect(r.body.provider).toBe('mayar')
    expect(r.body.prices.monthly).toBe(149000)
    expect(r.body.invoices).toHaveLength(1)
    expect(r.body.invoices[0].plan).toBe('yearly')
  })
})
