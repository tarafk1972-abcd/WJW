import bcrypt from 'bcryptjs'
import Database from 'better-sqlite3'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

export const SUPERADMIN_EMAIL = 'tarafk1972@gmail.com'
export const TRIAL_DAYS = 14
export const DAY = 86_400_000
export const SESSION_DAYS = 30

const DB_PATH = process.env.WJW_DB ?? join(HERE, 'data', 'wjw.sqlite')

// Folder data tidak ikut Git (.gitignore), jadi pada clone baru folder ini
// belum ada dan better-sqlite3 akan gagal. Buat lebih dulu.
mkdirSync(dirname(DB_PATH), { recursive: true })

export const db = new Database(DB_PATH)
db.exec(readFileSync(join(HERE, 'schema.sql'), 'utf8'))

export function uid(prefix = ''): string {
  return prefix + randomBytes(9).toString('base64url')
}

export function now(): number {
  return Date.now()
}

/* ---------------- sandi ---------------- */

const BCRYPT_ROUNDS = 10

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, BCRYPT_ROUNDS)
}

export function verifyPassword(plain: string, hash: string): boolean {
  try {
    return bcrypt.compareSync(plain, hash)
  } catch {
    return false
  }
}

/* ---------------- sesi ---------------- */

export function createSession(memberId: string, deviceId?: string): string {
  const token = randomBytes(32).toString('base64url')
  db.prepare(
    `INSERT INTO sessions (token, member_id, created_at, expires_at, device_id)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(token, memberId, now(), now() + SESSION_DAYS * DAY, deviceId ?? null)
  return token
}

export function memberFromToken(token: string | null): MemberRow | null {
  if (!token) return null
  const row = db
    .prepare(
      `SELECT m.* FROM sessions s
       JOIN members m ON m.id = s.member_id
       WHERE s.token = ? AND s.expires_at > ?`,
    )
    .get(token, now()) as MemberRow | undefined
  return row ?? null
}

export function destroySession(token: string) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

/** Buang sesi kedaluwarsa; dipanggil berkala. */
export function purgeSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now())
}

/* ---------------- tipe baris ---------------- */

export interface MemberRow {
  id: string
  community_id: string | null
  name: string
  phone: string
  email: string
  password_hash: string
  house: string
  role: string
  status: string
  language: string
  device_id: string | null
  created_at: number
  decided_at: number | null
  decided_by: string | null
  rejected_reason: string | null
  invited_by: string | null
  emergency: string | null
  join_method: string | null
  join_code: string | null
  join_note: string
}

/** Bentuk anggota yang aman dikirim ke klien — tanpa hash sandi. */
export function publicMember(m: MemberRow) {
  return {
    id: m.id,
    communityId: m.community_id,
    name: m.name,
    phone: m.phone,
    email: m.email,
    house: m.house,
    role: m.role,
    status: m.status,
    language: m.language,
    deviceId: m.device_id,
    createdAt: m.created_at,
    decidedAt: m.decided_at,
    decidedBy: m.decided_by,
    rejectedReason: m.rejected_reason ?? undefined,
    invitedBy: m.invited_by,
    emergency: m.emergency ? JSON.parse(m.emergency) : undefined,
    joinMethod: m.join_method ?? undefined,
    joinCode: m.join_code,
    joinNote: m.join_note,
  }
}

/**
 * Anggota lain hanya boleh melihat data yang perlu — nomor telepon tetap
 * ditampilkan karena dipakai untuk menghubungi saat darurat, tetapi profil
 * medis hanya untuk pemiliknya, satpam dan admin.
 */
export function visibleMember(m: MemberRow, viewer: MemberRow) {
  const pub = publicMember(m)
  const privileged =
    viewer.id === m.id ||
    viewer.role === 'admin' ||
    viewer.role === 'satpam' ||
    viewer.role === 'superadmin'
  if (!privileged) delete (pub as { emergency?: unknown }).emergency
  return pub
}

export function audit(
  communityId: string | null,
  actorId: string,
  action: string,
  detail = '',
) {
  db.prepare(
    'INSERT INTO audit (id, community_id, actor_id, action, detail, at) VALUES (?,?,?,?,?,?)',
  ).run(uid('a_'), communityId, actorId, action, detail, now())
}

/* ---------------- superadmin ---------------- */

/**
 * Memastikan akun superadmin ada. Sandi diambil dari WJW_SUPERADMIN_PASSWORD;
 * bila tidak diset, dibuat acak dan dicetak sekali ke log agar tidak ada
 * sandi bawaan yang bisa ditebak di produksi.
 */
export function ensureSuperadmin(): void {
  const existing = db
    .prepare('SELECT id FROM members WHERE lower(email) = lower(?)')
    .get(SUPERADMIN_EMAIL)
  if (existing) return

  const plain =
    process.env.WJW_SUPERADMIN_PASSWORD || randomBytes(9).toString('base64url')
  db.prepare(
    `INSERT INTO members
     (id, community_id, name, phone, email, password_hash, house, role, status,
      language, created_at, decided_at)
     VALUES (?,NULL,?,?,?,?,'-','superadmin','active','id',?,?)`,
  ).run(
    'superadmin',
    'Superadmin',
    '+620000000000',
    SUPERADMIN_EMAIL,
    hashPassword(plain),
    now(),
    now(),
  )
  if (!process.env.WJW_SUPERADMIN_PASSWORD) {
    console.log(
      `\n[WJW] Akun superadmin dibuat\n      email: ${SUPERADMIN_EMAIL}\n      sandi: ${plain}\n      (set WJW_SUPERADMIN_PASSWORD untuk menentukan sendiri)\n`,
    )
  }
}
