import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Bentuk database sebelum Phase 3–5. Sengaja bukan salinan schema baru:
 * CREATE TABLE IF NOT EXISTS tidak menambah kolom pada SQLite, sehingga tes
 * ini menangkap urutan migrasi/index yang keliru pada instalasi nyata.
 */
const LEGACY_SCHEMA = `
CREATE TABLE communities (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL DEFAULT '', area TEXT NOT NULL DEFAULT '[]',
  area_updated_at INTEGER, area_updated_by TEXT, center TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'id', plan TEXT NOT NULL DEFAULT 'trial',
  plan_name TEXT NOT NULL DEFAULT 'trial', trial_ends_at INTEGER NOT NULL,
  paid_until INTEGER, suspended_reason TEXT
);
CREATE TABLE members (
  id TEXT PRIMARY KEY, community_id TEXT, name TEXT NOT NULL, phone TEXT NOT NULL,
  email TEXT NOT NULL, password_hash TEXT NOT NULL, house TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'warga', status TEXT NOT NULL DEFAULT 'pending',
  language TEXT NOT NULL DEFAULT 'id', device_id TEXT, created_at INTEGER NOT NULL,
  decided_at INTEGER, decided_by TEXT, rejected_reason TEXT, invited_by TEXT,
  emergency TEXT, join_method TEXT, join_code TEXT, join_note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE reports (
  id TEXT PRIMARY KEY, community_id TEXT NOT NULL, author_id TEXT NOT NULL,
  kind TEXT NOT NULL, category TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
  at_lat REAL, at_lng REAL, address TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL, handled_by TEXT, handled_at INTEGER, resolved_note TEXT,
  inside_area INTEGER, anonymous INTEGER NOT NULL DEFAULT 0, attachments TEXT NOT NULL DEFAULT '[]',
  messages TEXT NOT NULL DEFAULT '[]', responders TEXT NOT NULL DEFAULT '[]', track TEXT NOT NULL DEFAULT '[]',
  live INTEGER NOT NULL DEFAULT 0, live_ended_at INTEGER, audio TEXT, audio_seconds INTEGER NOT NULL DEFAULT 0,
  snapshot TEXT, recipients TEXT NOT NULL DEFAULT '[]', cancelled_at INTEGER
);
CREATE TABLE schedules (
  id TEXT PRIMARY KEY, community_id TEXT NOT NULL, label TEXT NOT NULL,
  start_minute INTEGER NOT NULL, end_minute INTEGER NOT NULL, days TEXT NOT NULL DEFAULT '[]',
  grace_min INTEGER NOT NULL DEFAULT 15, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
);
CREATE TABLE announcements (
  id TEXT PRIMARY KEY, community_id TEXT NOT NULL, author_id TEXT NOT NULL,
  title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', pinned INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE guests (
  id TEXT PRIMARY KEY, community_id TEXT NOT NULL, name TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '', host TEXT NOT NULL DEFAULT '', plate TEXT NOT NULL DEFAULT '',
  id_card TEXT NOT NULL DEFAULT '', check_in INTEGER NOT NULL, check_out INTEGER, recorded_by TEXT NOT NULL
);
`

let dir = ''

afterEach(() => {
  vi.resetModules()
  delete process.env.WJW_DB
  delete process.env.WJW_DATA_ENCRYPTION_KEY
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = ''
})

describe('migrasi SQLite legacy', () => {
  it('menambah kolom sebelum index baru dan mengenkripsi identitas tamu serta artefak SOS lama', async () => {
    dir = mkdtempSync(join(tmpdir(), 'wjw-legacy-schema-'))
    const path = join(dir, 'legacy.sqlite')
    const legacy = new Database(path)
    legacy.exec(LEGACY_SCHEMA)
    const at = Date.now()
    legacy.prepare(
      `INSERT INTO communities
       (id,name,created_at,center,trial_ends_at) VALUES (?,?,?,?,?)`,
    ).run('legacy-community', 'RW Lama', at, '{"lat":-6.9,"lng":107.6}', at + 86_400_000)
    legacy.prepare(
      `INSERT INTO guests (id,community_id,name,id_card,check_in,recorded_by)
       VALUES (?,?,?,?,?,?)`,
    ).run('legacy-guest', 'legacy-community', 'Tamu Lama', '3273-RAHASIA', at, 'legacy-admin')
    // Representasi SOS versi lama: semua artefak pernah berupa JSON
    // plaintext. Ini harus dipindah tanpa merusak isi historisnya.
    legacy.prepare(
      `INSERT INTO reports
       (id,community_id,author_id,kind,category,created_at,attachments,messages,responders,track,snapshot,recipients,audio)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      'legacy-sos',
      'legacy-community',
      'legacy-admin',
      'sos',
      'medical',
      at,
      '[{"id":"at-legacy","dataUrl":"data:image/png;base64,c2VjcmV0"}]',
      '[{"body":"Pesan SOS lama"}]',
      '["legacy-guard"]',
      '[{"lat":-6.9,"lng":107.6}]',
      '{"name":"Pelapor lama","phone":"0812"}',
      '[{"memberId":"legacy-guard"}]',
      'data:audio/webm;base64,bGFtYS1yYWhhc2lh',
    )
    legacy.close()

    process.env.WJW_DB = path
    process.env.WJW_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 21).toString('base64url')
    const { db } = await import('./db.js')

    const community = db
      .prepare("SELECT subdomain,subscription_tier,subscription_status FROM communities WHERE id='legacy-community'")
      .get() as { subdomain: string; subscription_tier: string; subscription_status: string }
    expect(community).toEqual({ subdomain: '', subscription_tier: 'FREE', subscription_status: 'trial' })
    const announcementColumns = db.prepare('PRAGMA table_info(announcements)').all() as { name: string }[]
    expect(announcementColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['category', 'target_scope', 'target_value']),
    )
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name IN ('idx_communities_subdomain','idx_announcements_community_target')")
      .all() as { name: string }[]
    expect(indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining(['idx_communities_subdomain', 'idx_announcements_community_target']),
    )
    const guest = db
      .prepare("SELECT id_card FROM guests WHERE id='legacy-guest'")
      .get() as { id_card: string }
    expect(guest.id_card.startsWith('enc:v1:')).toBe(true)

    const sos = db
      .prepare('SELECT attachments,messages,responders,track,recipients,snapshot,audio FROM reports WHERE id=?')
      .get('legacy-sos') as Record<string, string>
    for (const column of ['attachments', 'messages', 'responders', 'track', 'recipients', 'snapshot', 'audio'] as const)
      expect(sos[column]).toMatch(/^enc:v1:/)
    // Pastikan migrasi tidak sekadar mengganti prefix: isi JSON lama tetap
    // dapat dibuka dengan kunci deploy yang sama.
    const { decryptSensitiveJson } = await import('./crypto.js')
    expect(decryptSensitiveJson<{ dataUrl: string }[]>(sos.attachments)?.[0]?.dataUrl)
      .toBe('data:image/png;base64,c2VjcmV0')
    expect(decryptSensitiveJson<{ body: string }[]>(sos.messages)?.[0]?.body)
      .toBe('Pesan SOS lama')
    db.close()
  })
})
