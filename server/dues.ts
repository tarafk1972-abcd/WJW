import { db, now, uid } from './db.js'
import { listBillableHouseholdHeads } from './population.js'

export const DUES_STATUSES = ['unpaid', 'awaiting_verification', 'paid', 'overdue', 'waived'] as const
export type DuesStatus = (typeof DUES_STATUSES)[number]

/**
 * Cara pembayaran. Kosong berarti tagihan belum dibayar sama sekali.
 * `cash` hanya bisa ditetapkan pengurus: uangnya diterima di luar aplikasi,
 * jadi tidak ada klaim warga yang perlu diverifikasi.
 */
export const DUES_METHODS = ['', 'transfer', 'cash'] as const
export type DuesMethod = (typeof DUES_METHODS)[number]

/** Status yang masih menunggu penyelesaian, dipakai sebagai penjaga transisi. */
const OPEN_STATUSES = "('unpaid','overdue','awaiting_verification')"

export interface DuesSettings {
  communityId: string
  label: string
  amount: number
  dueDay: number
  paymentInstructions: string
  /** Terbitkan tagihan bulanan tanpa diminta, pada tanggal 1 tiap bulan. */
  autoMonthly: boolean
  updatedBy: string
  updatedAt: number
}

/** `monthly` = iuran rutin; `special` = tagihan insidental sekali jalan. */
export const DUES_KINDS = ['monthly', 'special'] as const
export type DuesKind = (typeof DUES_KINDS)[number]

export interface DuesInvoice {
  id: string
  communityId: string
  memberId: string
  period: string
  label: string
  amount: number
  dueAt: number
  status: DuesStatus
  kind: DuesKind
  method: DuesMethod
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
  /** Jumlah tagihan yang dibebaskan pengurus; uangnya memang tidak ditagih. */
  waived: number
  /** Bagian dari `paid` yang diterima tunai, bukan lewat rekening. */
  paidCash: number
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
  kind: DuesKind
  method: DuesMethod
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
  auto_monthly: number
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
    autoMonthly: !!row.auto_monthly,
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
    kind: row.kind ?? 'monthly',
    method: row.method ?? '',
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
  autoMonthly: boolean
}): DuesSettings {
  const at = now()
  db.prepare(
    `INSERT INTO dues_settings
     (community_id,label,amount,due_day,payment_instructions,auto_monthly,updated_by,updated_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(community_id) DO UPDATE SET
       label=excluded.label,
       amount=excluded.amount,
       due_day=excluded.due_day,
       payment_instructions=excluded.payment_instructions,
       auto_monthly=excluded.auto_monthly,
       updated_by=excluded.updated_by,
       updated_at=excluded.updated_at`,
  ).run(
    input.communityId,
    input.label,
    input.amount,
    input.dueDay,
    input.paymentInstructions,
    input.autoMonthly ? 1 : 0,
    input.actorId,
    at,
  )
  return {
    communityId: input.communityId,
    label: input.label,
    amount: input.amount,
    dueDay: input.dueDay,
    paymentInstructions: input.paymentInstructions,
    autoMonthly: input.autoMonthly,
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
        -- Tagihan yang dibebaskan tidak pernah menjadi hak tagih, jadi tidak
        -- masuk 'billed' maupun 'outstanding'. Kalau ikut dihitung, laporan
        -- kas akan menampilkan tunggakan yang tidak pernah ada.
        coalesce(sum(CASE WHEN status='waived' THEN 0 ELSE amount END), 0) AS billed,
        coalesce(sum(CASE WHEN status='paid' THEN amount ELSE 0 END), 0) AS paid,
        coalesce(sum(CASE WHEN status IN ('paid','waived') THEN 0 ELSE amount END), 0) AS outstanding,
        coalesce(sum(CASE WHEN status='paid' THEN 1 ELSE 0 END), 0) AS paid_invoices,
        coalesce(sum(CASE WHEN status='awaiting_verification' THEN 1 ELSE 0 END), 0) AS awaiting_verification,
        coalesce(sum(CASE WHEN status='overdue' THEN 1 ELSE 0 END), 0) AS overdue,
        coalesce(sum(CASE WHEN status='waived' THEN 1 ELSE 0 END), 0) AS waived,
        coalesce(sum(CASE WHEN status='paid' AND method='cash' THEN amount ELSE 0 END), 0) AS paid_cash
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
    waived: number
    paid_cash: number
  }
  return {
    billed: row.billed,
    paid: row.paid,
    outstanding: row.outstanding,
    invoices: row.invoices,
    paidInvoices: row.paid_invoices,
    awaitingVerification: row.awaiting_verification,
    overdue: row.overdue,
    waived: row.waived,
    paidCash: row.paid_cash,
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

  // Nominal khusus menimpa nominal umum, per rumah.
  const overrides = new Map(
    listDuesHouseAmounts(input.communityId).map((item) => [item.householdId, item.amount]),
  )

  // Satu alamat/KK memiliki satu penerima iuran. Jangan biarkan admin
  // menerbitkan dua tagihan hanya karena ayah dan anak sama-sama punya akun.
  const billable = listBillableHouseholdHeads(input.communityId)
  const byId = new Map(billable.map((member) => [member.id, member]))
  const residents = ids.map((id) => byId.get(id)).filter(Boolean) as {
    id: string
    householdId: string
  }[]
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
        overrides.get(resident.householdId) ?? settings.amount,
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

/* ---------------- tagihan insidental ---------------- */

/**
 * Tagihan sekali jalan: kerja bakti, perbaikan gapura, syukuran 17 Agustus.
 * Nominalnya seragam dan ditentukan saat itu juga — nominal khusus per rumah
 * sengaja tidak berlaku, karena patungan semacam ini biasanya rata.
 *
 * `period` diberi imbuhan acak agar satu warga dapat menerima beberapa tagihan
 * insidental dalam bulan yang sama tanpa menabrak UNIQUE(community,member,period).
 */
export function generateSpecialInvoices(input: {
  communityId: string
  actorId: string
  title: string
  amount: number
  dueAt: number
  memberIds: string[]
}): { created: number; invoices: DuesInvoice[] } {
  const title = input.title.trim().slice(0, 100)
  if (title.length < 3) throw new Error('invalid_dues_title')
  if (!Number.isInteger(input.amount) || input.amount < 1_000 || input.amount > 50_000_000) {
    throw new Error('invalid_dues_settings')
  }
  if (!Number.isFinite(input.dueAt) || input.dueAt <= 0) throw new Error('invalid_period')

  const ids = [...new Set(input.memberIds)].slice(0, 500)
  if (!ids.length) throw new Error('no_members')

  const billable = listBillableHouseholdHeads(input.communityId)
  const byId = new Map(billable.map((member) => [member.id, member]))
  const residents = ids.map((id) => byId.get(id)).filter(Boolean) as { id: string }[]
  if (residents.length !== ids.length) throw new Error('invalid_household_head')

  const at = now()
  const period = `${new Date(input.dueAt).toISOString().slice(0, 7)}#${uid().slice(0, 5).toUpperCase()}`
  const invoiceIds: string[] = []
  const create = db.transaction(() => {
    const insert = db.prepare(
      `INSERT INTO dues_invoices
       (id,community_id,member_id,period,label,amount,due_at,status,reference,
        payment_note,verifier_note,created_at,generated_by,kind,method)
       VALUES (?,?,?,?,?,?,?,'unpaid',?,'','',?,?,'special','')`,
    )
    for (const resident of residents) {
      const id = uid('di_')
      insert.run(
        id,
        input.communityId,
        resident.id,
        period,
        title,
        input.amount,
        input.dueAt,
        reference(),
        at,
        input.actorId,
      )
      invoiceIds.push(id)
    }
  })
  create()

  const marks = invoiceIds.map(() => '?').join(',')
  const invoices = (
    db.prepare(`SELECT * FROM dues_invoices WHERE id IN (${marks})`).all(...invoiceIds) as DuesRow[]
  ).map(mapDuesInvoice)
  return { created: invoices.length, invoices }
}

/* ---------------- nominal khusus per rumah ---------------- */

export interface DuesHouseAmount {
  householdId: string
  amount: number
  note: string
  updatedAt: number
}

export function listDuesHouseAmounts(communityId: string): DuesHouseAmount[] {
  const rows = db
    .prepare('SELECT household_id,amount,note,updated_at FROM dues_house_amounts WHERE community_id=?')
    .all(communityId) as { household_id: string; amount: number; note: string; updated_at: number }[]
  return rows.map((row) => ({
    householdId: row.household_id,
    amount: row.amount,
    note: row.note,
    updatedAt: row.updated_at,
  }))
}

/** Nominal `null` menghapus kekhususan; rumah itu kembali memakai nominal umum. */
export function setDuesHouseAmount(input: {
  communityId: string
  householdId: string
  actorId: string
  amount: number | null
  note: string
}): void {
  const owned = db
    .prepare('SELECT id FROM households WHERE id=? AND community_id=?')
    .get(input.householdId, input.communityId) as { id: string } | undefined
  if (!owned) throw new Error('not_found')

  if (input.amount === null) {
    db.prepare('DELETE FROM dues_house_amounts WHERE household_id=?').run(input.householdId)
    return
  }
  if (!Number.isInteger(input.amount) || input.amount < 1_000 || input.amount > 50_000_000) {
    throw new Error('invalid_dues_settings')
  }
  db.prepare(
    `INSERT INTO dues_house_amounts (household_id,community_id,amount,note,updated_by,updated_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(household_id) DO UPDATE SET
       amount=excluded.amount, note=excluded.note,
       updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
  ).run(input.householdId, input.communityId, input.amount, input.note, input.actorId, now())
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
       SET status='awaiting_verification', method='transfer', payment_note=?, claimed_at=?,
           verifier_note='', verified_by=NULL, paid_at=NULL
       WHERE id=? AND member_id=? AND status IN ('unpaid','overdue')`,
    )
    .run(input.paymentNote, at, invoice.id, input.memberId)
  if (result.changes !== 1) throw new Error('invalid_dues_state')
  return getDuesInvoice(invoice.id)
}

/**
 * Pengurus menerima uang tunai langsung. Tidak lewat klaim warga karena tidak
 * ada bukti transfer yang bisa diperiksa: yang bertanggung jawab adalah orang
 * yang menekan tombolnya, dan itulah yang dicatat di `verified_by`.
 */
export function markDuesInvoicePaidCash(input: {
  invoiceId: string
  actorId: string
  note: string
}): DuesInvoice | null {
  const invoice = getDuesInvoice(input.invoiceId)
  if (!invoice) return null
  if (invoice.status === 'paid' || invoice.status === 'waived') throw new Error('invalid_dues_state')

  const at = now()
  // Sama seperti claim/verify: syarat status ikut ke dalam SQL supaya dua
  // pengurus tidak bisa sama-sama merasa berhasil menutup tagihan yang sama.
  const result = db
    .prepare(
      `UPDATE dues_invoices
       SET status='paid', method='cash', verifier_note=?, paid_at=?, verified_by=?
       WHERE id=? AND status IN ${OPEN_STATUSES}`,
    )
    .run(input.note, at, input.actorId, invoice.id)
  if (result.changes !== 1) throw new Error('invalid_dues_state')
  return getDuesInvoice(invoice.id)
}

/**
 * Membebaskan tagihan: rumah kosong, keluarga sedang berduka, atau warga tidak
 * mampu bulan itu. Berbeda dari menghapus tagihan — barisnya tetap ada berikut
 * alasannya, sehingga bisa dipertanggungjawabkan di rapat warga.
 */
export function waiveDuesInvoice(input: {
  invoiceId: string
  actorId: string
  note: string
}): DuesInvoice | null {
  const invoice = getDuesInvoice(input.invoiceId)
  if (!invoice) return null
  if (invoice.status === 'paid') throw new Error('invalid_dues_state')

  const result = db
    .prepare(
      `UPDATE dues_invoices
       SET status='waived', method='', verifier_note=?, verified_by=?, paid_at=NULL, claimed_at=NULL
       WHERE id=? AND status IN ${OPEN_STATUSES}`,
    )
    .run(input.note, input.actorId, invoice.id)
  if (result.changes !== 1) throw new Error('invalid_dues_state')
  return getDuesInvoice(invoice.id)
}

/**
 * Batalkan pembebasan yang salah tekan. Sengaja hanya dari `waived`: menarik
 * kembali tagihan yang sudah dinyatakan lunas akan membuat catatan kas
 * berselisih dengan uang yang benar-benar sudah diterima.
 */
export function restoreDuesInvoice(input: {
  invoiceId: string
  actorId: string
}): DuesInvoice | null {
  const invoice = getDuesInvoice(input.invoiceId)
  if (!invoice) return null
  if (invoice.status !== 'waived') throw new Error('invalid_dues_state')

  const at = now()
  const next = invoice.dueAt < at ? 'overdue' : 'unpaid'
  const result = db
    .prepare(
      "UPDATE dues_invoices SET status=?, verifier_note='', verified_by=? WHERE id=? AND status='waived'",
    )
    .run(next, input.actorId, invoice.id)
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

/* ---------------- penerbitan bulanan otomatis ---------------- */

/** Periode berjalan dalam waktu setempat server (Asia/Jakarta di produksi). */
export function periodOf(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export interface AutoDuesResult {
  communityId: string
  period: string
  created: number
  /** Tagihan yang baru terbit, supaya pemanggil dapat mengirim notifikasi. */
  invoices: DuesInvoice[]
}

/**
 * Terbitkan iuran rutin untuk setiap tenant yang mengaktifkannya. Aman
 * dijalankan berkali-kali: UNIQUE(community,member,period) membuat tagihan
 * yang sudah ada dilewati, bukan digandakan.
 *
 * Hanya kepala keluarga yang ditagih — sama persis dengan penerbitan manual,
 * supaya hasil otomatis tidak pernah berbeda dari yang dikerjakan pengurus.
 */
export function runAutoMonthlyDues(at = now()): AutoDuesResult[] {
  const period = periodOf(at)
  const rows = db
    .prepare(
      `SELECT community_id FROM dues_settings
       WHERE auto_monthly=1 AND amount>0`,
    )
    .all() as { community_id: string }[]

  const out: AutoDuesResult[] = []
  for (const row of rows) {
    const heads = listBillableHouseholdHeads(row.community_id)
    if (!heads.length) continue
    try {
      const result = generateDuesInvoices({
        communityId: row.community_id,
        // Penerbitan otomatis tidak punya pelaku manusia; dicatat atas nama
        // penanggung jawab terakhir yang menyimpan pengaturan iuran.
        actorId: getDuesSettings(row.community_id)?.updatedBy ?? heads[0]!.id,
        period,
        memberIds: heads.map((head) => head.id),
      })
      if (result.created > 0) {
        // Hanya yang benar-benar baru; invoices juga memuat tagihan lama yang
        // sudah ada untuk periode itu, dan warga tidak boleh diberi tahu dua kali.
        const fresh = result.invoices.filter((invoice) => invoice.createdAt >= at - 60_000)
        out.push({ communityId: row.community_id, period, created: result.created, invoices: fresh })
      }
    } catch {
      // Satu tenant bermasalah tidak boleh menghentikan tenant lain.
      continue
    }
  }
  return out
}

/**
 * Diperiksa tiap 6 jam, bukan tepat tengah malam: mesin Fly bisa restart kapan
 * saja, dan pemeriksaan berkala membuat tagihan tetap terbit walau restartnya
 * jatuh persis di pergantian bulan.
 */
export function startDuesScheduler(
  intervalMs = 6 * 60 * 60 * 1000,
  onRun?: (results: AutoDuesResult[]) => void,
): () => void {
  const tick = () => {
    try {
      const results = runAutoMonthlyDues()
      if (results.length && onRun) onRun(results)
    } catch {
      // dibiarkan: penjadwal tidak boleh menjatuhkan proses server
    }
  }
  tick()
  const id = setInterval(tick, intervalMs)
  id.unref?.()
  return () => clearInterval(id)
}
