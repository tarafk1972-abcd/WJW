import { db, now, type MemberRow } from './db.js'

/**
 * Tiga mandat operasional dipisahkan dari role `admin` umum.
 *
 * Ini menjaga satu admin keuangan tidak tanpa sengaja mengubah batas peta,
 * dan satu koordinator jadwal tidak dapat melihat rincian iuran warga. Semua
 * pemeriksaan dilakukan server-side; komponen UI hanya mengikuti hasilnya.
 */
export const MANAGEMENT_SCOPES = ['map_patrol', 'dues', 'patrol_schedule'] as const
export type ManagementScope = (typeof MANAGEMENT_SCOPES)[number]

export interface ManagementResponsibility {
  communityId: string
  scope: ManagementScope
  memberId: string
  assignedBy: string | null
  assignedAt: number
  /** True bila belum ada assignment eksplisit dan pendiri menjadi fallback. */
  defaulted: boolean
}

export function isManagementScope(value: unknown): value is ManagementScope {
  return typeof value === 'string' && (MANAGEMENT_SCOPES as readonly string[]).includes(value)
}

function communityFounder(communityId: string): { created_by: string; created_at: number } | null {
  return (db
    .prepare('SELECT created_by, created_at FROM communities WHERE id=?')
    .get(communityId) as { created_by: string; created_at: number } | undefined) ?? null
}

/**
 * Semua scope selalu punya pemilik. Untuk tenant lama atau baru tanpa record
 * eksplisit, pendiri lingkungan adalah penanggung jawab bootstrap. Tidak ada
 * kondisi "semua admin bebas menulis" yang dapat mengaburkan akuntabilitas.
 */
export function listManagementResponsibilities(communityId: string): ManagementResponsibility[] {
  const founder = communityFounder(communityId)
  if (!founder) return []

  const rows = db
    .prepare('SELECT scope, member_id, assigned_by, assigned_at FROM management_responsibilities WHERE community_id=?')
    .all(communityId) as {
    scope: ManagementScope
    member_id: string
    assigned_by: string
    assigned_at: number
  }[]
  const byScope = new Map(rows.map((row) => [row.scope, row]))

  return MANAGEMENT_SCOPES.map((scope) => {
    const row = byScope.get(scope)
    return row
      ? {
          communityId,
          scope,
          memberId: row.member_id,
          assignedBy: row.assigned_by,
          assignedAt: row.assigned_at,
          defaulted: false,
        }
      : {
          communityId,
          scope,
          memberId: founder.created_by,
          assignedBy: null,
          assignedAt: founder.created_at,
          defaulted: true,
        }
  })
}

/**
 * Superadmin dapat bertindak untuk tenant yang dipilih secara eksplisit;
 * pendiri hanya untuk tenantnya sendiri. Tanpa `communityId` (mis. halaman
 * state superadmin yang memang tidak berada di tenant), jangan tampilkan hak
 * tulis yang tidak dapat dipakai.
 */
export function canAssignManagementResponsibilities(me: MemberRow, communityId?: string): boolean {
  const targetCommunityId = communityId ?? me.community_id
  if (!targetCommunityId) return false
  if (me.role === 'superadmin') return true
  if (me.role !== 'admin' || me.community_id !== targetCommunityId) return false
  const founder = communityFounder(targetCommunityId)
  return founder?.created_by === me.id
}

export function canManageScope(me: MemberRow, scope: ManagementScope): boolean {
  if (me.role === 'superadmin') return true
  if (me.role !== 'admin' || !me.community_id) return false
  return listManagementResponsibilities(me.community_id).some(
    (responsibility) => responsibility.scope === scope && responsibility.memberId === me.id,
  )
}

/** Tetapkan satu admin aktif dari tenant yang sama sebagai penanggung jawab. */
export function assignManagementResponsibility(
  actor: MemberRow,
  scope: ManagementScope,
  memberId: string,
  communityId?: string,
): ManagementResponsibility | null {
  const targetCommunityId = communityId ?? actor.community_id
  if (!targetCommunityId || !canAssignManagementResponsibilities(actor, targetCommunityId)) return null
  const candidate = db
    .prepare("SELECT * FROM members WHERE id=? AND community_id=? AND role='admin' AND status='active'")
    .get(memberId, targetCommunityId) as MemberRow | undefined
  if (!candidate) return null

  const at = now()
  db.prepare(
    `INSERT INTO management_responsibilities (community_id,scope,member_id,assigned_by,assigned_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(community_id,scope) DO UPDATE SET
       member_id=excluded.member_id,
       assigned_by=excluded.assigned_by,
       assigned_at=excluded.assigned_at`,
  ).run(targetCommunityId, scope, candidate.id, actor.id, at)

  return {
    communityId: targetCommunityId,
    scope,
    memberId: candidate.id,
    assignedBy: actor.id,
    assignedAt: at,
    defaulted: false,
  }
}
