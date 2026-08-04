import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as pathJoin } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

let app: { fetch: (r: Request) => Response | Promise<Response> }

beforeAll(async () => {
  process.env.WJW_DB = pathJoin(mkdtempSync(pathJoin(tmpdir(), 'wjw-push-')), 't.sqlite')
  process.env.WJW_NO_LISTEN = '1'
  // kunci VAPID nyata (dibuat khusus untuk tes)
  process.env.VAPID_PUBLIC_KEY =
    'BJCRRqhyebhHeZ4Q5ku7OTGAuGcof8B8KTiwCmcUS5pdAYaDRr3YYl4eFeSambcyvn_kAjbMpbj370BraDy-Om4'
  process.env.VAPID_PRIVATE_KEY = 'rGQ41dCIo3WwJFcvbjQrM5o8U79DipolRKYYuIXIjUg'
  app = (await import('./index.js')).app
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

describe('notifikasi push', () => {
  it('mengumumkan push aktif dan membagikan kunci publik', async () => {
    const h = await call('GET', '/api/health')
    expect(h.body.push).toBe(true)
    const k = await call('GET', '/api/push/key')
    expect(k.body.key).toMatch(/^B[A-Za-z0-9_-]{80,}$/)
  })

  it('menyimpan langganan push milik anggota', async () => {
    const a = await call('POST', '/api/auth/register', {
      name: 'Push', phone: '081900000001', email: 'push@x.id',
      password: 'secret123', house: 'A1', mode: 'create', communityName: 'RW Push',
    })
    const sub = {
      endpoint: 'https://fcm.example/abc',
      keys: { p256dh: 'BKxQ', auth: 'auth1' },
    }
    const r = await call('POST', '/api/push/subscribe', sub, a.body.token)
    expect(r.status).toBe(200)

    const { db } = await import('./db.js')
    const row = db
      .prepare('SELECT member_id FROM push_subscriptions WHERE endpoint=?')
      .get(sub.endpoint) as { member_id: string }
    expect(row.member_id).toBe(a.body.member.id)

    // mendaftar ulang endpoint yang sama tidak menggandakan baris
    await call('POST', '/api/push/subscribe', sub, a.body.token)
    const n = db
      .prepare('SELECT count(*) n FROM push_subscriptions WHERE endpoint=?')
      .get(sub.endpoint) as { n: number }
    expect(n.n).toBe(1)
  })

  it('menolak langganan tanpa login', async () => {
    const r = await call('POST', '/api/push/subscribe', {
      endpoint: 'https://x/y', keys: { p256dh: 'a', auth: 'b' },
    })
    expect(r.status).toBe(401)
  })

  it('peringatan darurat tetap tersimpan walau pengiriman push gagal', async () => {
    const a = await call('POST', '/api/auth/register', {
      name: 'Alert', phone: '081900000002', email: 'alert@x.id',
      password: 'secret123', house: 'A2', mode: 'create', communityName: 'RW Alert',
    })
    // endpoint palsu -> pengiriman pasti gagal
    await call('POST', '/api/push/subscribe', {
      endpoint: 'https://invalid.invalid/nope', keys: { p256dh: 'BKxQ', auth: 'z' },
    }, a.body.token)

    const r = await call('POST', '/api/alerts',
      { category: 'fire', at: { lat: 1, lng: 1 } }, a.body.token)
    expect(r.status).toBe(201)
    expect(r.body.report.live).toBe(true)
  })
})
