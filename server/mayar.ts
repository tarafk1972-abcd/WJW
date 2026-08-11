/**
 * Integrasi pembayaran Mayar (https://mayar.id).
 *
 * Alurnya:
 *   1. Admin menekan "Berlangganan" → server membuat tagihan lokal (pending)
 *      lalu memanggil Mayar untuk membuat invoice.
 *   2. Mayar mengirim email berisi tautan pembayaran ke admin, dan kita juga
 *      menyimpan tautannya agar bisa dibuka langsung dari aplikasi.
 *   3. Setelah dibayar, Mayar memanggil webhook kita → langganan diaktifkan.
 *
 * Akses TIDAK PERNAH dibuka hanya karena browser kembali dari Mayar —
 * hanya webhook (atau pemeriksaan ulang ke Mayar) yang boleh mengaktifkan.
 */
import { DAY, db, now, uid } from './db.js'

export const MAYAR_API_BASE =
  process.env.MAYAR_API_BASE ?? 'https://api.mayar.id/hl/v1'
const API_KEY = process.env.MAYAR_API_KEY ?? ''
export const WEBHOOK_TOKEN = process.env.MAYAR_WEBHOOK_TOKEN ?? ''

/** Harga langganan (Rupiah). */
export const PRICE_MONTHLY = Number(process.env.WJW_PRICE_MONTHLY ?? 149000)
export const PRICE_YEARLY = Number(process.env.WJW_PRICE_YEARLY ?? 1490000)

/** Berapa lama tagihan berlaku sebelum kedaluwarsa. */
const INVOICE_VALID_DAYS = 7

export function mayarEnabled(): boolean {
  return !!API_KEY
}

export interface MayarInvoice {
  id: string
  transactionId: string
  link: string
  expiredAt: number
}

interface MayarEnvelope<T> {
  statusCode?: number
  messages?: string
  data?: T
}

/** Panggilan dasar ke Mayar dengan penanganan error yang seragam. */
async function mayarFetch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${MAYAR_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const text = await res.text()
  let json: MayarEnvelope<T> | null = null
  try {
    json = text ? (JSON.parse(text) as MayarEnvelope<T>) : null
  } catch {
    throw new Error(`mayar: balasan bukan JSON (${res.status})`)
  }

  if (!res.ok || !json?.data) {
    throw new Error(
      `mayar: ${res.status} ${json?.messages ?? text.slice(0, 200)}`,
    )
  }
  return json.data
}

export interface CreateInvoiceInput {
  communityId: string
  communityName: string
  memberId: string
  name: string
  email: string
  mobile: string
  plan: 'monthly' | 'yearly'
  /** Ke mana pengguna kembali setelah membayar. */
  redirectUrl: string
}

export interface InvoiceRow {
  id: string
  community_id: string
  member_id: string
  plan: string
  amount: number
  status: string
  mayar_id: string | null
  mayar_txn_id: string | null
  pay_url: string | null
  created_at: number
  expires_at: number | null
  paid_at: number | null
  created_by: string
}

/**
 * Buat tagihan: simpan sebagai pending lebih dulu, baru panggil Mayar.
 * Urutan ini penting — kalau Mayar gagal, kita tetap punya catatan dan
 * bisa menandainya gagal, bukan kehilangan jejak.
 */
export async function createInvoice(
  input: CreateInvoiceInput,
): Promise<InvoiceRow> {
  const amount = input.plan === 'monthly' ? PRICE_MONTHLY : PRICE_YEARLY
  const id = uid('inv_')
  const createdAt = now()
  const expiresAt = createdAt + INVOICE_VALID_DAYS * DAY

  db.prepare(
    `INSERT INTO invoices
     (id, community_id, member_id, plan, amount, status, created_at, expires_at, created_by)
     VALUES (?,?,?,?,?,'pending',?,?,?)`,
  ).run(
    id,
    input.communityId,
    input.memberId,
    input.plan,
    amount,
    createdAt,
    expiresAt,
    input.memberId,
  )

  if (!mayarEnabled()) {
    // Tanpa kunci API, tagihan tetap tercatat agar bisa diverifikasi manual
    // oleh superadmin — aplikasi tidak boleh gagal hanya karena ini.
    return getInvoice(id)!
  }

  const periode = input.plan === 'monthly' ? '1 bulan' : '1 tahun'
  try {
    const data = await mayarFetch<MayarInvoice>('/invoice/create', {
      name: input.name,
      email: input.email,
      mobile: input.mobile.replace(/\D/g, ''),
      redirectUrl: input.redirectUrl,
      description: `Langganan Warga Jaga Warga — ${input.communityName} (${periode})`,
      expiredAt: new Date(expiresAt).toISOString(),
      items: [
        {
          quantity: 1,
          rate: amount,
          description: `Langganan ${periode} — ${input.communityName}`,
        },
      ],
      // dipakai saat mencocokkan webhook dengan tagihan kita
      extraData: { invoiceId: id, communityId: input.communityId },
    })

    db.prepare(
      'UPDATE invoices SET mayar_id=?, mayar_txn_id=?, pay_url=? WHERE id=?',
    ).run(data.id ?? null, data.transactionId ?? null, data.link ?? null, id)
  } catch (e) {
    db.prepare('UPDATE invoices SET status=?, raw=? WHERE id=?').run(
      'failed',
      String(e instanceof Error ? e.message : e),
      id,
    )
    throw e
  }

  return getInvoice(id)!
}

export function getInvoice(id: string): InvoiceRow | null {
  return (
    (db.prepare('SELECT * FROM invoices WHERE id=?').get(id) as
      | InvoiceRow
      | undefined) ?? null
  )
}

/** Status dianggap lunas. Mayar bisa mengirim boolean atau teks. */
export function isPaid(status: unknown): boolean {
  if (status === true) return true
  if (typeof status !== 'string') return false
  const s = status.toLowerCase()
  return s === 'paid' || s === 'success' || s === 'settled'
}

export interface MayarWebhookPayload {
  event?: string
  data?: {
    id?: string
    transactionId?: string
    status?: string | boolean
    transactionStatus?: string
    customerEmail?: string
    amount?: number
    extraData?: { invoiceId?: string; communityId?: string }
    [k: string]: unknown
  }
}

/**
 * Cari tagihan yang cocok dengan payload webhook.
 * Mayar bisa mengirim id yang berbeda antara pembuatan invoice dan webhook,
 * jadi dicoba beberapa cara berurutan.
 */
export function matchInvoice(p: MayarWebhookPayload): InvoiceRow | null {
  const d = p.data ?? {}

  const byExtra = d.extraData?.invoiceId
  if (byExtra) {
    const r = getInvoice(byExtra)
    if (r) return r
  }

  for (const key of [d.transactionId, d.id]) {
    if (!key) continue
    const r = db
      .prepare('SELECT * FROM invoices WHERE mayar_txn_id=? OR mayar_id=?')
      .get(key, key) as InvoiceRow | undefined
    if (r) return r
  }

  // terakhir: tagihan pending terbaru milik email tersebut
  if (d.customerEmail) {
    const r = db
      .prepare(
        `SELECT i.* FROM invoices i JOIN members m ON m.id = i.member_id
         WHERE lower(m.email)=lower(?) AND i.status='pending'
         ORDER BY i.created_at DESC LIMIT 1`,
      )
      .get(d.customerEmail) as InvoiceRow | undefined
    if (r) return r
  }

  return null
}

/**
 * Tandai webhook sudah diproses. Mengembalikan false bila sudah pernah —
 * Mayar bisa mengirim ulang kejadian yang sama.
 */
export function recordEvent(externalId: string, event: string, payload: unknown): boolean {
  try {
    db.prepare(
      'INSERT INTO webhook_events (id, provider, event, external_id, payload, at) VALUES (?,?,?,?,?,?)',
    ).run(uid('wh_'), 'mayar', event, externalId, JSON.stringify(payload), now())
    return true
  } catch {
    return false // external_id sudah ada (UNIQUE)
  }
}

/** Aktifkan langganan setelah pembayaran terkonfirmasi. */
export function activateSubscription(inv: InvoiceRow): void {
  const c = db
    .prepare('SELECT paid_until FROM communities WHERE id=?')
    .get(inv.community_id) as { paid_until: number | null } | undefined
  if (!c) return

  // Perpanjang dari tanggal berakhir yang ada, bukan dari hari ini,
  // supaya sisa masa aktif tidak hangus.
  const base = Math.max(now(), c.paid_until ?? 0)
  const days = inv.plan === 'monthly' ? 30 : 365
  const paidUntil = base + days * DAY

  db.prepare(
    "UPDATE communities SET paid_until=?, plan='active', plan_name=? WHERE id=?",
  ).run(paidUntil, inv.plan, inv.community_id)

  db.prepare("UPDATE invoices SET status='paid', paid_at=? WHERE id=?").run(
    now(),
    inv.id,
  )
}
