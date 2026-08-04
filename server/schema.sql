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
  cancelled_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_reports_community ON reports(community_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_live ON reports(community_id, live);

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
  grace_min    INTEGER NOT NULL DEFAULT 15,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL
);

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
