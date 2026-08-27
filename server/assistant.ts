import { audit, db, now, uid, type MemberRow } from './db.js'
import { decryptSensitiveJson, encryptSensitiveJson } from './crypto.js'
import { refreshExpiredHubItems } from './community-hub.js'
import { canManageScope } from './community-ops.js'

/** Jawaban wajib ini dipakai jika data tenant yang diminta tidak tersedia. */
export const ASSISTANT_NO_DATA = 'Saya tidak menemukan informasi tersebut di sistem.'

export type AssistantSource =
  | 'dues'
  | 'letters'
  | 'guests'
  | 'patrols'
  | 'voting'
  | 'complaints'
  | 'none'

export interface AssistantAnswer {
  answer: string
  /** Tidak ada model eksternal: semua jawaban diringkas dari query tenant. */
  mode: 'tenant_data'
  source: AssistantSource
  historyId: string
  suggestions: { label: string; path: string }[]
}

export interface AssistantHistoryEntry {
  id: string
  question: string
  answer: string
  source: AssistantSource
  createdAt: number
}

type DataAnswer = Omit<AssistantAnswer, 'historyId'>

type InvoiceRow = {
  label: string
  amount: number
  period: string
  due_at: number
  status: string
}

type HubRow = {
  id: string
  title: string
  status: string
  metadata: string
  updated_at: number
  created_by: string
}

function rupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount)
}

function date(epoch: number): string {
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(epoch)
}

function activePrivileged(me: MemberRow): boolean {
  return me.role === 'admin' || me.role === 'superadmin' || me.role === 'satpam'
}

function json(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function dataAnswer(answer: string, source: Exclude<AssistantSource, 'none'>, label: string, path: string): DataAnswer {
  return { answer, source, mode: 'tenant_data', suggestions: [{ label, path }] }
}

function empty(): DataAnswer {
  return { answer: ASSISTANT_NO_DATA, source: 'none', mode: 'tenant_data', suggestions: [] }
}

function duesAnswer(me: MemberRow): DataAnswer {
  if (!me.community_id) return empty()
  // Ringkasan seluruh kas hanya untuk Admin 2 (atau Superadmin), sama seperti
  // endpoint iuran. Admin 1/Admin 3 tetap bisa menanyakan tagihan dirinya
  // sendiri, tetapi tidak memperoleh daftar/total tetangga lewat Assistant.
  if (canManageScope(me, 'dues')) {
    const row = db.prepare(
      `SELECT count(*) AS invoices,
              coalesce(sum(amount),0) AS billed,
              coalesce(sum(CASE WHEN status='paid' THEN amount ELSE 0 END),0) AS paid,
              coalesce(sum(CASE WHEN status IN ('unpaid','overdue','awaiting_verification') THEN 1 ELSE 0 END),0) AS open
       FROM dues_invoices WHERE community_id=?`,
    ).get(me.community_id) as { invoices: number; billed: number; paid: number; open: number }
    if (!row.invoices) return empty()
    return dataAnswer(
      `Data iuran lingkungan: ${row.invoices} tagihan, total ${rupiah(row.billed)}, terverifikasi ${rupiah(row.paid)}, dan ${row.open} tagihan belum lunas atau menunggu verifikasi.`,
      'dues', 'Buka iuran lingkungan', '/app/dues',
    )
  }
  const invoices = db.prepare(
    `SELECT label,amount,period,due_at,status FROM dues_invoices
     WHERE community_id=? AND member_id=? ORDER BY due_at DESC LIMIT 5`,
  ).all(me.community_id, me.id) as InvoiceRow[]
  if (!invoices.length) return empty()
  const open = invoices.filter((invoice) => invoice.status !== 'paid')
  const current = invoices[0]
  const tail = open.length
    ? ` Ada ${open.length} tagihan pada lima periode terakhir yang belum lunas/menunggu verifikasi.`
    : ' Semua tagihan pada lima periode terakhir sudah terverifikasi lunas.'
  return dataAnswer(
    `Tagihan terbaru Anda adalah ${current.label} periode ${current.period}, ${rupiah(current.amount)}, berstatus ${current.status}, jatuh tempo ${date(current.due_at)}.${tail}`,
    'dues', 'Buka tagihan saya', '/app/dues',
  )
}

function lettersAnswer(me: MemberRow): DataAnswer {
  if (!me.community_id) return empty()
  const isAdmin = me.role === 'admin' || me.role === 'superadmin'
  const rows = db.prepare(
    `SELECT id,title,status,metadata,updated_at,created_by FROM community_hub_items
     WHERE community_id=? AND kind='letter' ${isAdmin ? '' : 'AND created_by=?'}
     ORDER BY updated_at DESC LIMIT 5`,
  ).all(me.community_id, ...(isAdmin ? [] : [me.id])) as HubRow[]
  if (!rows.length) return empty()
  const latest = rows[0]
  const meta = json(latest.metadata)
  const type = typeof meta.letterType === 'string' ? meta.letterType : latest.title
  const number = typeof meta.letterNumber === 'string' ? ` Nomor surat: ${meta.letterNumber}.` : ''
  const prefix = isAdmin ? `Terdapat ${rows.length} permohonan surat terbaru yang dapat Anda kelola.` : 'Permohonan surat terbaru Anda'
  return dataAnswer(
    `${prefix} ${type} berstatus ${latest.status}, terakhir diperbarui ${date(latest.updated_at)}.${number}`,
    'letters', isAdmin ? 'Kelola surat warga' : 'Lihat surat saya', '/app/community?tab=letters',
  )
}

function complaintsAnswer(me: MemberRow): DataAnswer {
  if (!me.community_id) return empty()
  const isAdmin = me.role === 'admin' || me.role === 'superadmin'
  const rows = db.prepare(
    `SELECT id,title,status,metadata,updated_at,created_by FROM community_hub_items
     WHERE community_id=? AND kind='complaint' ${isAdmin ? '' : 'AND created_by=?'}
     ORDER BY updated_at DESC LIMIT 8`,
  ).all(me.community_id, ...(isAdmin ? [] : [me.id])) as HubRow[]
  if (!rows.length) return empty()
  const latest = rows[0]
  if (isAdmin) {
    const unfinished = rows.filter((row) => !['RESOLVED', 'CLOSED'].includes(row.status)).length
    return dataAnswer(
      `Ada ${unfinished} aduan terbaru yang masih dalam proses dari ${rows.length} aduan yang ditemukan. Aduan terakhir, “${latest.title}”, berstatus ${latest.status}.`,
      'complaints', 'Kelola aduan', '/app/community?tab=complaints',
    )
  }
  return dataAnswer(
    `Aduan terbaru Anda, “${latest.title}”, berstatus ${latest.status} dan terakhir diperbarui ${date(latest.updated_at)}.`,
    'complaints', 'Lihat aduan saya', '/app/community?tab=complaints',
  )
}

function votingAnswer(me: MemberRow): DataAnswer {
  if (!me.community_id) return empty()
  refreshExpiredHubItems(me.community_id)
  const polls = db.prepare(
    `SELECT id,title,status,metadata,updated_at,created_by FROM community_hub_items
     WHERE community_id=? AND kind='poll' ORDER BY updated_at DESC LIMIT 4`,
  ).all(me.community_id) as HubRow[]
  if (!polls.length) return empty()
  const poll = polls[0]
  const count = db.prepare(
    "SELECT count(*) AS count FROM community_hub_actions WHERE item_id=? AND action='vote'",
  ).get(poll.id) as { count: number }
  const total = db.prepare(
    "SELECT count(*) AS count FROM members WHERE community_id=? AND status='active'",
  ).get(me.community_id) as { count: number }
  const percent = total.count ? Math.round((count.count / total.count) * 100) : 0
  // Tidak pernah sebut siapa memilih apa—bahkan bila polling tidak anonim.
  return dataAnswer(
    `Voting terbaru “${poll.title}” berstatus ${poll.status}. Tercatat ${count.count} suara dari ${total.count} warga aktif (${percent}% partisipasi).`,
    'voting', 'Buka voting', '/app/engagement',
  )
}

function guestsAnswer(me: MemberRow): DataAnswer {
  if (!me.community_id || !activePrivileged(me)) return empty()
  const where = me.role === 'satpam' ? 'AND recorded_by=?' : ''
  const rows = db.prepare(
    `SELECT name,purpose,check_in,check_out FROM guests
     WHERE community_id=? ${where} ORDER BY check_in DESC LIMIT 20`,
  ).all(me.community_id, ...(me.role === 'satpam' ? [me.id] : [])) as {
    name: string; purpose: string; check_in: number; check_out: number | null
  }[]
  if (!rows.length) return empty()
  const inside = rows.filter((guest) => guest.check_out === null).length
  const latest = rows[0]
  // Nama tamu/nomor identitas tidak keluar lewat assistant: cukup status operasional.
  return dataAnswer(
    `Data buku tamu yang dapat Anda akses mencatat ${rows.length} kunjungan terbaru, ${inside} masih tercatat di dalam. Kunjungan terakhir dicatat ${date(latest.check_in)}${latest.purpose ? ` untuk ${latest.purpose}` : ''}.`,
    'guests', 'Buka buku tamu', '/app/guests',
  )
}

function patrolsAnswer(me: MemberRow): DataAnswer {
  if (!me.community_id || !activePrivileged(me)) return empty()
  const where = me.role === 'satpam' ? 'AND satpam_id=?' : ''
  const rows = db.prepare(
    `SELECT checkpoint_name,at,status FROM patrol_logs
     WHERE community_id=? ${where} ORDER BY at DESC LIMIT 20`,
  ).all(me.community_id, ...(me.role === 'satpam' ? [me.id] : [])) as {
    checkpoint_name: string; at: number; status: string
  }[]
  if (!rows.length) return empty()
  const latest = rows[0]
  return dataAnswer(
    `Terdapat ${rows.length} catatan ronda terbaru yang dapat Anda akses. Log terakhir berada di titik “${latest.checkpoint_name}” pada ${date(latest.at)}, dengan status ${latest.status}.`,
    'patrols', 'Buka ronda', '/app/patrol',
  )
}

function answerFromTenant(me: MemberRow, question: string): DataAnswer {
  const q = question.toLocaleLowerCase('id-ID')
  if (/iuran|tagihan|kas|ipl|pembayaran/.test(q)) return duesAnswer(me)
  if (/surat|pengantar|domisili|keterangan/.test(q)) return lettersAnswer(me)
  if (/aduan|keluhan|lampu|jalan|sampah/.test(q)) return complaintsAnswer(me)
  if (/vot|poll|musyawarah|suara/.test(q)) return votingAnswer(me)
  if (/tamu|kunjungan|buku tamu/.test(q)) return guestsAnswer(me)
  if (/ronda|patrol|pos jaga|checkpoint/.test(q)) return patrolsAnswer(me)
  return empty()
}

function encryptedText(text: string): string {
  return encryptSensitiveJson({ text })
}

function readEncryptedText(stored: string): string | null {
  try {
    const result = decryptSensitiveJson<{ text?: unknown }>(stored)
    return typeof result?.text === 'string' ? result.text : null
  } catch {
    // Rekaman rusak atau kunci berbeda tidak boleh berubah menjadi data yang
    // tampak valid. UI cukup tidak menampilkan entri tersebut.
    return null
  }
}

/**
 * Menjawab hanya dengan query tenant yang diizinkan, lalu menyimpan pertanyaan
 * dan jawaban terenkripsi. Audit sengaja hanya menyimpan source, bukan teks.
 */
export async function answerAssistant(me: MemberRow, rawQuestion: unknown): Promise<AssistantAnswer> {
  if (!me.community_id || typeof rawQuestion !== 'string') throw new Error('invalid_question')
  const question = rawQuestion.replaceAll('\u0000', '').trim().slice(0, 700)
  if (question.length < 3) throw new Error('invalid_question')

  const result = answerFromTenant(me, question)
  const id = uid('ai_')
  const at = now()
  db.prepare(
    `INSERT INTO assistant_history (id,community_id,member_id,question,answer,source,created_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(id, me.community_id, me.id, encryptedText(question), encryptedText(result.answer), result.source, at)
  audit(me.community_id, me.id, 'assistant.question', result.source)
  return { ...result, historyId: id }
}

/** Riwayat selalu privat untuk pemilik; isi didekripsi hanya tepat sebelum dikirim kepadanya. */
export function assistantHistory(me: MemberRow, limit = 30): AssistantHistoryEntry[] {
  if (!me.community_id) return []
  const safeLimit = Math.max(1, Math.min(Math.trunc(limit) || 30, 100))
  const rows = db.prepare(
    `SELECT id,question,answer,source,created_at FROM assistant_history
     WHERE community_id=? AND member_id=? ORDER BY created_at DESC LIMIT ?`,
  ).all(me.community_id, me.id, safeLimit) as {
    id: string; question: string; answer: string; source: AssistantSource; created_at: number
  }[]
  const entries = rows.flatMap((row) => {
    const question = readEncryptedText(row.question)
    const answer = readEncryptedText(row.answer)
    return question && answer ? [{
      id: row.id, question, answer, source: row.source, createdAt: row.created_at,
    }] : []
  })
  audit(me.community_id, me.id, 'assistant.history.read', String(entries.length))
  return entries
}
