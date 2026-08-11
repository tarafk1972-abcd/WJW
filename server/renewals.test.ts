/**
 * Tes pengingat & tagihan perpanjangan otomatis.
 * Waktu disuntik, jadi tidak perlu menunggu hari berganti.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as pathJoin } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

let app: { fetch: (r: Request) => Response | Promise<Response> }
let db: import('better-sqlite3').Database
let runRenewalCheck: (now?: number) => Promise<{
  checked: number
  billed: string[]
  reminded: string[]
  expired: string[]
}>
let daysUntil: (expiry: number, now: number) => number
let expiryOf: (c: {
  trial_ends_at: number
  paid_until: number | null
}) => number

const DAY = 86_400_000

beforeAll(async () => {
  process.env.WJW_DB = pathJoin(mkdtempSync(pathJoin(tmpdir(), 'wjw-ren-')), 't.sqlite')
  process.env.WJW_NO_LISTEN = '1'
  process.env.MAYAR_API_KEY = 'kunci-uji'
  app = (await import('./index.js')).app
  db = (await import('./db.js')).db
  const m = await import('./renewals.js')
  runRenewalCheck = m.runRenewalCheck
  daysUntil = m.daysUntil
  expiryOf = m.expiryOf as typeof expiryOf
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
async function makeCommunity() {
  seq += 1
  const r = await call('POST', '/api/auth/register', {
    name: `Adm${seq}`,
    phone: `0817${String(seq).padStart(9, '0')}`,
    email: `ren${seq}@x.id`,
    password: 'secret123',
    house: 'A1',
    mode: 'create',
    communityName: `RW Ren ${seq}`,
  })
  return {
    token: r.body.token as string,
    id: r.body.member.id as string,
    communityId: r.body.member.communityId as string,
  }
}

/** Setel kapan langganan lingkungan berakhir. */
function setExpiry(communityId: string, at: number, planName = 'monthly') {
  db.prepare(
    "UPDATE communities SET paid_until=?, plan='active', plan_name=? WHERE id=?",
  ).run(at, planName, communityId)
}

function mockMayar() {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        statusCode: 200,
        messages: 'success',
        data: {
          id: `mid-${Math.random()}`,
          transactionId: `txn-${Math.random()}`,
          link: 'https://toko.mayar.shop/invoices/x',
          expiredAt: Date.now() + 7 * DAY,
        },
      }),
      { status: 200 },
    ),
  )
}

beforeEach(() => vi.restoreAllMocks())

describe('perhitungan jatuh tempo', () => {
  it('menghitung sisa hari, dibulatkan ke atas', () => {
    const now = Date.now()
    expect(daysUntil(now + 7 * DAY, now)).toBe(7)
    expect(daysUntil(now + 7 * DAY - 3600_000, now)).toBe(7) // 6 hari 23 jam
    expect(daysUntil(now - DAY, now)).toBe(-1)
  })

  it('memakai paid_until bila ada, jika tidak masa percobaan', () => {
    const t = Date.now()
    expect(expiryOf({ trial_ends_at: t, paid_until: t + 999 })).toBe(t + 999)
    expect(expiryOf({ trial_ends_at: t, paid_until: null })).toBe(t)
    expect(expiryOf({ trial_ends_at: t, paid_until: 0 })).toBe(t)
  })
})

describe('tagihan perpanjangan otomatis', () => {
  it('membuat tagihan pada H-7 dan mengirimnya lewat Mayar', async () => {
    const a = await makeCommunity()
    const now = Date.now()
    setExpiry(a.communityId, now + 7 * DAY)

    const spy = mockMayar()
    const res = await runRenewalCheck(now)
    spy.mockRestore()

    expect(res.billed).toContain(a.communityId)
    const inv = db
      .prepare('SELECT plan, status, pay_url FROM invoices WHERE community_id=?')
      .get(a.communityId) as { plan: string; status: string; pay_url: string }
    expect(inv.status).toBe('pending')
    expect(inv.plan).toBe('monthly')
    expect(inv.pay_url).toContain('mayar.shop')
  })

  it('memperpanjang paket tahunan sebagai tahunan', async () => {
    const a = await makeCommunity()
    const now = Date.now()
    setExpiry(a.communityId, now + 6 * DAY, 'yearly')

    const spy = mockMayar()
    await runRenewalCheck(now)
    spy.mockRestore()

    const inv = db
      .prepare('SELECT plan FROM invoices WHERE community_id=?')
      .get(a.communityId) as { plan: string }
    expect(inv.plan).toBe('yearly')
  })

  it('tidak menagih dua kali walau diperiksa berulang', async () => {
    const a = await makeCommunity()
    const now = Date.now()
    setExpiry(a.communityId, now + 7 * DAY)

    const s1 = mockMayar()
    await runRenewalCheck(now)
    s1.mockRestore()

    const s2 = mockMayar()
    await runRenewalCheck(now + 3600_000) // beberapa jam kemudian
    expect(s2).not.toHaveBeenCalled()
    s2.mockRestore()

    const n = db
      .prepare('SELECT count(*) n FROM invoices WHERE community_id=?')
      .get(a.communityId) as { n: number }
    expect(n.n).toBe(1)
  })

  it('tidak menagih bila sudah ada tagihan menunggu pembayaran', async () => {
    const a = await makeCommunity()
    const now = Date.now()
    setExpiry(a.communityId, now + 7 * DAY)

    // admin sudah membuat tagihan sendiri
    const s0 = mockMayar()
    await call('POST', '/api/billing/checkout', { plan: 'monthly' }, a.token)
    s0.mockRestore()

    const s1 = mockMayar()
    await runRenewalCheck(now)
    expect(s1).not.toHaveBeenCalled()
    s1.mockRestore()

    const n = db
      .prepare('SELECT count(*) n FROM invoices WHERE community_id=?')
      .get(a.communityId) as { n: number }
    expect(n.n).toBe(1)
  })

  it('tidak menyentuh lingkungan yang masih lama', async () => {
    const a = await makeCommunity()
    const now = Date.now()
    setExpiry(a.communityId, now + 40 * DAY)

    const spy = mockMayar()
    const res = await runRenewalCheck(now)
    spy.mockRestore()

    expect(res.billed).not.toContain(a.communityId)
    expect(res.reminded).not.toContain(a.communityId)
  })

  it('melewati lingkungan yang ditangguhkan', async () => {
    const a = await makeCommunity()
    const now = Date.now()
    setExpiry(a.communityId, now + 5 * DAY)
    db.prepare("UPDATE communities SET plan='suspended' WHERE id=?").run(a.communityId)

    const spy = mockMayar()
    const res = await runRenewalCheck(now)
    spy.mockRestore()

    expect(res.billed).not.toContain(a.communityId)
  })

  it('tetap mengirim email tagihan manual bila Mayar gagal', async () => {
    const a = await makeCommunity()
    const now = Date.now()
    setExpiry(a.communityId, now + 7 * DAY)

    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"messages":"gagal"}', { status: 500 }))
    const res = await runRenewalCheck(now)
    spy.mockRestore()

    // admin tetap ditagih, tidak dibiarkan tanpa kabar
    expect(res.billed).toContain(a.communityId)
    const mail = db
      .prepare("SELECT kind, subject FROM emails WHERE community_id=? AND kind='bill'")
      .get(a.communityId) as { kind: string; subject: string } | undefined
    expect(mail).toBeTruthy()
  })

  it('kegagalan Mayar tidak menghentikan lingkungan lain', async () => {
    const a = await makeCommunity()
    const b = await makeCommunity()
    const now = Date.now()
    setExpiry(a.communityId, now + 7 * DAY)
    setExpiry(b.communityId, now + 7 * DAY)

    let first = true
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      if (first) {
        first = false
        return new Response('{"messages":"gagal"}', { status: 500 })
      }
      return new Response(
        JSON.stringify({
          statusCode: 200,
          data: { id: 'm', transactionId: 't', link: 'https://x/y', expiredAt: now },
        }),
        { status: 200 },
      )
    })
    const res = await runRenewalCheck(now)
    spy.mockRestore()

    // Keduanya tetap ditagih: satu lewat Mayar, satu lewat email cadangan.
    // Yang penting, kegagalan satu lingkungan tidak menghentikan yang lain.
    expect(res.billed).toContain(a.communityId)
    expect(res.billed).toContain(b.communityId)
    expect(res.checked).toBeGreaterThanOrEqual(2)
  })
})

describe('pengingat', () => {
  it('mengingatkan pada H-3, dan tetap menagih bila H-7 terlewat', async () => {
    const a = await makeCommunity()
    const now = Date.now()
    setExpiry(a.communityId, now + 3 * DAY)

    const spy = mockMayar()
    const res = await runRenewalCheck(now)
    spy.mockRestore()

    expect(res.reminded).toContain(a.communityId)
    // Lingkungan ini baru terlihat pada H-3 (mis. server sempat mati),
    // jadi tagihannya dibuat sekarang — bukan dilewatkan.
    expect(res.billed).toContain(a.communityId)
  })

  it('mengingatkan H-3 tanpa menagih ulang bila sudah ditagih di H-7', async () => {
    const a = await makeCommunity()
    const now = Date.now()
    const expiry = now + 7 * DAY
    setExpiry(a.communityId, expiry)

    const s1 = mockMayar()
    await runRenewalCheck(now) // H-7: tagihan dibuat
    s1.mockRestore()

    // tagihan itu dibayar, lalu tiba H-3
    db.prepare("UPDATE invoices SET status='paid' WHERE community_id=?").run(a.communityId)

    const s2 = mockMayar()
    const res = await runRenewalCheck(now + 4 * DAY)
    s2.mockRestore()

    expect(res.reminded).toContain(a.communityId)
    expect(res.billed).not.toContain(a.communityId)
  })

  it('memberi tahu saat langganan sudah berakhir', async () => {
    const a = await makeCommunity()
    const now = Date.now()
    setExpiry(a.communityId, now - DAY)

    const res = await runRenewalCheck(now)
    expect(res.expired).toContain(a.communityId)

    // tidak diulang pada pemeriksaan berikutnya
    const again = await runRenewalCheck(now + 3600_000)
    expect(again.expired).not.toContain(a.communityId)
  })

  it('mengingatkan lagi untuk periode baru setelah perpanjangan', async () => {
    const a = await makeCommunity()
    const now = Date.now()

    setExpiry(a.communityId, now + 3 * DAY)
    const r1 = await runRenewalCheck(now)
    expect(r1.reminded).toContain(a.communityId)

    // dibayar → jatuh tempo mundur; periode baru harus diingatkan lagi
    const later = now + 30 * DAY
    setExpiry(a.communityId, later + 3 * DAY)
    const r2 = await runRenewalCheck(later)
    expect(r2.reminded).toContain(a.communityId)
  })
})

describe('pemicu manual', () => {
  it('hanya superadmin yang boleh menjalankan', async () => {
    const a = await makeCommunity()
    const r = await call('POST', '/api/billing/run-renewals', {}, a.token)
    expect(r.status).toBe(403)
  })
})
