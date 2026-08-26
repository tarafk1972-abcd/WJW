-- Warga Jaga Warga — skema basis data
-- Semua waktu disimpan sebagai epoch milidetik (INTEGER).

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS communities (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  address         TEXT NOT NULL DEFAULT '',
  city            TEXT NOT NULL DEFAULT '',
  created_at      INTEGER NOT NULL,
  created_by      TEXT NOT NULL DEFAULT '',
  area            TEXT NOT NULL DEFAULT '[]',   -- JSON LatLng[]
  area_updated_at INTEGER,
  area_updated_by TEXT,
  center          TEXT NOT NULL,                -- JSON LatLng
  language        TEXT NOT NULL DEFAULT 'id',
  plan            TEXT NOT NULL DEFAULT 'trial',
  plan_name       TEXT NOT NULL DEFAULT 'trial',
  trial_ends_at   INTEGER NOT NULL,
  paid_until      INTEGER,
  suspended_reason TEXT
);

CREATE TABLE IF NOT EXISTS members (
  id            TEXT PRIMARY KEY,
  community_id  TEXT REFERENCES communities(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL,
  email         TEXT NOT NULL,
  -- bcrypt hash; tidak pernah dikirim ke klien
  password_hash TEXT NOT NULL,
  house         TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'warga',
  status        TEXT NOT NULL DEFAULT 'pending',
  language      TEXT NOT NULL DEFAULT 'id',
  device_id     TEXT,
  created_at    INTEGER NOT NULL,
  decided_at    INTEGER,
  decided_by    TEXT,
  rejected_reason TEXT,
  invited_by    TEXT,
  emergency     TEXT,                            -- JSON EmergencyProfile
  join_method   TEXT,
  join_code     TEXT,
  join_note     TEXT NOT NULL DEFAULT ''
);

-- Email & telepon unik lintas sistem (dicek juga di aplikasi)
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_email ON members(lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_phone ON members(phone);
CREATE INDEX IF NOT EXISTS idx_members_community ON members(community_id, status);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  member_id  TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  device_id  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_member ON sessions(member_id);

CREATE TABLE IF NOT EXISTS reports (
  id            TEXT PRIMARY KEY,
  community_id  TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  author_id     TEXT NOT NULL,
  kind          TEXT NOT NULL,
  category      TEXT NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  at_lat        REAL,
  at_lng        REAL,
  address       TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'open',
  created_at    INTEGER NOT NULL,
  handled_by    TEXT,
  handled_at    INTEGER,
  resolved_note TEXT,
  inside_area   INTEGER,
  anonymous     INTEGER NOT NULL DEFAULT 0,
  attachments   TEXT NOT NULL DEFAULT '[]',
  messages      TEXT NOT NULL DEFAULT '[]',
  responders    TEXT NOT NULL DEFAULT '[]',
  track         TEXT NOT NULL DEFAULT '[]',
  live          INTEGER NOT NULL DEFAULT 0,
  live_ended_at INTEGER,
  audio         TEXT,
  audio_seconds INTEGER NOT NULL DEFAULT 0,
  snapshot      TEXT,
  recipients    TEXT NOT NULL DEFAULT '[]',
  cancelled_at  INTEGER,
  -- Status kanonis insiden; `status` di atas dipertahankan untuk kompatibilitas layar lama.
  incident_status TEXT NOT NULL DEFAULT 'NEW',
  -- Kunci idempotensi dari klien. Satu retry tidak boleh membuat dua darurat.
  idempotency_key TEXT
);
CREATE INDEX IF NOT EXISTS idx_reports_community ON reports(community_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_live ON reports(community_id, live);
-- Index idempotensi dibuat dari db.ts setelah migrasi kolom untuk menjaga
-- database lama yang tabel reports-nya sudah ada tetapi belum punya kolom ini.

-- Timeline append-only untuk setiap perpindahan status dan tindakan penting.
-- Tidak ada endpoint update/delete; satu event tidak boleh menimpa event lain.
CREATE TABLE IF NOT EXISTS incident_timeline (
  id           TEXT PRIMARY KEY,
  incident_id  TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  actor_id     TEXT,
  kind         TEXT NOT NULL,
  from_status  TEXT,
  to_status    TEXT,
  detail       TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_incident_timeline_incident
  ON incident_timeline(incident_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_incident_timeline_community
  ON incident_timeline(community_id, created_at DESC);

CREATE TABLE IF NOT EXISTS invites (
  id           TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  code         TEXT NOT NULL UNIQUE,
  role         TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  used_by      TEXT NOT NULL DEFAULT '[]',
  max_uses     INTEGER,
  revoked_at   INTEGER
);

CREATE TABLE IF NOT EXISTS contacts (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  phone        TEXT NOT NULL,
  kind         TEXT NOT NULL,
  verified     INTEGER NOT NULL DEFAULT 0,
  member_id    TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner_id);

CREATE TABLE IF NOT EXISTS checkpoints (
  id           TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  lat          REAL NOT NULL,
  lng          REAL NOT NULL,
  radius_m     INTEGER NOT NULL DEFAULT 50,
  ord          INTEGER NOT NULL DEFAULT 1,
  created_by   TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS schedules (
  id           TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  start_minute INTEGER NOT NULL,
  end_minute   INTEGER NOT NULL,
  days         TEXT NOT NULL DEFAULT '[]',
  -- kosong berarti seluruh tim satpam; bila terisi hanya nama ini yang dijadwalkan.
  assigned_satpam_ids TEXT NOT NULL DEFAULT '[]',
  grace_min    INTEGER NOT NULL DEFAULT 15,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL
);

-- Tiga penanggung jawab operasional yang ditetapkan oleh pendiri lingkungan.
-- `scope` dibatasi dan dipaksa lagi di API; ini bukan sekadar label UI.
CREATE TABLE IF NOT EXISTS management_responsibilities (
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  scope        TEXT NOT NULL CHECK(scope IN ('map_patrol','dues','patrol_schedule')),
  member_id    TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  assigned_by  TEXT NOT NULL REFERENCES members(id),
  assigned_at  INTEGER NOT NULL,
  PRIMARY KEY (community_id, scope)
);
CREATE INDEX IF NOT EXISTS idx_management_responsibilities_member
  ON management_responsibilities(member_id);

-- Konfigurasi iuran warga. Dipisahkan dari `invoices` SaaS: tagihan di sana
-- adalah langganan platform WJW, bukan uang kas/iuran sebuah lingkungan.
CREATE TABLE IF NOT EXISTS dues_settings (
  community_id         TEXT PRIMARY KEY REFERENCES communities(id) ON DELETE CASCADE,
  label                TEXT NOT NULL DEFAULT 'Iuran Pengelolaan Lingkungan',
  amount               INTEGER NOT NULL DEFAULT 0,
  due_day              INTEGER NOT NULL DEFAULT 10,
  payment_instructions TEXT NOT NULL DEFAULT '',
  updated_by           TEXT NOT NULL REFERENCES members(id),
  updated_at           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dues_invoices (
  id               TEXT PRIMARY KEY,
  community_id     TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  member_id        TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  period           TEXT NOT NULL, -- YYYY-MM
  label            TEXT NOT NULL,
  amount           INTEGER NOT NULL,
  due_at           INTEGER NOT NULL,
  -- unpaid → awaiting_verification → paid; overdue dihitung/ditandai server.
  status           TEXT NOT NULL DEFAULT 'unpaid',
  reference        TEXT NOT NULL UNIQUE,
  payment_note     TEXT NOT NULL DEFAULT '',
  verifier_note    TEXT NOT NULL DEFAULT '',
  created_at       INTEGER NOT NULL,
  generated_by     TEXT NOT NULL REFERENCES members(id),
  claimed_at       INTEGER,
  paid_at          INTEGER,
  verified_by      TEXT REFERENCES members(id),
  UNIQUE (community_id, member_id, period)
);
CREATE INDEX IF NOT EXISTS idx_dues_invoices_community_period
  ON dues_invoices(community_id, period DESC);
CREATE INDEX IF NOT EXISTS idx_dues_invoices_member
  ON dues_invoices(member_id, status, due_at DESC);

CREATE TABLE IF NOT EXISTS patrol_logs (
  id             TEXT PRIMARY KEY,
  community_id   TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  satpam_id      TEXT NOT NULL,
  checkpoint_id  TEXT NOT NULL,
  checkpoint_name TEXT NOT NULL,
  schedule_id    TEXT,
  schedule_label TEXT NOT NULL DEFAULT '',
  at             INTEGER NOT NULL,
  lat            REAL NOT NULL,
  lng            REAL NOT NULL,
  distance_m     INTEGER NOT NULL,
  inside_radius  INTEGER NOT NULL,
  status         TEXT NOT NULL,
  note           TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_logs_community ON patrol_logs(community_id, at DESC);

CREATE TABLE IF NOT EXISTS broadcasts (
  id            TEXT PRIMARY KEY,
  community_id  TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  author_id     TEXT NOT NULL,
  severity      TEXT NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL DEFAULT '',
  instruction   TEXT NOT NULL DEFAULT '',
  require_safety_check INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  responses     TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS announcements (
  id           TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  author_id    TEXT NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  pinned       INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS guests (
  id           TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  purpose      TEXT NOT NULL DEFAULT '',
  host         TEXT NOT NULL DEFAULT '',
  plate        TEXT NOT NULL DEFAULT '',
  id_card      TEXT NOT NULL DEFAULT '',
  check_in     INTEGER NOT NULL,
  check_out    INTEGER,
  recorded_by  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         TEXT PRIMARY KEY,
  member_id  TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_member ON push_subscriptions(member_id);

CREATE TABLE IF NOT EXISTS audit (
  id           TEXT PRIMARY KEY,
  community_id TEXT,
  actor_id     TEXT NOT NULL,
  action       TEXT NOT NULL,
  detail       TEXT NOT NULL DEFAULT '',
  at           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit(at DESC);

-- Tagihan langganan. Pembayaran lewat QRIS ShopeePay, diverifikasi superadmin.
CREATE TABLE IF NOT EXISTS invoices (
  id           TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  -- admin yang ditagih (penerima email)
  member_id    TEXT NOT NULL,
  plan         TEXT NOT NULL,                    -- monthly | yearly
  amount       INTEGER NOT NULL,
  -- pending → awaiting_verification → paid | expired
  status       TEXT NOT NULL DEFAULT 'pending',
  -- nomor rujukan yang DITENTUKAN SISTEM, dicantumkan admin saat membayar.
  -- Bukan input pengguna, sehingga setiap pembayaran mudah dicocokkan.
  reference    TEXT NOT NULL DEFAULT '',
  -- catatan superadmin saat menolak klaim
  note         TEXT,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER,
  claimed_at   INTEGER,
  paid_at      INTEGER,
  verified_by  TEXT,
  created_by   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoices_community ON invoices(community_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);

-- Mencegah tindakan penjadwal terulang (pengingat, tagihan otomatis).
CREATE TABLE IF NOT EXISTS scheduler_claims (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  -- kunci unik per periode; menolak duplikat
  external_id TEXT NOT NULL UNIQUE,
  payload     TEXT NOT NULL,
  at          INTEGER NOT NULL
);

-- Riwayat email yang dikirim ke admin (tagihan, pengingat, kuitansi).
CREATE TABLE IF NOT EXISTS emails (
  id           TEXT PRIMARY KEY,
  community_id TEXT,
  member_id    TEXT,
  kind         TEXT NOT NULL,          -- bill | reminder | expired | paid | test
  to_email     TEXT NOT NULL,
  subject      TEXT NOT NULL,
  status       TEXT NOT NULL,          -- sent | failed | skipped
  error        TEXT,
  at           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_emails_community ON emails(community_id, at DESC);

-- Pengaturan yang bisa diubah dari aplikasi (mis. gambar QRIS).
-- Disimpan di basis data, bukan sebagai berkas, agar ikut terbawa saat
-- basis data dipindahkan dan tidak hilang saat aplikasi dibangun ulang.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  at    INTEGER NOT NULL
);

