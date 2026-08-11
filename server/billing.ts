/**
 * Penagihan langganan lewat email + konfirmasi manual.
 *
 * Alurnya:
 *   1. Sistem membuat tagihan → email berisi instruksi transfer dikirim
 *      ke admin klaster.
 *   2. Admin transfer, lalu menandai "sudah bayar" di aplikasi
 *      (atau membalas email dengan bukti transfer).
 *   3. Superadmin memverifikasi → langganan aktif.
 *
 * Tidak ada penyedia pembayaran pihak ketiga.
 */
import { DAY, audit, db, now, uid } from './db.js'

/** Harga langganan (Rupiah). */
export const PRICE_MONTHLY = Number(process.env.WJW_PRICE_MONTHLY ?? 149000)
export const PRICE_YEARLY = Number(process.env.WJW_PRICE_YEARLY ?? 1490000)

/** Berapa lama tagihan berlaku sebelum dianggap kedaluwarsa. */
export const INVOICE_VALID_DAYS = Number(process.env.WJW_INVOICE_DAYS ?? 14)

/** Rekening tujuan transfer, ditampilkan di email dan aplikasi. */
export const BANK_INFO = process.env.WJW_BANK_INFO ?? ''

export function priceOf(plan: 'monthly' | 'yearly'): number {
  return plan === 'monthly' ? PRICE_MONTHLY : PRICE_YEARLY
}

export interface InvoiceRow {
  id: string
  community_id: string
  member_id: string
  plan: string
  amount: number
  /** pending → awaiting_verification → paid | rejected | expired */
  status: string
  /** Nomor rujukan transfer yang diisi admin. */
  reference: string | null
  /** Catatan dari superadmin saat menolak. */
  note: string | null
  created_at: number
  expires_at: number | null
  claimed_at: number | null
  paid_at: number | null
  verified_by: string | null
  created_by: string
}

/** Nomor tagihan yang mudah disebut lewat telepon atau WhatsApp. */
export function invoiceNumber(communityId: string, at: number): string {
  const d = new Date(at)
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
  // Buang karakter non-alfanumerik: id acak bisa memuat '-' dan '_',
  // yang membuat nomor tagihan seperti "WJW-202608--8BKG".
  const suffix = communityId.replace(/[^a-zA-Z0-9]/g, '').slice(-5).toUpperCase()
  return `WJW-${ym}-${suffix}`
}

export interface CreateInvoiceInput {
  communityId: string
  memberId: string
  plan: 'monthly' | 'yearly'
}

/** Buat tagihan baru berstatus pending. */
export function createInvoice(input: CreateInvoiceInput): InvoiceRow {
  const id = uid('inv_')
  const createdAt = now()
  const amount = priceOf(input.plan)

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
    createdAt + INVOICE_VALID_DAYS * DAY,
    input.memberId,
  )

  audit(input.communityId, input.memberId, 'billing.invoice', `${input.plan} ${amount}`)
  return getInvoice(id)!
}

export function getInvoice(id: string): InvoiceRow | null {
  return (
    (db.prepare('SELECT * FROM invoices WHERE id=?').get(id) as
      | InvoiceRow
      | undefined) ?? null
  )
}

/** Tagihan yang masih menunggu pembayaran untuk satu klaster. */
export function openInvoiceOf(communityId: string): InvoiceRow | null {
  return (
    (db
      .prepare(
        `SELECT * FROM invoices WHERE community_id=?
         AND status IN ('pending','awaiting_verification')
         AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(communityId, now()) as InvoiceRow | undefined) ?? null
  )
}

/**
 * Admin menandai sudah transfer. Belum mengaktifkan apa pun —
 * superadmin yang memutuskan.
 */
export function claimPayment(
  invoiceId: string,
  actorId: string,
  reference: string,
): boolean {
  const inv = getInvoice(invoiceId)
  if (!inv || inv.status !== 'pending') return false
  db.prepare(
    "UPDATE invoices SET status='awaiting_verification', reference=?, claimed_at=? WHERE id=?",
  ).run(reference.trim(), now(), invoiceId)
  audit(inv.community_id, actorId, 'billing.claim', reference.trim())
  return true
}

/**
 * Superadmin memverifikasi pembayaran → langganan aktif.
 * Masa aktif ditambahkan dari tanggal berakhir yang ada, bukan dari hari
 * ini, agar sisa hari tidak hangus saat membayar lebih awal.
 */
export function verifyPayment(
  invoiceId: string,
  actorId: string,
): { ok: boolean; paidUntil?: number } {
  const inv = getInvoice(invoiceId)
  if (!inv || inv.status === 'paid') return { ok: false }

  const c = db
    .prepare('SELECT paid_until FROM communities WHERE id=?')
    .get(inv.community_id) as { paid_until: number | null } | undefined
  if (!c) return { ok: false }

  const base = Math.max(now(), c.paid_until ?? 0)
  const days = inv.plan === 'monthly' ? 30 : 365
  const paidUntil = base + days * DAY

  db.prepare(
    "UPDATE communities SET paid_until=?, plan='active', plan_name=? WHERE id=?",
  ).run(paidUntil, inv.plan, inv.community_id)

  db.prepare(
    "UPDATE invoices SET status='paid', paid_at=?, verified_by=? WHERE id=?",
  ).run(now(), actorId, invoiceId)

  audit(inv.community_id, actorId, 'billing.verified', `${inv.plan} ${inv.amount}`)
  return { ok: true, paidUntil }
}

/** Superadmin menolak klaim pembayaran. */
export function rejectPayment(
  invoiceId: string,
  actorId: string,
  note: string,
): boolean {
  const inv = getInvoice(invoiceId)
  if (!inv || inv.status !== 'awaiting_verification') return false
  db.prepare("UPDATE invoices SET status='pending', note=? WHERE id=?").run(
    note.trim(),
    invoiceId,
  )
  audit(inv.community_id, actorId, 'billing.rejected', note.trim())
  return true
}

/** Semua tagihan yang menunggu verifikasi superadmin. */
export function pendingVerifications(): (InvoiceRow & {
  community_name: string
  member_name: string
  member_email: string
})[] {
  return db
    .prepare(
      `SELECT i.*, c.name AS community_name, m.name AS member_name, m.email AS member_email
       FROM invoices i
       JOIN communities c ON c.id = i.community_id
       JOIN members m ON m.id = i.member_id
       WHERE i.status='awaiting_verification'
       ORDER BY i.claimed_at`,
    )
    .all() as (InvoiceRow & {
    community_name: string
    member_name: string
    member_email: string
  })[]
}
