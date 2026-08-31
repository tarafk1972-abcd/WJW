import { db, now, uid } from './db.js'

/** Status kanonis untuk peringatan darurat Phase 1. */
export const INCIDENT_STATUSES = [
  'NEW',
  'ACKNOWLEDGED',
  'RESPONDING',
  'ON_SITE',
  'RESOLVED',
  'CLOSED',
  // Terminal khusus alarm palsu. Tidak pernah dipakai untuk insiden nyata.
  'CANCELLED',
] as const

export type IncidentStatus = (typeof INCIDENT_STATUSES)[number]

const NEXT: Record<IncidentStatus, IncidentStatus[]> = {
  NEW: ['ACKNOWLEDGED', 'RESOLVED', 'CANCELLED'],
  ACKNOWLEDGED: ['RESPONDING', 'RESOLVED', 'CANCELLED'],
  RESPONDING: ['ON_SITE', 'RESOLVED'],
  ON_SITE: ['RESOLVED'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
}

export function isIncidentStatus(value: unknown): value is IncidentStatus {
  return typeof value === 'string' && (INCIDENT_STATUSES as readonly string[]).includes(value)
}

/** Legacy `reports.status` agar layar lama tetap dapat membaca status ringkas. */
export function legacyStatusForIncident(status: IncidentStatus): 'open' | 'ack' | 'resolved' {
  if (status === 'NEW') return 'open'
  if (status === 'ACKNOWLEDGED' || status === 'RESPONDING' || status === 'ON_SITE') return 'ack'
  return 'resolved'
}

export function initialIncidentStatus(legacyStatus: unknown): IncidentStatus {
  if (legacyStatus === 'resolved') return 'RESOLVED'
  if (legacyStatus === 'ack') return 'RESPONDING'
  return 'NEW'
}

export function canTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  return NEXT[from].includes(to)
}

export interface TimelineEntry {
  id: string
  incidentId: string
  communityId: string
  actorId: string | null
  kind: string
  fromStatus: IncidentStatus | null
  toStatus: IncidentStatus | null
  detail: string
  createdAt: number
}

export function addIncidentTimeline(input: {
  incidentId: string
  communityId: string
  actorId?: string | null
  kind: string
  fromStatus?: IncidentStatus | null
  toStatus?: IncidentStatus | null
  /** Detail operasional singkat, jangan pernah taruh profil medis atau pesan chat di sini. */
  detail?: string
  at?: number
}): TimelineEntry {
  const entry: TimelineEntry = {
    id: uid('it_'),
    incidentId: input.incidentId,
    communityId: input.communityId,
    actorId: input.actorId ?? null,
    kind: input.kind,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus ?? null,
    detail: (input.detail ?? '').slice(0, 500),
    createdAt: input.at ?? now(),
  }
  db.prepare(
    `INSERT INTO incident_timeline
      (id,incident_id,community_id,actor_id,kind,from_status,to_status,detail,created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(
    entry.id,
    entry.incidentId,
    entry.communityId,
    entry.actorId,
    entry.kind,
    entry.fromStatus,
    entry.toStatus,
    entry.detail,
    entry.createdAt,
  )
  return entry
}

export function timelineForIncident(incidentId: string): TimelineEntry[] {
  const rows = db
    // rowid SQLite mempertahankan urutan append, termasuk saat transisi
    // beruntun jatuh pada milidetik sama atau jam sistem dikoreksi mundur.
    .prepare('SELECT * FROM incident_timeline WHERE incident_id=? ORDER BY rowid')
    .all(incidentId) as Record<string, unknown>[]
  return rows.map(mapTimelineRow)
}

export function timelineByIncident(communityId: string): Map<string, TimelineEntry[]> {
  const rows = db
    .prepare(
      'SELECT * FROM incident_timeline WHERE community_id=? ORDER BY rowid',
    )
    .all(communityId) as Record<string, unknown>[]
  const grouped = new Map<string, TimelineEntry[]>()
  for (const row of rows) {
    const entry = mapTimelineRow(row)
    const list = grouped.get(entry.incidentId) ?? []
    list.push(entry)
    grouped.set(entry.incidentId, list)
  }
  return grouped
}

function mapTimelineRow(row: Record<string, unknown>): TimelineEntry {
  return {
    id: String(row.id),
    incidentId: String(row.incident_id),
    communityId: String(row.community_id),
    actorId: (row.actor_id as string | null) ?? null,
    kind: String(row.kind),
    fromStatus: (row.from_status as IncidentStatus | null) ?? null,
    toStatus: (row.to_status as IncidentStatus | null) ?? null,
    detail: String(row.detail ?? ''),
    createdAt: Number(row.created_at),
  }
}

/**
 * Mencatat perpindahan status di database dan timeline immutable.
 * Pemanggil tetap bertanggung jawab melakukan authorization sebelum memanggil
 * fungsi ini.
 */
export function transitionIncident(input: {
  incidentId: string
  communityId: string
  actorId: string
  from: IncidentStatus
  to: IncidentStatus
  kind?: string
  detail?: string
}): TimelineEntry {
  if (!canTransition(input.from, input.to)) {
    throw new Error(`invalid_transition:${input.from}:${input.to}`)
  }

  const at = now()
  const tx = db.transaction(() => {
    const updated = db
      .prepare(
        `UPDATE reports
         SET incident_status=?, status=?, live=CASE WHEN ? IN ('RESOLVED','CLOSED','CANCELLED') THEN 0 ELSE live END,
             live_ended_at=CASE WHEN ? IN ('RESOLVED','CLOSED','CANCELLED') THEN COALESCE(live_ended_at, ?) ELSE live_ended_at END,
             cancelled_at=CASE WHEN ?='CANCELLED' THEN COALESCE(cancelled_at, ?) ELSE cancelled_at END
         WHERE id=? AND community_id=? AND incident_status=?`,
      )
      .run(
        input.to,
        legacyStatusForIncident(input.to),
        input.to,
        input.to,
        at,
        input.to,
        at,
        input.incidentId,
        input.communityId,
        input.from,
      )
    if (updated.changes !== 1) throw new Error('incident_changed')
    return addIncidentTimeline({
      incidentId: input.incidentId,
      communityId: input.communityId,
      actorId: input.actorId,
      kind: input.kind ?? 'status.changed',
      fromStatus: input.from,
      toStatus: input.to,
      detail: input.detail,
      at,
    })
  })
  return tx()
}
