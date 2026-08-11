/**
 * Tes pengingat & tagihan perpanjangan otomatis.
 * Waktu disuntik, jadi tidak perlu menunggu hari berganti.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as pathJoin } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

let app: { fetch: (r: Request) => Response | Promise<Response> }
let db: import('better-sqlite3').Database
let runRenewalCheck: (now?: number) => Promise<{
  checked: number
  billed: string[]
  reminded: string[]
  expired: string[]
}>
let daysUntil: (expiry: number, now: number) => number
let expiryOf: (c: { trial_ends_at: number; paid_until: number | null }) => number

const DAY = 86_400_000

beforeAll(async () => {
  process.env.WJW_DB = pathJoin(mkdtempSync(pathJoin(tmpdir(), 'wjw-ren-')), 't.sqlite')
  process.env.WJW_NO_LISTEN = '1'
  process.env.WJW_BANK_INFO = 'BCA 123456 a.n. Uji'
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
  it('membuat tagihan pada H-7 dan mengirim emailnya', async () => {
    const a = await makeCommunity()
    const now = Date.now()
    setExpiry(a.communityId, now + 7 * DAY)

    const res = await runRenewalCheck(now)

    expect(res.billed).toContain(a.communityId)
    const inv = db
      .prepare('SELECT plan, status, amount FROM invoices WHERE community_id=?')
      .get(a.communityId) as { plan: string; status: string; amount: number }
    expect(inv.status).toBe('pending')
    expect(inv.plan).toBe('monthly')
    expect(inv.amount).toBe(149000)

    // email tagihan tercatat
    const mail = db
      .prepare("SELECT kind FROM emails WHERE community_id=? AND kind='bill'")
      .get(a.communityId)
    expect(mail).toBeTruthy()
  })

  it('memperpanjang paket tahunan sebagai tahunan', async () => {
    const a = await makeCommunity()
    const now = Date.now()
    setExpiry(a.communityId, now + 6 * DAY, 'yearly')

    await runRenewalCheck(now)

    const inv = db
      .prepare('SELECT plan, amount FROM invoices WHERE community_id=?')
      .get(a.communityId) as { plan: string; amount: number }
    expect(inv.plan).toBe('yearly')
    expect(inv.amount).toBe(1490000)
  })

  it('tidak menagih dua kali walau diperiksa berulang', async () => {
    const a = await makeCommunity()
    const now = Date.now()
    setExpiry(a.communityId, now + 7 * DAY)

    await runRenewalCheck(now)
    await runRenewalCheck(now + 3600_000) // beberapa jam kemudian

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
    await call('POST', '/api/billing/checkout', { plan: 'monthly' }, a.token)
    await runRenewalCheck(now)

    const n = db
      .prepare('SELECT count(*) n FROM invoices WHERE community_id=?')
      .get(a.communityId) as { n: number }
    expect(n.n).toBe(1)
  })

  it('tidak menyentuh lingkungan yang masih lama', async () => {
    const a = await makeCommunity()
    const now = Date.now()
    setExpiry(a.communityId, now + 40 * DAY)

    const res = await runRenewalCheck(now)

    expect(res.billed).not.toContain(a.communityId)
    expect(res.reminded).not.toContain(a.communityId)
  })

  it('melewati lingkungan yang ditangguhkan', async () => {
    const a = await makeCommunity()
    const now = Date.now()
    setExpiry(a.communityId, now + 5 * DAY)
    db.prepare("UPDATE communities SET plan='suspended' WHERE id=?").run(a.communityId)

    const res = await runRenewalCheck(now)

    expect(res.billed).not.toContain(a.communityId)
  })
})

describe('pengingat', () => {
  it('mengingatkan pada H-3, dan tetap menagih bila H-7 terlewat', async () => {
    const a = await makeCommunity()
    const now = Date.now()
    setExpiry(a.communityId, now + 3 * DAY)

    const res = await runRenewalCheck(now)

    expect(res.reminded).toContain(a.communityId)
    // Lingkungan ini baru terlihat pada H-3 (mis. server sempat mati),
    // jadi tagihannya dibuat sekarang — bukan dilewatkan.
    expect(res.billed).toContain(a.communityId)
  })

  it('mengingatkan H-3 tanpa menagih ulang bila sudah ditagih di H-7', async () => {
    const a = await makeCommunity()
    const now = Date.now()
    setExpiry(a.communityId, now + 7 * DAY)

    await runRenewalCheck(now) // H-7: tagihan dibuat

    // tagihan itu dibayar, lalu tiba H-3
    db.prepare("UPDATE invoices SET status='paid' WHERE community_id=?").run(a.communityId)

    const res = await runRenewalCheck(now + 4 * DAY)

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
