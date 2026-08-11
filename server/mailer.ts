/**
 * Pengiriman email.
 *
 * Dipakai untuk menagih admin klaster. Dibuat agar aman dijalankan tanpa
 * konfigurasi SMTP — bila belum diatur, email hanya dicatat ke log dan
 * tersimpan di basis data, sehingga penagihan tidak pernah menggagalkan
 * proses lain.
 */
import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { db, now, uid } from './db.js'

const HOST = process.env.SMTP_HOST ?? ''
const PORT = Number(process.env.SMTP_PORT ?? 587)
const USER = process.env.SMTP_USER ?? ''
const PASS = process.env.SMTP_PASS ?? ''

export const MAIL_FROM =
  process.env.MAIL_FROM ?? 'Warga Jaga Warga <noreply@wargajagawarga.app>'
export const MAIL_REPLY_TO = process.env.MAIL_REPLY_TO ?? 'tarafk1972@gmail.com'

export function mailEnabled(): boolean {
  return !!HOST && !!USER
}

let transporter: Transporter | null = null

function getTransport(): Transporter | null {
  if (!mailEnabled()) return null
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: HOST,
      port: PORT,
      // 465 memakai TLS langsung; port lain memakai STARTTLS
      secure: PORT === 465,
      auth: { user: USER, pass: PASS },
    })
  }
  return transporter
}

export interface MailInput {
  to: string
  subject: string
  html: string
  text: string
  /** Untuk penelusuran & mencegah kirim ganda. */
  kind: string
  communityId?: string | null
  memberId?: string | null
}

export interface MailResult {
  ok: boolean
  id: string
  skipped?: boolean
  error?: string
}

/**
 * Kirim satu email dan catat hasilnya.
 * Tidak pernah melempar error — kegagalan email tidak boleh menghentikan
 * penagihan atau pemeriksaan perpanjangan.
 */
export async function sendMail(input: MailInput): Promise<MailResult> {
  const id = uid('em_')
  const t = getTransport()

  if (!t) {
    // Tanpa SMTP: catat sebagai 'skipped' agar tetap terlihat di riwayat.
    db.prepare(
      `INSERT INTO emails (id, community_id, member_id, kind, to_email, subject, status, error, at)
       VALUES (?,?,?,?,?,?,'skipped','SMTP belum dikonfigurasi',?)`,
    ).run(
      id,
      input.communityId ?? null,
      input.memberId ?? null,
      input.kind,
      input.to,
      input.subject,
      now(),
    )
    console.log(`[WJW] Email dilewati (SMTP belum diatur): ${input.subject} → ${input.to}`)
    return { ok: false, id, skipped: true }
  }

  try {
    await t.sendMail({
      from: MAIL_FROM,
      replyTo: MAIL_REPLY_TO,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    })
    db.prepare(
      `INSERT INTO emails (id, community_id, member_id, kind, to_email, subject, status, at)
       VALUES (?,?,?,?,?,?,'sent',?)`,
    ).run(
      id,
      input.communityId ?? null,
      input.memberId ?? null,
      input.kind,
      input.to,
      input.subject,
      now(),
    )
    return { ok: true, id }
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e)
    db.prepare(
      `INSERT INTO emails (id, community_id, member_id, kind, to_email, subject, status, error, at)
       VALUES (?,?,?,?,?,?,'failed',?,?)`,
    ).run(
      id,
      input.communityId ?? null,
      input.memberId ?? null,
      input.kind,
      input.to,
      input.subject,
      msg,
      now(),
    )
    return { ok: false, id, error: msg }
  }
}

/** Verifikasi koneksi SMTP (dipakai superadmin untuk menguji setelan). */
export async function verifyMail(): Promise<{ ok: boolean; error?: string }> {
  const t = getTransport()
  if (!t) return { ok: false, error: 'SMTP belum dikonfigurasi' }
  try {
    await t.verify()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e) }
  }
}
