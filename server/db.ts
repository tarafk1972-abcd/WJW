import bcrypt from 'bcryptjs'
import Database from 'better-sqlite3'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(HERE)

// Muat .env bila ada, tanpa dependensi tambahan. Nilai yang sudah ada di
// environment tetap menang, agar bisa ditimpa saat menjalankan perintah.
try {
  const raw = readFileSync(join(ROOT, '.env'), 'utf8')
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (!m) continue
    const key = m[1]
    const val = m[2].replace(/^["']|["']$/g, '')
    if (process.env[key] === undefined) process.env[key] = val
  }
} catch {
  // .env opsional — abaikan bila tidak ada
}

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

/**
 * Tambahkan kolom yang belum ada pada basis data lama.
 *
 * `ALTER TABLE` tidak bisa ditaruh di schema.sql karena akan gagal pada
 * pemasangan yang kolomnya sudah ada, dan itu menghentikan seluruh boot.
 */
function addColumn(table: string, column: string, type: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (cols.some((c) => c.name === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}

/*
 * Posisi terakhir yang diketahui, untuk menentukan siapa yang berada di
 * dekat sebuah peringatan. Hanya satu titik per anggota — bukan riwayat
 * perjalanan; yang dibutuhkan hanyalah "siapa di dekat sini sekarang".
 */
addColumn('members', 'last_lat', 'REAL')
addColumn('members', 'last_lng', 'REAL')
addColumn('members', 'last_seen_at', 'INTEGER')
addColumn('members', 'last_accuracy', 'REAL')

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
 * Memastikan akun superadmin ada.
 *
 * Sandi diambil dari WJW_SUPERADMIN_PASSWORD. Bila diset, sandi itu juga
 * diterapkan ulang setiap kali server dijalankan — supaya akun tidak pernah
 * terkunci hanya karena log berisi sandi acak sudah hilang.
 *
 * Bila tidak diset, sandi dibuat acak dan dicetak sekali, agar tidak ada
 * sandi bawaan yang bisa ditebak di produksi.
 */
/**
 * Penanda sandi .env yang terakhir diterapkan.
 *
 * Yang disimpan adalah hash dari penanda, bukan sandinya — cukup untuk
 * mengetahui apakah nilai .env berubah, tanpa menyimpan sandi yang bisa
 * dibaca kembali.
 */
function envMarker(password: string): string {
  return password + '|env'
}

function rememberEnvPassword(password: string): void {
  db.prepare(
    `INSERT INTO settings (key, value, at) VALUES ('superadmin.envPassword',?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, at=excluded.at`,
  ).run(hashPassword(envMarker(password)), now())
}

/**
 * Beri nama sementara pada lingkungan yang tersimpan tanpa nama.
 *
 * Versi lama menerima nama kosong saat mendaftar. Nama itu tampil di
 * bagian atas aplikasi; ketika kosong, satu-satunya nama yang terlihat di
 * situ tinggal nama adminnya — seolah lingkungan bernama seperti
 * pengurusnya. Beri penanda yang jelas agar admin tahu harus
 * menggantinya lewat Admin -> ketuk nama lingkungan.
 */
export function fixUnnamedCommunities(): number {
  const rows = db
    .prepare("SELECT id FROM communities WHERE trim(coalesce(name,'')) = ''")
    .all() as { id: string }[]

  for (const r of rows) {
    db.prepare('UPDATE communities SET name=? WHERE id=?').run(
      'Lingkungan tanpa nama',
      r.id,
    )
  }
  if (rows.length > 0)
    console.log(
      `[WJW] ${rows.length} lingkungan tanpa nama diberi nama sementara — ganti lewat menu Admin.`,
    )
  return rows.length
}

export function ensureSuperadmin(): void {
  const existing = db
    .prepare('SELECT id FROM members WHERE lower(email) = lower(?)')
    .get(SUPERADMIN_EMAIL) as { id: string } | undefined

  if (existing) {
    /*
     * Terapkan sandi dari environment HANYA bila isinya berubah.
     *
     * Sebelumnya sandi ditulis ulang pada setiap boot. Akibatnya
     * `npm run reset-password` seolah berhasil — pesannya muncul, sandi
     * benar-benar tersimpan — lalu dibatalkan diam-diam begitu server
     * dinyalakan ulang, dan login gagal tanpa sebab yang terlihat.
     *
     * Nilai .env tetap bisa memulihkan akses: cukup ubah isinya lalu
     * jalankan ulang server.
     */
    const fromEnv = process.env.WJW_SUPERADMIN_PASSWORD
    if (fromEnv) {
      // Tabel settings dibaca langsung: server/settings.ts mengimpor modul
      // ini, jadi mengimpornya balik akan melingkar.
      const row = db
        .prepare("SELECT value FROM settings WHERE key='superadmin.envPassword'")
        .get() as { value: string } | undefined

      // Bandingkan lewat penanda ber-hash, bukan sandi mentah: sandi tidak
      // boleh tersimpan dalam bentuk yang bisa dibaca kembali.
      const same = row ? verifyPassword(envMarker(fromEnv), row.value) : false

      if (!same) {
        db.prepare('UPDATE members SET password_hash = ? WHERE id = ?').run(
          hashPassword(fromEnv),
          existing.id,
        )
        rememberEnvPassword(fromEnv)
      }
    }
    // Lepaskan perangkat yang terlanjur diklaim versi lama. Selama masih
    // menempel, halaman depan menyapa "Superadmin" dan menyembunyikan
    // tombol Masuk, sehingga tidak ada jalan kembali ke Konsol.
    db.prepare('UPDATE members SET device_id = NULL WHERE id = ? AND device_id IS NOT NULL').run(
      existing.id,
    )
    return
  }

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

  // Catat sandi .env yang dipakai, agar boot berikutnya tidak menimpa
  // sandi yang mungkin sudah diganti lewat `npm run reset-password`.
  if (process.env.WJW_SUPERADMIN_PASSWORD)
    rememberEnvPassword(process.env.WJW_SUPERADMIN_PASSWORD)
  if (!process.env.WJW_SUPERADMIN_PASSWORD) {
    console.log(
      `\n[WJW] Akun superadmin dibuat\n      email: ${SUPERADMIN_EMAIL}\n      sandi: ${plain}\n      (set WJW_SUPERADMIN_PASSWORD untuk menentukan sendiri)\n`,
    )
  }
}
