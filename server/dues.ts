import { db, now, uid } from './db.js'
import { listBillableHouseholdHeads } from './population.js'

export const DUES_STATUSES = ['unpaid', 'awaiting_verification', 'paid', 'overdue'] as const
export type DuesStatus = (typeof DUES_STATUSES)[number]

export interface DuesSettings {
  communityId: string
  label: string
  amount: number
  dueDay: number
  paymentInstructions: string
  updatedBy: string
  updatedAt: number
}

export interface DuesInvoice {
  id: string
  communityId: string
  memberId: string
  period: string
  label: string
  amount: number
  dueAt: number
  status: DuesStatus
  reference: string
  paymentNote: string
  verifierNote: string
  createdAt: number
  generatedBy: string
  claimedAt: number | null
  paidAt: number | null
  verifiedBy: string | null
}

export interface DuesSummary {
  billed: number
  paid: number
  outstanding: number
  invoices: number
  paidInvoices: number
  awaitingVerification: number
  overdue: number
}

type DuesRow = {
  id: string
  community_id: string
  member_id: string
  period: string
  label: string
  amount: number
  due_at: number
  status: DuesStatus
  reference: string
  payment_note: string
  verifier_note: string
  created_at: number
  generated_by: string
  claimed_at: number | null
  paid_at: number | null
  verified_by: string | null
}

type SettingsRow = {
  community_id: string
  label: string
  amount: number
  due_day: number
  payment_instructions: string
  updated_by: string
  updated_at: number
}

function mapSettings(row: SettingsRow): DuesSettings {
  return {
    communityId: row.community_id,
    label: row.label,
    amount: row.amount,
    dueDay: row.due_day,
    paymentInstructions: row.payment_instructions,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  }
}

export function mapDuesInvoice(row: DuesRow): DuesInvoice {
  return {
    id: row.id,
    communityId: row.community_id,
    memberId: row.member_id,
    period: row.period,
    label: row.label,
    amount: row.amount,
    dueAt: row.due_at,
    status: row.status,
    reference: row.reference,
    paymentNote: row.payment_note,
    verifierNote: row.verifier_note,
    createdAt: row.created_at,
    generatedBy: row.generated_by,
    claimedAt: row.claimed_at,
    paidAt: row.paid_at,
    verifiedBy: row.verified_by,
  }
}

export function getDuesSettings(communityId: string): DuesSettings | null {
  const row = db
    .prepare('SELECT * FROM dues_settings WHERE community_id=?')
    .get(communityId) as SettingsRow | undefined
  return row ? mapSettings(row) : null
}

export function saveDuesSettings(input: {
  communityId: string
  actorId: string
  label: string
  amount: number
  dueDay: number
  paymentInstructions: string
}): DuesSettings {
  const at = now()
  db.prepare(
    `INSERT INTO dues_settings
     (community_id,label,amount,due_day,payment_instructions,updated_by,updated_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(community_id) DO UPDATE SET
       label=excluded.label,
       amount=excluded.amount,
       due_day=excluded.due_day,
       payment_instructions=excluded.payment_instructions,
       updated_by=excluded.updated_by,
       updated_at=excluded.updated_at`,
  ).run(
    input.communityId,
    input.label,
    input.amount,
    input.dueDay,
    input.paymentInstructions,
    input.actorId,
    at,
  )
  return {
    communityId: input.communityId,
    label: input.label,
    amount: input.amount,
    dueDay: input.dueDay,
    paymentInstructions: input.paymentInstructions,
    updatedBy: input.actorId,
    updatedAt: at,
  }
}

/** Gunakan tengah hari UTC supaya label tanggal tidak mundur di WIB/WITA/WIT. */
export function dueAtForPeriod(period: string, dueDay: number): number | null {
  const match = /^(\d{4})-(\d{2})$/.exec(period)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (year < 2020 || year > 2100 || month < 1 || month > 12) return null
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return Date.UTC(year, month - 1, Math.min(Math.max(1, dueDay), lastDay), 12, 0, 0)
}

/** Tandai tunggakan di sumber kebenaran, bukan hanya lewat warna UI. */
export function refreshOverdueDues(communityId: string, at = now()): void {
  db.prepare(
    "UPDATE dues_invoices SET status='overdue' WHERE community_id=? AND status='unpaid' AND due_at < ?",
  ).run(communityId, at)
}

export function listDuesInvoices(communityId: string, memberId?: string): DuesInvoice[] {
  refreshOverdueDues(communityId)
  const rows = (memberId
    ? db
        .prepare(
          'SELECT * FROM dues_invoices WHERE community_id=? AND member_id=? ORDER BY due_at DESC, created_at DESC',
        )
        .all(communityId, memberId)
    : db
        .prepare('SELECT * FROM dues_invoices WHERE community_id=? ORDER BY due_at DESC, created_at DESC')
        .all(communityId)) as DuesRow[]
  return rows.map(mapDuesInvoice)
}

/**
 * Ringkasan bisa dibatasi ke satu penghuni. Jangan pernah mengirim total kas
 * seluruh lingkungan kepada warga biasa hanya karena ia boleh melihat tagihan
 * miliknya sendiri.
 */
export function duesSummary(communityId: string, memberId?: string): DuesSummary {
  refreshOverdueDues(communityId)
  const where = memberId
    ? 'WHERE community_id=? AND member_id=?'
    : 'WHERE community_id=?'
  const row = db
    .prepare(
      `SELECT
        count(*) AS invoices,
        coalesce(sum(amount), 0) AS billed,
        coalesce(sum(CASE WHEN status='paid' THEN amount ELSE 0 END), 0) AS paid,
        coalesce(sum(CASE WHEN status!='paid' THEN amount ELSE 0 END), 0) AS outstanding,
        coalesce(sum(CASE WHEN status='paid' THEN 1 ELSE 0 END), 0) AS paid_invoices,
        coalesce(sum(CASE WHEN status='awaiting_verification' THEN 1 ELSE 0 END), 0) AS awaiting_verification,
        coalesce(sum(CASE WHEN status='overdue' THEN 1 ELSE 0 END), 0) AS overdue
       FROM dues_invoices ${where}`,
    )
    .get(communityId, ...(memberId ? [memberId] : [])) as {
    invoices: number
    billed: number
    paid: number
    outstanding: number
    paid_invoices: number
    awaiting_verification: number
    overdue: number
  }
  return {
    billed: row.billed,
    paid: row.paid,
    outstanding: row.outstanding,
    invoices: row.invoices,
    paidInvoices: row.paid_invoices,
    awaitingVerification: row.awaiting_verification,
    overdue: row.overdue,
  }
}

function reference(): string {
  // Sistem menentukan nomor; penghuni tidak pernah dapat memilih/mengganti ini.
  return `IPL-${uid().slice(0, 10).toUpperCase()}`
}

export function generateDuesInvoices(input: {
  communityId: string
  actorId: string
  period: string
  memberIds: string[]
}): { created: number; existing: number; invoices: DuesInvoice[] } {
  const settings = getDuesSettings(input.communityId)
  if (!settings || settings.amount <= 0) throw new Error('dues_not_configured')
  const dueAt = dueAtForPeriod(input.period, settings.dueDay)
  if (!dueAt) throw new Error('invalid_period')

  const ids = [...new Set(input.memberIds)].slice(0, 500)
  if (!ids.length) throw new Error('no_members')

  // Satu alamat/KK memiliki satu penerima iuran. Jangan biarkan admin
  // menerbitkan dua tagihan hanya karena ayah dan anak sama-sama punya akun.
  const billable = listBillableHouseholdHeads(input.communityId)
  const byId = new Map(billable.map((member) => [member.id, member]))
  const residents = ids.map((id) => byId.get(id)).filter(Boolean) as { id: string }[]
  if (residents.length !== ids.length) throw new Error('invalid_household_head')

  let created = 0
  let existing = 0
  const invoiceIds: string[] = []
  const create = db.transaction(() => {
    const find = db.prepare(
      'SELECT id FROM dues_invoices WHERE community_id=? AND member_id=? AND period=?',
    )
    const insert = db.prepare(
      `INSERT INTO dues_invoices
       (id,community_id,member_id,period,label,amount,due_at,status,reference,
        payment_note,verifier_note,created_at,generated_by)
       VALUES (?,?,?,?,?,?,?,'unpaid',?,'','',?,?)`,
    )
    for (const resident of residents) {
      const present = find.get(input.communityId, resident.id, input.period) as { id: string } | undefined
      if (present) {
        existing += 1
        invoiceIds.push(present.id)
        continue
      }
      const id = uid('di_')
      insert.run(
        id,
        input.communityId,
        resident.id,
        input.period,
        settings.label,
        settings.amount,
        dueAt,
        reference(),
        now(),
        input.actorId,
      )
      created += 1
      invoiceIds.push(id)
    }
  })
  create()

  const invoiceMarks = invoiceIds.map(() => '?').join(',')
  const invoices = invoiceIds.length
    ? (db.prepare(`SELECT * FROM dues_invoices WHERE id IN (${invoiceMarks})`).all(...invoiceIds) as DuesRow[]).map(
        mapDuesInvoice,
      )
    : []
  return { created, existing, invoices }
}

export function getDuesInvoice(id: string): DuesInvoice | null {
  const row = db.prepare('SELECT * FROM dues_invoices WHERE id=?').get(id) as DuesRow | undefined
  return row ? mapDuesInvoice(row) : null
}

export function claimDuesInvoice(input: {
  invoiceId: string
  memberId: string
  paymentNote: string
}): DuesInvoice | null {
  const invoice = getDuesInvoice(input.invoiceId)
  if (!invoice || invoice.memberId !== input.memberId) return null
  if (invoice.status !== 'unpaid' && invoice.status !== 'overdue') throw new Error('invalid_dues_state')

  const at = now()
  // Kondisi status ada di SQL, bukan hanya pemeriksaan sebelum UPDATE: dua
  // request bersamaan tidak boleh sama-sama dianggap berhasil mengajukan.
  const result = db
    .prepare(
      `UPDATE dues_invoices
       SET status='awaiting_verification', payment_note=?, claimed_at=?,
           verifier_note='', verified_by=NULL, paid_at=NULL
       WHERE id=? AND member_id=? AND status IN ('unpaid','overdue')`,
    )
    .run(input.paymentNote, at, invoice.id, input.memberId)
  if (result.changes !== 1) throw new Error('invalid_dues_state')
  return getDuesInvoice(invoice.id)
}

export function verifyDuesInvoice(input: {
  invoiceId: string
  actorId: string
  approve: boolean
  note: string
}): DuesInvoice | null {
  const invoice = getDuesInvoice(input.invoiceId)
  if (!invoice) return null
  if (invoice.status !== 'awaiting_verification') throw new Error('invalid_dues_state')

  const at = now()
  let result: { changes: number }
  if (input.approve) {
    result = db
      .prepare(
        "UPDATE dues_invoices SET status='paid', verifier_note=?, paid_at=?, verified_by=? WHERE id=? AND status='awaiting_verification'",
      )
      .run(input.note, at, input.actorId, invoice.id)
  } else {
    const next = invoice.dueAt < at ? 'overdue' : 'unpaid'
    result = db
      .prepare(
        "UPDATE dues_invoices SET status=?, verifier_note=?, verified_by=? WHERE id=? AND status='awaiting_verification'",
      )
      .run(next, input.note, input.actorId, invoice.id)
  }
  // Sama seperti claim: state transition bersifat compare-and-swap agar dua
  // Admin 2 tidak dapat menutup pengajuan yang sama dengan hasil berbeda.
  if (result.changes !== 1) throw new Error('invalid_dues_state')
  return getDuesInvoice(invoice.id)
}
