/**
 * Tes template & pengiriman email tagihan.
 * SMTP dipalsukan; tidak ada email sungguhan yang terkirim.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as pathJoin } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  billEmail,
  esc,
  expiredEmail,
  paidEmail,
  reminderEmail,
} from './email-templates.js'

const DAY = 86_400_000
const base = {
  adminName: 'Budi Santoso',
  communityName: 'RW 05 Griya Soreang',
  plan: 'monthly' as const,
  amount: 149000,
  dueAt: new Date('2026-09-01T00:00:00+07:00').getTime(),
  invoiceNo: 'INV-001',
}

describe('template email', () => {
  it('tagihan memuat nama, jumlah dan tautan bayar', () => {
    const m = billEmail({ ...base, payUrl: 'https://toko.mayar.shop/i/abc' })
    expect(m.subject).toContain('RW 05 Griya Soreang')
    expect(m.subject).toContain('Rp 149.000')
    expect(m.html).toContain('Budi Santoso')
    expect(m.html).toContain('https://toko.mayar.shop/i/abc')
    expect(m.html).toContain('Bayar sekarang')
    // versi teks juga lengkap, untuk klien tanpa HTML
    expect(m.text).toContain('Rp 149.000')
    expect(m.text).toContain('https://toko.mayar.shop/i/abc')
  })

  it('menampilkan instruksi transfer bila tidak ada tautan bayar', () => {
    const m = billEmail({
      ...base,
      payUrl: null,
      bankInfo: 'BCA 1234567890 a.n. Yayasan RW 05',
    })
    expect(m.html).toContain('Cara pembayaran')
    expect(m.html).toContain('BCA 1234567890')
    expect(m.html).not.toContain('Bayar sekarang')
    expect(m.text).toContain('BCA 1234567890')
  })

  it('memformat rupiah dan tanggal dalam bahasa Indonesia', () => {
    const m = billEmail({ ...base, amount: 1490000, plan: 'yearly', payUrl: null })
    expect(m.html).toContain('Rp 1.490.000')
    expect(m.html).toContain('September 2026')
    expect(m.html).toContain('Tahunan')
  })

  it('pengingat berubah nada saat mendesak', () => {
    const biasa = reminderEmail({ ...base, daysLeft: 3, payUrl: null })
    expect(biasa.subject).toContain('3 hari lagi')

    const mendesak = reminderEmail({ ...base, daysLeft: 1, payUrl: null })
    expect(mendesak.subject).toContain('besok')
    expect(mendesak.html).toContain('#b91c1c') // merah
  })

  it('email berakhir menegaskan data tetap tersimpan', () => {
    const m = expiredEmail({ ...base, payUrl: null })
    expect(m.subject).toContain('telah berakhir')
    expect(m.html).toContain('tetap tersimpan')
  })

  it('kuitansi mencantumkan tanggal aktif', () => {
    const m = paidEmail({
      ...base,
      payUrl: null,
      activeUntil: new Date('2026-10-01T00:00:00+07:00').getTime(),
    })
    expect(m.subject).toContain('Pembayaran diterima')
    expect(m.html).toContain('Oktober 2026')
    expect(m.text).toContain('bukti pembayaran')
  })

  it('menolak penyuntikan HTML lewat nama klaster', () => {
    const m = billEmail({
      ...base,
      communityName: '<script>alert(1)</script>',
      payUrl: null,
    })
    expect(m.html).not.toContain('<script>')
    expect(m.html).toContain('&lt;script&gt;')
  })

  it('semua warna hex valid (menangkap salah ketik)', () => {
    const all = [
      billEmail({ ...base, payUrl: 'https://x/y' }),
      reminderEmail({ ...base, daysLeft: 1, payUrl: 'https://x/y' }),
      expiredEmail({ ...base, payUrl: null, bankInfo: 'BCA 1' }),
      paidEmail({ ...base, payUrl: null, activeUntil: Date.now() }),
    ]
    for (const m of all) {
      // setiap "color:#..." / "background:#..." harus 3 atau 6 digit hex
      const hexes = m.html.match(/(?:color|background):\s*#[^;"]*/g) ?? []
      for (const h of hexes) {
        const val = h.split('#')[1]
        expect(val, `warna tidak valid: ${h}`).toMatch(/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/)
      }
    }
  })

  it('esc menangani karakter berbahaya', () => {
    expect(esc(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;')
  })

  it('setiap email punya subjek, HTML dan teks', () => {
    const all = [
      billEmail({ ...base, payUrl: null }),
      reminderEmail({ ...base, daysLeft: 3, payUrl: null }),
      expiredEmail({ ...base, payUrl: null }),
      paidEmail({ ...base, payUrl: null, activeUntil: Date.now() }),
    ]
    for (const m of all) {
      expect(m.subject.length).toBeGreaterThan(10)
      expect(m.html).toContain('<!doctype html>')
      expect(m.html).toContain('Warga Jaga Warga')
      expect(m.text.length).toBeGreaterThan(50)
      // gaya harus sebaris agar tampil benar di Gmail/Outlook
      expect(m.html).not.toContain('<style>')
    }
  })
})

/* ---------------- pengiriman ---------------- */

let sendMail: typeof import('./mailer.js').sendMail
let db: import('better-sqlite3').Database

describe('pengiriman email', () => {
  beforeAll(async () => {
    process.env.WJW_DB = pathJoin(mkdtempSync(pathJoin(tmpdir(), 'wjw-mail-')), 't.sqlite')
    process.env.WJW_NO_LISTEN = '1'
    const m = await import('./mailer.js')
    sendMail = m.sendMail
    db = (await import('./db.js')).db
  })

  it('mencatat sebagai dilewati bila SMTP belum diatur', async () => {
    const r = await sendMail({
      to: 'a@x.id',
      subject: 'Uji',
      html: '<p>x</p>',
      text: 'x',
      kind: 'test',
    })
    expect(r.skipped).toBe(true)
    expect(r.ok).toBe(false)

    const row = db
      .prepare('SELECT status, to_email FROM emails WHERE id=?')
      .get(r.id) as { status: string; to_email: string }
    expect(row.status).toBe('skipped')
    expect(row.to_email).toBe('a@x.id')
  })

  it('tidak melempar error walau pengiriman gagal', async () => {
    // kegagalan email tidak boleh menghentikan penagihan
    await expect(
      sendMail({ to: 'x', subject: 's', html: 'h', text: 't', kind: 'bill' }),
    ).resolves.toBeTruthy()
  })
})

/* ---------------- terhubung ke penjadwal ---------------- */

describe('email pada alur perpanjangan', () => {
  let app: { fetch: (r: Request) => Response | Promise<Response> }
  let db2: import('better-sqlite3').Database
  let runRenewalCheck: (now?: number) => Promise<unknown>

  beforeAll(async () => {
    process.env.WJW_DB = pathJoin(mkdtempSync(pathJoin(tmpdir(), 'wjw-mail2-')), 't.sqlite')
    process.env.WJW_NO_LISTEN = '1'
    process.env.WJW_BANK_INFO = 'BCA 999 a.n. Uji'
    delete process.env.MAYAR_API_KEY // uji jalur manual
    const mod = await import('./index.js')
    app = mod.app
    db2 = (await import('./db.js')).db
    runRenewalCheck = (await import('./renewals.js')).runRenewalCheck
  })

  beforeEach(() => vi.restoreAllMocks())

  it('mengirim email tagihan manual saat Mayar tidak aktif', async () => {
    const reg = await app.fetch(
      new Request('http://x/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Pak Admin',
          phone: '081700000777',
          email: 'tagih@x.id',
          password: 'secret123',
          house: 'A1',
          mode: 'create',
          communityName: 'RW Email',
        }),
      }),
    )
    const body = (await reg.json()) as { member: { communityId: string } }
    const cid = body.member.communityId

    const now = Date.now()
    db2.prepare(
      "UPDATE communities SET paid_until=?, plan='active', plan_name='monthly' WHERE id=?",
    ).run(now + 7 * DAY, cid)

    await runRenewalCheck(now)

    const mail = db2
      .prepare("SELECT kind, to_email, subject FROM emails WHERE community_id=? AND kind='bill'")
      .get(cid) as { kind: string; to_email: string; subject: string } | undefined

    expect(mail).toBeTruthy()
    expect(mail!.to_email).toBe('tagih@x.id')
    expect(mail!.subject).toContain('RW Email')
  })

  it('mengirim email pengingat pada H-3', async () => {
    const reg = await app.fetch(
      new Request('http://x/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Admin Dua',
          phone: '081700000778',
          email: 'ingat@x.id',
          password: 'secret123',
          house: 'A2',
          mode: 'create',
          communityName: 'RW Ingat',
        }),
      }),
    )
    const body = (await reg.json()) as { member: { communityId: string } }
    const cid = body.member.communityId

    const now = Date.now()
    db2.prepare(
      "UPDATE communities SET paid_until=?, plan='active', plan_name='monthly' WHERE id=?",
    ).run(now + 3 * DAY, cid)

    await runRenewalCheck(now)

    const kinds = db2
      .prepare('SELECT kind FROM emails WHERE community_id=?')
      .all(cid) as { kind: string }[]
    expect(kinds.map((k) => k.kind)).toContain('reminder')
  })
})
