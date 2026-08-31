import bcrypt from 'bcryptjs'
import Database from 'better-sqlite3'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  decryptSensitiveJson,
  encryptSensitiveJson,
  ensureSensitiveEncryptionConfigured,
} from './crypto.js'

const HERE = dirname(fileURLToPath(import.meta.url))
// tsx lokal menjalankan /app/server/db.ts, sementara image produksi memakai
// /app/build/server/db.js. `.env` tetap dicari dari root proyek pada keduanya.
const parent = dirname(HERE)
const ROOT = existsSync(join(parent, 'package.json')) ? parent : dirname(parent)

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

// Jangan mengizinkan deployment produksi menulis profil medis/snapshot
// darurat tanpa enkripsi at-rest. Pengembangan dan tes lokal tetap boleh
// tanpa kunci agar pemasangan awal mudah dijalankan.
ensureSensitiveEncryptionConfigured()

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

/*
 * Letak rumah warga.
 *
 * Rumah tidak berpindah, jadi cukup dicatat SEKALI saat mendaftar.
 * Inilah yang membuat warga tetap terhitung sebagai tetangga terdekat
 * walaupun aplikasinya sedang tertutup — tanpa pembacaan berkala dan
 * tanpa melacak pergerakannya sama sekali.
 */
addColumn('members', 'home_lat', 'REAL')
addColumn('members', 'home_lng', 'REAL')
addColumn('members', 'home_accuracy', 'REAL')
addColumn('members', 'home_set_at', 'INTEGER')
/** 'register' | 'manual' — dari mana titik ini berasal. */
addColumn('members', 'home_source', 'TEXT')

// Evolusi Phase 1: laporan SOS lama tetap terbaca, tetapi semua laporan baru
// memakai state machine insiden dan kunci idempotensi. Kolom payload juga
// ditambahkan eksplisit agar deployment yang sangat lama dapat dimigrasi
// sebelum blob SOS-nya dienkripsi di bawah.
addColumn('reports', 'attachments', "TEXT NOT NULL DEFAULT '[]'")
addColumn('reports', 'messages', "TEXT NOT NULL DEFAULT '[]'")
addColumn('reports', 'responders', "TEXT NOT NULL DEFAULT '[]'")
addColumn('reports', 'track', "TEXT NOT NULL DEFAULT '[]'")
addColumn('reports', 'snapshot', 'TEXT')
addColumn('reports', 'recipients', "TEXT NOT NULL DEFAULT '[]'")
addColumn('reports', 'audio', 'TEXT')
addColumn('reports', 'incident_status', "TEXT NOT NULL DEFAULT 'NEW'")
addColumn('reports', 'idempotency_key', 'TEXT')
// Jadwal lama tetap berlaku untuk seluruh satpam sampai Admin 3 menetapkan
// personel spesifik. Kolom ini perlu migrasi eksplisit karena SQLite tidak
// menerapkan DEFAULT dari CREATE TABLE pada tabel schedules yang sudah ada.
addColumn('schedules', 'assigned_satpam_ids', "TEXT NOT NULL DEFAULT '[]'")
// Pengumuman lama tetap menjadi "Umum untuk semua". Kolom ini tidak boleh
// hanya ada pada schema baru karena banyak deployment sudah punya tabelnya.
addColumn('announcements', 'category', "TEXT NOT NULL DEFAULT 'Umum'")
addColumn('announcements', 'target_scope', "TEXT NOT NULL DEFAULT 'all'")
addColumn('announcements', 'target_value', "TEXT NOT NULL DEFAULT ''")
db.exec(
  'CREATE INDEX IF NOT EXISTS idx_announcements_community_target ON announcements(community_id, target_scope, created_at DESC)',
)
// Paket WJW/masa trial dipisahkan dari tagihan iuran lingkungan maupun durasi
// invoice monthly/yearly. Migrasi mempertahankan tenant lama sebagai FREE.
addColumn('communities', 'subscription_tier', "TEXT NOT NULL DEFAULT 'FREE'")
addColumn('communities', 'subscription_status', "TEXT NOT NULL DEFAULT 'trial'")
addColumn('communities', 'subdomain', "TEXT NOT NULL DEFAULT ''")
db.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_communities_subdomain ON communities(lower(subdomain)) WHERE subdomain <> ''",
)
// Tenant yang pada versi lama sudah disuspensi mempertahankan blokirnya.
db.exec("UPDATE communities SET subscription_status='suspended' WHERE plan='suspended'")
db.exec(
  `UPDATE reports
   SET incident_status = CASE status
     WHEN 'ack' THEN 'RESPONDING'
     WHEN 'resolved' THEN 'RESOLVED'
     ELSE 'NEW'
   END
   WHERE incident_status IS NULL OR incident_status = ''`,
)
db.exec(
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_idempotency
   ON reports(author_id, idempotency_key) WHERE idempotency_key IS NOT NULL`,
)

// Buku tamu versi lama menyimpan nomor identitas sebagai teks. Nilai itu tidak
// lagi dikirim ke browser dan, saat kunci tersedia (wajib di produksi),
// dienkripsi sekali pada boot tanpa mengubah data operasional lainnya.
const legacyGuestIdentities = db
  .prepare("SELECT id,id_card FROM guests WHERE id_card<>'' AND id_card NOT LIKE 'enc:v1:%'")
  .all() as { id: string; id_card: string }[]
if (legacyGuestIdentities.length) {
  const migrateGuestIdentity = db.prepare('UPDATE guests SET id_card=? WHERE id=?')
  const migrate = db.transaction(() => {
    for (const guest of legacyGuestIdentities)
      migrateGuestIdentity.run(encryptSensitiveJson({ idCard: guest.id_card }), guest.id)
  })
  migrate()
}

/*
 * Bukti, koordinat jejak, pesan, dan roster penerima SOS pernah disimpan
 * sebagai JSON plaintext. Saat kunci tersedia (wajib produksi), pindahkan
 * seluruh blob JSON lama sekali di boot. Kolom relasional seperti status dan
 * waktu tetap terbaca untuk operasi tanpa membuka isi sensitifnya.
 */
const SOS_SENSITIVE_COLUMNS = ['attachments', 'messages', 'responders', 'track', 'recipients', 'snapshot', 'audio'] as const
type SosSensitiveColumn = (typeof SOS_SENSITIVE_COLUMNS)[number]
if (process.env.WJW_DATA_ENCRYPTION_KEY) {
  type SosSensitiveRow = Record<SosSensitiveColumn, string | null> & {
    id: string
    migration_rowid: number
  }
  // Jangan `.all()` seluruh bukti foto historis pada boot. Batch kecil
  // menjaga memori Machine tetap terkendali ketika database telah tumbuh.
  const selectSosBatch = db.prepare(
    `SELECT rowid AS migration_rowid,id,${SOS_SENSITIVE_COLUMNS.join(',')}
     FROM reports WHERE kind='sos' AND rowid>? ORDER BY rowid LIMIT ?`,
  )
  const migrateSos = db.prepare(
    `UPDATE reports SET ${SOS_SENSITIVE_COLUMNS.map((column) => `${column}=?`).join(',')} WHERE id=?`,
  )
  const migrateBatch = db.transaction((rows: SosSensitiveRow[]) => {
    for (const report of rows) {
      let changed = false
      const values = SOS_SENSITIVE_COLUMNS.map((column) => {
        const stored = report[column]
        if (!stored || stored.startsWith('enc:v1:')) return stored
        try {
          // Audio lama berupa data URL, sedangkan enam kolom lain JSON.
          const encrypted = encryptSensitiveJson(column === 'audio' ? stored : JSON.parse(stored))
          changed ||= encrypted !== stored
          return encrypted
        } catch {
          // JSON korup sudah tidak dapat diproyeksikan versi lama juga. Jangan
          // menimpa/menghapusnya saat migrasi otomatis; akses tetap fail-closed.
          return stored
        }
      })
      if (changed) migrateSos.run(...values, report.id)
    }
  })
  let lastRowId = 0
  while (true) {
    const batch = selectSosBatch.all(lastRowId, 8) as SosSensitiveRow[]
    if (!batch.length) break
    migrateBatch(batch)
    lastRowId = batch[batch.length - 1].migration_rowid
  }
}

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

/** Field anggota umum — sengaja tanpa profil medis dan hash sandi. */
function memberPublicFields(m: MemberRow) {
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
    joinMethod: m.join_method ?? undefined,
    joinCode: m.join_code,
    joinNote: m.join_note,
  }
}

/** Bentuk anggota sendiri yang aman dikirim ke klien — tanpa hash sandi. */
export function publicMember(m: MemberRow) {
  return {
    ...memberPublicFields(m),
    emergency: m.emergency ? decryptSensitiveJson(m.emergency) ?? undefined : undefined,
  }
}

/**
 * Anggota lain hanya menerima data yang benar-benar perlu. Nomor HP warga
 * biasa, email, alamat rumah, dan profil medis tidak boleh masuk ke cache
 * ponsel tetangga hanya karena `/api/state` memuat daftar anggota. Nomor HP
 * admin/satpam tetap tersedia bagi warga untuk koordinasi keadaan darurat.
 *
 * Bahkan admin/satpam tidak menerima profil medis warga secara massal. Data
 * medis hanya dibuka dari snapshot SOS untuk insiden yang boleh mereka tangani
 * (lihat `mapReport`), sehingga ponsel petugas tidak menyimpan seluruh riwayat
 * kesehatan tenant ketika tidak ada keadaan darurat.
 */
export function visibleMember(m: MemberRow, viewer: MemberRow) {
  const pub = memberPublicFields(m)
  const operationalViewer =
    viewer.id === m.id ||
    viewer.role === 'admin' ||
    viewer.role === 'satpam' ||
    viewer.role === 'superadmin'
  if (!operationalViewer) {
    return {
      ...pub,
      // Pengurus/petugas jaga adalah kontak operasional yang boleh dihubungi
      // semua anggota aktif; data warga lain tidak dibagikan.
      phone: m.role === 'admin' || m.role === 'satpam' ? m.phone : '',
      email: '',
      house: '',
    }
  }
  return {
    ...pub,
    // Hanya pemilik profil yang mendapatkannya lewat daftar anggota. Snapshot
    // SOS yang berwenang diproyeksikan terpisah dan tidak bergantung pada ini.
    ...(viewer.id === m.id && m.emergency
      ? { emergency: decryptSensitiveJson(m.emergency) ?? undefined }
      : {}),
  }
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
