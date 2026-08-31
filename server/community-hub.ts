import { randomInt } from 'node:crypto'
import { audit, db, now, uid, type MemberRow } from './db.js'
import {
  canAssignManagementResponsibilities,
  canManageScope,
} from './community-ops.js'

/**
 * Rekam operasional komunitas di bawah ini sengaja dipisah dari laporan SOS.
 *
 * `reports` tetap khusus keselamatan/insiden: jangan menyampurkan aduan lampu
 * mati, permohonan surat, atau janji donasi dengan alur darurat. Tabel hub
 * memberi setiap fitur fase 3/4 identitas, tenant, audit, dan lifecycle
 * sendiri tanpa menjadikan seluruh produk satu monolit rapuh.
 */
export const HUB_KINDS = [
  'finance',
  'letter',
  'complaint',
  'poll',
  'deliberation',
  'campaign',
  'donation',
  'arisan',
  'bereavement',
] as const

export type HubKind = (typeof HUB_KINDS)[number]
export type HubVisibility = 'community' | 'private'

const PRIVATE_KINDS: readonly HubKind[] = ['letter', 'complaint']
const COMMUNITY_MANAGER_KINDS: readonly HubKind[] = [
  'letter',
  'complaint',
  'poll',
  'deliberation',
  'campaign',
  'donation',
  'arisan',
  'bereavement',
]
const COMMENTABLE_KINDS: readonly HubKind[] = ['complaint', 'deliberation', 'campaign']

export interface HubItem {
  id: string
  communityId: string
  kind: HubKind
  title: string
  body: string
  status: string
  visibility: HubVisibility
  metadata: Record<string, unknown>
  createdBy: string
  createdAt: number
  updatedAt: number
  closedAt: number | null
  summary: {
    comments: number
    votes?: Record<string, number>
    eligibleVoters?: number
    supporters?: number
    contributedAmount?: number
    contributors?: number
    participants?: number
    volunteers?: number
  }
  /** Hanya aksi milik pemanggil; aman untuk ditampilkan kepada warga. */
  myAction: { action: string; value: string } | null
  /** Nama peserta hanya bila memang perlu untuk koordinasi/penanggung jawab. */
  participants: { memberId: string; name: string; action: string; value: string }[]
  comments: { id: string; memberId: string; name: string; body: string; createdAt: number }[]
  winnerName?: string
}

export interface HubResident {
  id: string
  name: string
  house: string
  role: string
  status: string
  createdAt: number
}

export interface HubOverview {
  items: HubItem[]
  residents: HubResident[]
  residentSummary: { total: number; active: number; pending: number; households: number }
  permissions: {
    canManageCommunity: boolean
    canManageFinance: boolean
    canConfigureBranding: boolean
  }
}

export interface HubAnalytics {
  residents: { active: number; pending: number; households: number }
  operations: { lettersOpen: number; complaintsOpen: number; announcements: number }
  engagement: {
    pollsOpen: number
    votes: number
    discussionsOpen: number
    campaignSupporters: number
    arisanParticipants: number
    bereavementParticipants: number
  }
  finance: { income: number; expense: number; balance: number } | null
}

export interface Branding {
  brandName: string
  accentColor: string
  logoUrl: string
  customDomain: string
  domainStatus: 'none' | 'pending_dns' | 'dns_verified'
  whiteLabelRequested: boolean
  verificationName?: string
  verificationValue?: string
}

type ItemRow = {
  id: string
  community_id: string
  kind: HubKind
  title: string
  body: string
  status: string
  visibility: HubVisibility
  metadata: string
  created_by: string
  created_at: number
  updated_at: number
  closed_at: number | null
}

type ActionRow = {
  id: string
  item_id: string
  community_id: string
  member_id: string
  action: string
  value: string
  created_at: number
  updated_at: number
  name?: string
}

type CommentRow = {
  id: string
  item_id: string
  community_id: string
  member_id: string
  body: string
  created_at: number
  name: string
}

type BrandingRow = {
  community_id: string
  brand_name: string
  accent_color: string
  logo_url: string
  custom_domain: string
  domain_status: Branding['domainStatus']
  verification_token: string
  white_label_requested: number
  updated_by: string
  updated_at: number
}

export class HubError extends Error {
  readonly code: 'not_found' | 'forbidden' | 'tier_required' | 'invalid_hub_input' | 'invalid_hub_state' | 'domain_pending'

  constructor(code: 'not_found' | 'forbidden' | 'tier_required' | 'invalid_hub_input' | 'invalid_hub_state' | 'domain_pending') {
    super(code)
    this.code = code
    this.name = 'HubError'
  }
}

function jsonObject(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw || '{}')
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value.replaceAll('\u0000', '').trim().slice(0, max)
}

function cleanInteger(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    return null
  return value
}

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function belongsTo(me: MemberRow, row: ItemRow): boolean {
  return !!me.community_id && row.community_id === me.community_id
}

export function isHubKind(value: unknown): value is HubKind {
  return typeof value === 'string' && (HUB_KINDS as readonly string[]).includes(value)
}

export function canManageHubKind(me: MemberRow, kind: HubKind): boolean {
  if (me.role === 'superadmin') return true
  if (me.role !== 'admin' || !me.community_id) return false
  // Kas komunitas berada bersama mandat Admin 2, bukan bersama billing SaaS.
  return kind === 'finance' ? canManageScope(me, 'dues') : COMMUNITY_MANAGER_KINDS.includes(kind)
}

function canConfigureBranding(me: MemberRow): boolean {
  return !!me.community_id && canAssignManagementResponsibilities(me, me.community_id)
}

function canViewItem(me: MemberRow, row: ItemRow): boolean {
  if (!belongsTo(me, row)) return false
  if (row.kind === 'finance') return canManageHubKind(me, 'finance')
  if (PRIVATE_KINDS.includes(row.kind))
    return row.created_by === me.id || canManageHubKind(me, row.kind)
  return true
}

function canCreateKind(me: MemberRow, kind: HubKind): boolean {
  if (!me.community_id) return false
  if (kind === 'letter' || kind === 'complaint') return true
  return canManageHubKind(me, kind)
}

function statusFor(kind: HubKind): string {
  switch (kind) {
    case 'finance':
      return 'posted'
    case 'letter':
      return 'SUBMITTED'
    case 'complaint':
      return 'SUBMITTED'
    case 'poll':
      return 'open'
    case 'deliberation':
      return 'scheduled'
    case 'campaign':
    case 'donation':
    case 'bereavement':
      return 'active'
    case 'arisan':
      return 'open'
  }
}

/** Validasi khusus setiap modul, agar JSON fleksibel tidak menjadi input liar. */
function normalizeMetadata(kind: HubKind, raw: unknown): Record<string, unknown> {
  const meta = metadataObject(raw)

  if (kind === 'finance') {
    const amount = cleanInteger(meta.amount, 1, 1_000_000_000)
    const direction = meta.direction === 'income' || meta.direction === 'expense' ? meta.direction : null
    if (!amount || !direction) throw new HubError('invalid_hub_input')
    const category = cleanText(meta.category, 60)
    return { amount, direction, category }
  }

  if (kind === 'letter') {
    const letterType = cleanText(meta.letterType, 60)
    const purpose = cleanText(meta.purpose, 300)
    if (!letterType || !purpose) throw new HubError('invalid_hub_input')
    return { letterType, purpose }
  }

  if (kind === 'complaint') {
    const category = cleanText(meta.category, 60)
    const priority = cleanText(meta.priority, 20).toUpperCase()
    if (!category || !['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(priority))
      throw new HubError('invalid_hub_input')
    return { category, priority }
  }

  if (kind === 'poll') {
    const rawChoices = Array.isArray(meta.choices) ? meta.choices : []
    const choices = [...new Set(rawChoices.map((choice) => cleanText(choice, 80)).filter(Boolean))]
    const closesAt = cleanInteger(meta.closesAt, now() + 60_000, now() + 366 * 86_400_000)
    // Kontrak voting: minimal dua, maksimal sepuluh opsi, satu suara per
    // warga dan batas waktu server-side. Anonim berarti identitas pemilih
    // tidak pernah dimasukkan ke DTO hasil, meski server menyimpan kunci
    // unik untuk mencegah suara ganda.
    if (choices.length < 2 || choices.length > 10 || !closesAt)
      throw new HubError('invalid_hub_input')
    return { choices, closesAt, anonymous: meta.anonymous === true }
  }

  if (kind === 'deliberation') {
    const startsAt = meta.startsAt === null ? null : cleanInteger(meta.startsAt, 0, now() + 3 * 366 * 86_400_000)
    return { startsAt, location: cleanText(meta.location, 160) }
  }

  if (kind === 'campaign') {
    const goal = cleanInteger(meta.goal, 1, 1_000_000)
    const deadline = cleanInteger(meta.deadline, now() + 60_000, now() + 366 * 86_400_000)
    if (!goal || !deadline) throw new HubError('invalid_hub_input')
    return { goal, unit: cleanText(meta.unit, 40) || 'dukungan', deadline }
  }

  if (kind === 'donation') {
    const targetAmount = cleanInteger(meta.targetAmount, 1_000, 1_000_000_000)
    const deadline = cleanInteger(meta.deadline, now() + 60_000, now() + 366 * 86_400_000)
    if (!targetAmount || !deadline) throw new HubError('invalid_hub_input')
    return {
      targetAmount,
      deadline,
      paymentInstructions: cleanText(meta.paymentInstructions, 500),
    }
  }

  if (kind === 'arisan') {
    const contribution = cleanInteger(meta.contribution, 1_000, 100_000_000)
    if (!contribution) throw new HubError('invalid_hub_input')
    const drawAt = meta.drawAt === null || meta.drawAt === undefined
      ? null
      : cleanInteger(meta.drawAt, now(), now() + 3 * 366 * 86_400_000)
    if (meta.drawAt !== null && meta.drawAt !== undefined && drawAt === null)
      throw new HubError('invalid_hub_input')
    return {
      contribution,
      cadence: cleanText(meta.cadence, 50) || 'Bulanan',
      drawAt,
    }
  }

  // Informasi duka ditulis pengurus; batasi panjangnya agar bukan tempat
  // mengunggah dokumen/rekam medis sensitif. Nominal hanya biaya program
  // gotong royong, bukan instruksi transfer atau pemrosesan pembayaran WJW.
  const serviceAt = meta.serviceAt === null || meta.serviceAt === undefined
    ? null
    : cleanInteger(meta.serviceAt, 0, now() + 366 * 86_400_000)
  const contribution = cleanInteger(meta.contribution, 1_000, 100_000_000)
  if (
    (meta.serviceAt !== null && meta.serviceAt !== undefined && serviceAt === null) ||
    !contribution
  )
    throw new HubError('invalid_hub_input')
  return {
    serviceAt,
    location: cleanText(meta.location, 160),
    contact: cleanText(meta.contact, 100),
    contribution,
  }
}

/**
 * Tenggat dibersihkan saat data dibaca/ditulis di server. Jadi poll tertutup
 * walaupun tidak ada admin yang membuka halaman pada detik tenggat lewat.
 */
export function refreshExpiredHubItems(communityId: string, at = now()): string[] {
  const closedIds: string[] = []
  const rows = db
    .prepare(
      "SELECT id,kind,status,metadata FROM community_hub_items WHERE community_id=? AND status IN ('open','active')",
    )
    .all(communityId) as Pick<ItemRow, 'id' | 'kind' | 'status' | 'metadata'>[]
  for (const row of rows) {
    const meta = jsonObject(row.metadata)
    const deadline = row.kind === 'poll' ? meta.closesAt : meta.deadline
    if (typeof deadline !== 'number' || deadline > at) continue
    const next = row.kind === 'poll' ? 'closed' : row.kind === 'campaign' || row.kind === 'donation' ? 'closed' : null
    if (!next) continue
    const result = db
      .prepare("UPDATE community_hub_items SET status=?,updated_at=?,closed_at=? WHERE id=? AND status IN ('open','active')")
      .run(next, at, at, row.id)
    if (result.changes === 1) {
      closedIds.push(row.id)
      audit(communityId, 'system', 'hub.deadline.close', `${row.kind}:${row.id}`)
    }
  }
  return closedIds
}

export function createHubItem(
  me: MemberRow,
  input: { kind: HubKind; title: unknown; body?: unknown; metadata?: unknown },
): HubItem {
  if (!me.community_id || !canCreateKind(me, input.kind)) throw new HubError('forbidden')
  const title = cleanText(input.title, 140)
  // Surat satu halaman; batasi uraian agar kop, nomor, dan blok persetujuan
  // tidak terdorong keluar halaman PDF.
  const body = cleanText(input.body, input.kind === 'letter' ? 700 : 2_000)
  if (!title || (input.kind === 'complaint' && !body)) throw new HubError('invalid_hub_input')

  const metadata = normalizeMetadata(input.kind, input.metadata)
  const visibility: HubVisibility = PRIVATE_KINDS.includes(input.kind) || input.kind === 'finance'
    ? 'private'
    : 'community'
  const id = uid('hub_')
  const at = now()
  db.prepare(
    `INSERT INTO community_hub_items
     (id,community_id,kind,title,body,status,visibility,metadata,created_by,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    me.community_id,
    input.kind,
    title,
    body,
    statusFor(input.kind),
    visibility,
    JSON.stringify(metadata),
    me.id,
    at,
    at,
  )
  const row = getItem(me.community_id, id)
  if (!row) throw new HubError('not_found')
  return mapItem(row, me)
}

function getItem(communityId: string, id: string): ItemRow | null {
  return (db
    .prepare('SELECT * FROM community_hub_items WHERE id=? AND community_id=?')
    .get(id, communityId) as ItemRow | undefined) ?? null
}

function actionsFor(row: ItemRow): ActionRow[] {
  return db
    .prepare(
      `SELECT a.*, m.name
       FROM community_hub_actions a
       JOIN members m ON m.id=a.member_id
       WHERE a.item_id=? AND a.community_id=?
       ORDER BY a.created_at ASC`,
    )
    .all(row.id, row.community_id) as ActionRow[]
}

function commentsFor(row: ItemRow): CommentRow[] {
  return db
    .prepare(
      `SELECT c.*, m.name
       FROM community_hub_comments c
       JOIN members m ON m.id=c.member_id
       WHERE c.item_id=? AND c.community_id=?
       ORDER BY c.created_at ASC
       LIMIT 80`,
    )
    .all(row.id, row.community_id) as CommentRow[]
}

function mapItem(row: ItemRow, viewer: MemberRow): HubItem {
  const metadata = jsonObject(row.metadata)
  const actions = actionsFor(row)
  const comments = COMMENTABLE_KINDS.includes(row.kind) ? commentsFor(row) : []
  const myAction = actions.find((action) => action.member_id === viewer.id) ?? null
  const summary: HubItem['summary'] = { comments: comments.length }
  let participants: HubItem['participants'] = []

  if (row.kind === 'poll') {
    const choices = Array.isArray(metadata.choices) ? metadata.choices.filter((x): x is string => typeof x === 'string') : []
    const votes = Object.fromEntries(choices.map((choice) => [choice, 0])) as Record<string, number>
    for (const action of actions) {
      if (action.action === 'vote' && Object.hasOwn(votes, action.value)) votes[action.value] += 1
    }
    summary.votes = votes
    summary.eligibleVoters = (db
      .prepare("SELECT count(*) AS count FROM members WHERE community_id=? AND status='active'")
      .get(row.community_id) as { count: number }).count
  }
  if (row.kind === 'campaign') summary.supporters = actions.filter((x) => x.action === 'support').length
  if (row.kind === 'donation') {
    const contributions = actions.filter((x) => x.action === 'donation')
    summary.contributors = contributions.length
    summary.contributedAmount = contributions.reduce((total, action) => total + (Number(action.value) || 0), 0)
    // Hanya penanggung jawab dapat melihat daftar konfirmasi nominal warga.
    if (canManageHubKind(viewer, row.kind)) {
      participants = contributions.map((action) => ({

        memberId: action.member_id,
        name: action.name ?? 'Warga',
        action: action.action,
        value: action.value,
      }))
    }
  }
  if (row.kind === 'arisan') {
    const joined = actions.filter((x) => x.action === 'join')
    summary.participants = joined.length
    // Transparansi peserta adalah bagian dari arisan; ini tidak memuat
    // nominal pembayaran atau data kontak.
    participants = joined.map((action) => ({
      memberId: action.member_id,
      name: action.name ?? 'Warga',
      action: action.action,
      value: action.value,
    }))
  }
  if (row.kind === 'bereavement') {
    const joined = actions.filter((x) => x.action === 'join' || x.action === 'volunteer')
    summary.participants = joined.length
    // Daftar peserta rukun kematian bersifat transparan untuk seluruh warga,
    // tetapi tidak memuat bukti/riwayat pembayaran.
    participants = joined.map((action) => ({
      memberId: action.member_id,
      name: action.name ?? 'Warga',
      action: action.action,
      value: action.value,
    }))
  }

  let winnerName: string | undefined
  if (row.kind === 'arisan' && typeof metadata.winnerMemberId === 'string') {
    const winner = db
      .prepare('SELECT name FROM members WHERE id=? AND community_id=?')
      .get(metadata.winnerMemberId, row.community_id) as { name: string } | undefined
    winnerName = winner?.name
  }

  return {
    id: row.id,
    communityId: row.community_id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    status: row.status,
    visibility: row.visibility,
    metadata,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
    summary,
    myAction: myAction ? { action: myAction.action, value: myAction.value } : null,
    participants,
    comments: comments.map((comment) => ({
      id: comment.id,
      memberId: comment.member_id,
      name: comment.name,
      body: comment.body,
      createdAt: comment.created_at,
    })),
    ...(winnerName ? { winnerName } : {}),
  }
}

export function listHubItems(me: MemberRow): HubItem[] {
  if (!me.community_id) return []
  refreshExpiredHubItems(me.community_id)
  const rows = db
    .prepare(
      `SELECT * FROM community_hub_items
       WHERE community_id=?
       ORDER BY CASE WHEN status IN ('active','open','scheduled','SUBMITTED','REVIEWING','IN_PROGRESS') THEN 0 ELSE 1 END,
                updated_at DESC
       LIMIT 160`,
    )
    .all(me.community_id) as ItemRow[]
  return rows.filter((row) => canViewItem(me, row)).map((row) => mapItem(row, me))
}

export function communityHubOverview(me: MemberRow): HubOverview {
  if (!me.community_id) throw new HubError('forbidden')
  const residentRows = db
    .prepare(
      `SELECT id,name,house,role,status,created_at FROM members
       WHERE community_id=? ORDER BY status='active' DESC, house, name`,
    )
    .all(me.community_id) as {
    id: string
    name: string
    house: string
    role: string
    status: string
    created_at: number
  }[]
  const active = residentRows.filter((resident) => resident.status === 'active')
  const canManageCommunity = me.role === 'admin' || me.role === 'superadmin'
  return {
    items: listHubItems(me),
    // Kependudukan tidak menyebarkan email, nomor HP, NIK/KK atau profil
    // medis. Daftar nama/alamat blok hanya untuk admin tenant.
    residents: canManageCommunity
      ? residentRows.map((resident) => ({
          id: resident.id,
          name: resident.name,
          house: resident.house,
          role: resident.role,
          status: resident.status,
          createdAt: resident.created_at,
        }))
      : [],
    residentSummary: {
      total: residentRows.length,
      active: active.length,
      pending: residentRows.filter((resident) => resident.status === 'pending').length,
      households: new Set(active.map((resident) => resident.house.trim()).filter(Boolean)).size,
    },
    permissions: {
      canManageCommunity,
      canManageFinance: canManageHubKind(me, 'finance'),
      canConfigureBranding: canConfigureBranding(me),
    },
  }
}

const MANAGER_STATUSES: Record<HubKind, readonly string[]> = {
  finance: [],
  // Keputusan surat memakai decideLetter agar nomor, tanda tangan dan catatan
  // disimpan atomik bersama statusnya. REVIEWING tetap boleh untuk antrean.
  letter: ['REVIEWING'],
  complaint: ['REVIEWING', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  poll: ['closed'],
  deliberation: ['open', 'closed'],
  campaign: ['closed'],
  donation: ['closed'],
  arisan: ['closed'],
  bereavement: ['closed'],
}

const COMPLAINT_TRANSITIONS: Record<string, readonly string[]> = {
  SUBMITTED: ['REVIEWING'],
  REVIEWING: ['IN_PROGRESS'],
  IN_PROGRESS: ['RESOLVED'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
}

export function setHubItemStatus(me: MemberRow, id: string, nextStatus: unknown, rawNote?: unknown): HubItem {
  if (!me.community_id || typeof nextStatus !== 'string') throw new HubError('invalid_hub_input')
  refreshExpiredHubItems(me.community_id)
  const row = getItem(me.community_id, id)
  if (!row) throw new HubError('not_found')
  if (!canViewItem(me, row)) throw new HubError('forbidden')

  let allowed = false
  if (canManageHubKind(me, row.kind)) {
    if (row.kind === 'complaint') {
      // Aduan punya state machine linear agar tidak "loncat selesai" tanpa
      // peninjauan/tindak lanjut. Status ini adalah kontrak server, bukan UI.
      allowed = COMPLAINT_TRANSITIONS[row.status]?.includes(nextStatus) ?? false
    } else {
      allowed = MANAGER_STATUSES[row.kind].includes(nextStatus)
    }
  } else if (row.kind === 'letter' && row.created_by === me.id) {
    allowed = nextStatus === 'CANCELLED' && row.status === 'SUBMITTED'
  }
  if (!allowed) {
    if (canManageHubKind(me, row.kind) || (row.kind === 'letter' && row.created_by === me.id))
      throw new HubError('invalid_hub_state')
    throw new HubError('forbidden')
  }

  const at = now()
  const closed = ['APPROVED', 'REJECTED', 'RESOLVED', 'CLOSED', 'CANCELLED', 'closed'].includes(nextStatus)
  db.prepare(
    'UPDATE community_hub_items SET status=?, updated_at=?, closed_at=? WHERE id=? AND community_id=?',
  ).run(nextStatus, at, closed ? at : null, row.id, row.community_id)
  // Catatan admin pada perubahan aduan menjadi entri kronologis yang tidak
  // dapat ditimpa pada update status berikutnya.
  const note = row.kind === 'complaint' ? cleanText(rawNote, 1_000) : ''
  if (note) {
    db.prepare(
      `INSERT INTO community_hub_comments (id,item_id,community_id,member_id,body,created_at)
       VALUES (?,?,?,?,?,?)`,
    ).run(uid('hubc_'), row.id, row.community_id, me.id, note, at)
  }
  const updated = getItem(me.community_id, id)
  if (!updated) throw new HubError('not_found')
  return mapItem(updated, me)
}

export interface LetterPdfData {
  number: string
  type: string
  purpose: string
  requestBody: string
  decisionNote: string
  approvedAt: number
  community: { name: string; address: string; city: string }
  resident: { name: string; house: string }
  signer: { name: string; title: string }
}

function nextLetterNumber(communityId: string, at: number): string {
  const existing = db
    .prepare('SELECT last_number FROM letter_sequences WHERE community_id=?')
    .get(communityId) as { last_number: number } | undefined
  const serial = (existing?.last_number ?? 0) + 1
  db.prepare(
    `INSERT INTO letter_sequences (community_id,last_number) VALUES (?,?)
     ON CONFLICT(community_id) DO UPDATE SET last_number=excluded.last_number`,
  ).run(communityId, serial)
  const date = new Date(at)
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${String(serial).padStart(3, '0')}/WJW/${month}/${date.getUTCFullYear()}`
}

/**
 * Persetujuan surat bersifat atomik: nomor surat, identitas penandatangan,
 * catatan, status APPROVED dan waktu diterbitkan selalu berpindah bersama.
 * Karena itu PDF tidak mungkin tersedia pada surat yang belum disetujui.
 */
export function decideLetter(
  me: MemberRow,
  id: string,
  input: { approve?: unknown; note?: unknown; signerName?: unknown; signerTitle?: unknown },
): HubItem {
  if (!me.community_id) throw new HubError('forbidden')
  const action = db.transaction(() => {
    const row = getItem(me.community_id!, id)
    if (!row) throw new HubError('not_found')
    if (row.kind !== 'letter' || !canManageHubKind(me, 'letter')) throw new HubError('forbidden')
    if (!['SUBMITTED', 'REVIEWING'].includes(row.status)) throw new HubError('invalid_hub_state')
    if (typeof input.approve !== 'boolean') throw new HubError('invalid_hub_input')

    const at = now()
    const metadata = jsonObject(row.metadata)
    const note = cleanText(input.note, 500)
    const signerName = cleanText(input.signerName, 80) || me.name
    const signerTitle = cleanText(input.signerTitle, 80) || 'Pengurus lingkungan'
    const nextMeta: Record<string, unknown> = {
      ...metadata,
      decisionNote: note,
      decisionAt: at,
      decidedBy: me.id,
      signerName,
      signerTitle,
    }
    const status = input.approve ? 'APPROVED' : 'REJECTED'
    if (input.approve) nextMeta.letterNumber = nextLetterNumber(me.community_id!, at)
    db.prepare(
      `UPDATE community_hub_items
       SET status=?,metadata=?,updated_at=?,closed_at=?
       WHERE id=? AND community_id=?`,
    ).run(status, JSON.stringify(nextMeta), at, at, row.id, row.community_id)
    const updated = getItem(me.community_id!, id)
    if (!updated) throw new HubError('not_found')
    return mapItem(updated, me)
  })
  return action()
}

/** Hanya pelapor, admin tenant, atau superadmin tenant-context yang dapat mengunduh PDF. */
export function approvedLetterPdfData(me: MemberRow, id: string): LetterPdfData {
  if (!me.community_id) throw new HubError('forbidden')
  const row = getItem(me.community_id, id)
  if (!row) throw new HubError('not_found')
  if (row.kind !== 'letter' || !canViewItem(me, row)) throw new HubError('forbidden')
  if (row.status !== 'APPROVED') throw new HubError('invalid_hub_state')
  const metadata = jsonObject(row.metadata)
  const number = typeof metadata.letterNumber === 'string' ? metadata.letterNumber : ''
  if (!number) throw new HubError('invalid_hub_state')
  const community = db
    .prepare('SELECT name,address,city FROM communities WHERE id=?')
    .get(row.community_id) as { name: string; address: string; city: string } | undefined
  const resident = db
    .prepare('SELECT name,house FROM members WHERE id=? AND community_id=?')
    .get(row.created_by, row.community_id) as { name: string; house: string } | undefined
  if (!community || !resident) throw new HubError('not_found')
  return {
    number,
    type: typeof metadata.letterType === 'string' ? metadata.letterType : 'Surat keterangan',
    purpose: typeof metadata.purpose === 'string' ? metadata.purpose : '',
    requestBody: row.body,
    decisionNote: typeof metadata.decisionNote === 'string' ? metadata.decisionNote : '',
    approvedAt: typeof metadata.decisionAt === 'number' ? metadata.decisionAt : row.updated_at,
    community,
    resident,
    signer: {
      name: typeof metadata.signerName === 'string' ? metadata.signerName : 'Pengurus lingkungan',
      title: typeof metadata.signerTitle === 'string' ? metadata.signerTitle : 'Pengurus lingkungan',
    },
  }
}

function itemAllowsAction(row: ItemRow, action: string, value: unknown): string {
  const meta = jsonObject(row.metadata)
  if (row.kind === 'poll' && action === 'vote') {
    const closesAt = typeof meta.closesAt === 'number' ? meta.closesAt : null
    const choices = Array.isArray(meta.choices) ? meta.choices : []
    if (row.status !== 'open' || (closesAt && closesAt <= now()) || typeof value !== 'string' || !choices.includes(value))
      throw new HubError('invalid_hub_state')
    return value
  }
  if (row.kind === 'campaign' && action === 'support') {
    if (row.status !== 'active') throw new HubError('invalid_hub_state')
    return ''
  }
  if (row.kind === 'donation' && action === 'donation') {
    if (row.status !== 'active') throw new HubError('invalid_hub_state')
    // Tidak ada nominal paket/opsi tetap: warga boleh mencatat nominal Rupiah
    // berapa pun yang positif. Ini catatan transparansi program komunitas,
    // bukan pengambilan pembayaran oleh platform.
    const amount = cleanInteger(value, 1, 1_000_000_000)
    if (!amount) throw new HubError('invalid_hub_input')
    return String(amount)
  }
  if (row.kind === 'arisan' && action === 'join') {
    if (row.status !== 'open') throw new HubError('invalid_hub_state')
    return ''
  }
  if (row.kind === 'bereavement' && action === 'join') {
    if (row.status !== 'active') throw new HubError('invalid_hub_state')
    return ''
  }
  throw new HubError('invalid_hub_state')
}

export function actOnHubItem(
  me: MemberRow,
  id: string,
  action: unknown,
  value: unknown,
): HubItem {
  if (!me.community_id || typeof action !== 'string') throw new HubError('invalid_hub_input')
  refreshExpiredHubItems(me.community_id)
  const row = getItem(me.community_id, id)
  if (!row) throw new HubError('not_found')
  if (!canViewItem(me, row)) throw new HubError('forbidden')
  const storedValue = itemAllowsAction(row, action, value)
  const at = now()

  if (row.kind === 'poll') {
    // Satu suara berarti satu suara yang tidak dapat ditimpa lewat request
    // API kedua. UI juga mengunci tombol, namun constraint/INSERT server
    // inilah yang membuat aturan tetap benar untuk klien yang dimodifikasi.
    const inserted = db
      .prepare(
        `INSERT INTO community_hub_actions
         (id,item_id,community_id,member_id,action,value,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(item_id,member_id,action) DO NOTHING`,
      )
      .run(uid('hubact_'), row.id, row.community_id, me.id, action, storedValue, at, at)
    if (inserted.changes !== 1) throw new HubError('invalid_hub_state')
  } else {
    // Untuk donasi, nilai terbaru adalah total komitmen warga pada kampanye
    // ini—bukan deretan klaim pembayaran. Dukungan/join juga idempoten.
    db.prepare(
      `INSERT INTO community_hub_actions
       (id,item_id,community_id,member_id,action,value,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(item_id,member_id,action) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
    ).run(uid('hubact_'), row.id, row.community_id, me.id, action, storedValue, at, at)
  }
  db.prepare('UPDATE community_hub_items SET updated_at=? WHERE id=? AND community_id=?').run(
    at,
    row.id,
    row.community_id,
  )
  const updated = getItem(me.community_id, id)
  if (!updated) throw new HubError('not_found')
  return mapItem(updated, me)
}

/**
 * Pengundian hanya dilakukan di server (crypto.randomInt), bukan JavaScript
 * perangkat ketua. Peserta dan hasil tersimpan agar putaran pertama dapat
 * diaudit, namun ini bukan penampung uang maupun bukti pembayaran arisan.
 */
export function drawArisan(me: MemberRow, id: string): HubItem {
  if (!me.community_id) throw new HubError('forbidden')
  const draw = db.transaction(() => {
    const row = getItem(me.community_id!, id)
    if (!row) throw new HubError('not_found')
    if (row.kind !== 'arisan' || !canManageHubKind(me, 'arisan')) throw new HubError('forbidden')
    if (row.status !== 'open') throw new HubError('invalid_hub_state')
    const metadata = jsonObject(row.metadata)
    if (typeof metadata.winnerMemberId === 'string') throw new HubError('invalid_hub_state')
    const participants = actionsFor(row).filter((action) => action.action === 'join')
    if (participants.length < 2) throw new HubError('invalid_hub_state')
    const winner = participants[randomInt(participants.length)]
    const at = now()
    const nextMeta = { ...metadata, winnerMemberId: winner.member_id, winnerAt: at }
    db.prepare(
      `UPDATE community_hub_items
       SET status='drawn', metadata=?, updated_at=?, closed_at=?
       WHERE id=? AND community_id=?`,
    ).run(JSON.stringify(nextMeta), at, at, row.id, row.community_id)
    const updated = getItem(me.community_id!, id)
    if (!updated) throw new HubError('not_found')
    return mapItem(updated, me)
  })
  return draw()
}

export function addHubComment(me: MemberRow, id: string, body: unknown): HubItem {
  if (!me.community_id) throw new HubError('forbidden')
  const row = getItem(me.community_id, id)
  if (!row) throw new HubError('not_found')
  if (!canViewItem(me, row) || !COMMENTABLE_KINDS.includes(row.kind)) throw new HubError('forbidden')
  const text = cleanText(body, 1_000)
  if (!text) throw new HubError('invalid_hub_input')
  const at = now()
  db.prepare(
    `INSERT INTO community_hub_comments (id,item_id,community_id,member_id,body,created_at)
     VALUES (?,?,?,?,?,?)`,
  ).run(uid('hubcom_'), row.id, row.community_id, me.id, text, at)
  db.prepare('UPDATE community_hub_items SET updated_at=? WHERE id=? AND community_id=?').run(
    at,
    row.id,
    row.community_id,
  )
  const updated = getItem(me.community_id, id)
  if (!updated) throw new HubError('not_found')
  return mapItem(updated, me)
}

export function hubAnalytics(me: MemberRow): HubAnalytics {
  if (!me.community_id || (me.role !== 'admin' && me.role !== 'superadmin'))
    throw new HubError('forbidden')
  const communityId = me.community_id
  refreshExpiredHubItems(communityId)
  const members = db
    .prepare('SELECT house,status FROM members WHERE community_id=?')
    .all(communityId) as { house: string; status: string }[]
  const rows = db
    .prepare('SELECT kind,status FROM community_hub_items WHERE community_id=?')
    .all(communityId) as { kind: HubKind; status: string }[]
  // `join` dipakai oleh arisan dan rukun kematian. Selalu hubungkan aksi ke
  // jenis itemnya; agregat berdasarkan action saja akan membuat angka dua
  // program itu identik dan menyesatkan dashboard pengurus.
  const actionCounts = db
    .prepare(
      `SELECT i.kind,a.action,count(*) AS count
       FROM community_hub_actions a
       JOIN community_hub_items i ON i.id=a.item_id AND i.community_id=a.community_id
       WHERE a.community_id=?
       GROUP BY i.kind,a.action`,
    )
    .all(communityId) as { kind: HubKind; action: string; count: number }[]
  const countAction = (kind: HubKind, action: string) =>
    actionCounts.find((row) => row.kind === kind && row.action === action)?.count ?? 0
  const activeMembers = members.filter((member) => member.status === 'active')
  const count = (kind: HubKind, statuses: readonly string[]) =>
    rows.filter((row) => row.kind === kind && statuses.includes(row.status)).length

  let finance: HubAnalytics['finance'] = null
  if (canManageHubKind(me, 'finance')) {
    const entries = db
      .prepare('SELECT metadata FROM community_hub_items WHERE community_id=? AND kind=\'finance\'')
      .all(communityId) as { metadata: string }[]
    const sums = entries.reduce(
      (total, entry) => {
        const meta = jsonObject(entry.metadata)
        const amount = typeof meta.amount === 'number' ? meta.amount : 0
        if (meta.direction === 'income') total.income += amount
        if (meta.direction === 'expense') total.expense += amount
        return total
      },
      { income: 0, expense: 0 },
    )
    finance = { ...sums, balance: sums.income - sums.expense }
  }

  const announcementCount = (db
    .prepare('SELECT count(*) AS count FROM announcements WHERE community_id=?')
    .get(communityId) as { count: number }).count
  return {
    residents: {
      active: activeMembers.length,
      pending: members.filter((member) => member.status === 'pending').length,
      households: new Set(activeMembers.map((member) => member.house.trim()).filter(Boolean)).size,
    },
    operations: {
      lettersOpen: count('letter', ['SUBMITTED', 'REVIEWING']),
      complaintsOpen: count('complaint', ['SUBMITTED', 'REVIEWING', 'IN_PROGRESS']),
      announcements: announcementCount,
    },
    engagement: {
      pollsOpen: count('poll', ['open']),
      votes: countAction('poll', 'vote'),
      discussionsOpen: count('deliberation', ['scheduled', 'open']),
      campaignSupporters: countAction('campaign', 'support'),
      arisanParticipants: countAction('arisan', 'join'),
      bereavementParticipants: countAction('bereavement', 'join'),
    },
    finance,
  }
}

function defaultBranding(): Branding {
  return {
    brandName: '',
    accentColor: '#2ec27e',
    logoUrl: '',
    customDomain: '',
    domainStatus: 'none',
    whiteLabelRequested: false,
  }
}

function normalizeDomain(raw: unknown): string | null {
  const value = cleanText(raw, 253).toLowerCase().replace(/\.$/, '')
  if (!value) return ''
  if (
    value === 'localhost' ||
    /^[0-9.]+$/.test(value) ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value)
  )
    return null
  return value
}

function mapBranding(row: BrandingRow | undefined, revealToken: boolean): Branding {
  if (!row) return defaultBranding()
  const branding: Branding = {
    brandName: row.brand_name,
    accentColor: row.accent_color,
    logoUrl: row.logo_url,
    customDomain: row.custom_domain,
    domainStatus: row.domain_status,
    whiteLabelRequested: !!row.white_label_requested,
  }
  if (revealToken && row.custom_domain && row.verification_token) {
    branding.verificationName = `_wjw.${row.custom_domain}`
    branding.verificationValue = row.verification_token
  }
  return branding
}

export function getCommunityBranding(me: MemberRow): Branding {
  if (!me.community_id) throw new HubError('forbidden')
  const row = db
    .prepare('SELECT * FROM community_branding WHERE community_id=?')
    .get(me.community_id) as BrandingRow | undefined
  return mapBranding(row, canConfigureBranding(me))
}

function subscriptionTier(communityId: string): string {
  const row = db
    .prepare('SELECT subscription_tier FROM communities WHERE id=?')
    .get(communityId) as { subscription_tier?: string } | undefined
  return row?.subscription_tier ?? 'FREE'
}

export function saveCommunityBranding(
  me: MemberRow,
  input: {
    brandName?: unknown
    accentColor?: unknown
    logoUrl?: unknown
    customDomain?: unknown
    whiteLabelRequested?: unknown
  },
): Branding {
  if (!me.community_id || !canConfigureBranding(me)) throw new HubError('forbidden')
  const before = db
    .prepare('SELECT * FROM community_branding WHERE community_id=?')
    .get(me.community_id) as BrandingRow | undefined
  const brandName = cleanText(input.brandName, 60)
  const accentColor = cleanText(input.accentColor, 7)
  const logoUrl = cleanText(input.logoUrl, 500)
  const domain = normalizeDomain(input.customDomain)
  if (!/^#[0-9a-fA-F]{6}$/.test(accentColor) || (logoUrl && !/^https:\/\//.test(logoUrl)) || domain === null)
    throw new HubError('invalid_hub_input')

  const domainChanged = domain !== (before?.custom_domain ?? '')
  // Keselamatan, SOS, administrasi, dan partisipasi tidak pernah dipagari
  // paket. Yang memang memerlukan operasi DNS/white-label organisasi adalah
  // custom domain/white-label, sehingga hanya ENTERPRISE yang dapat meminta
  // kemampuan baru tersebut. Penghapusan konfigurasi lama tetap diizinkan.
  const asksNewWhiteLabel = input.whiteLabelRequested === true && !before?.white_label_requested
  if ((!!domain && domainChanged) || asksNewWhiteLabel) {
    if (subscriptionTier(me.community_id) !== 'ENTERPRISE')
      throw new HubError('tier_required')
  }
  const domainStatus: Branding['domainStatus'] = domain
    ? domainChanged
      ? 'pending_dns'
      : before?.domain_status ?? 'pending_dns'
    : 'none'
  const verificationToken = domain
    ? domainChanged
      ? uid('wjw-dns-')
      : before?.verification_token ?? uid('wjw-dns-')
    : ''
  const whiteLabelRequested = input.whiteLabelRequested === true
  const at = now()

  db.prepare(
    `INSERT INTO community_branding
     (community_id,brand_name,accent_color,logo_url,custom_domain,domain_status,verification_token,white_label_requested,updated_by,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(community_id) DO UPDATE SET
       brand_name=excluded.brand_name,
       accent_color=excluded.accent_color,
       logo_url=excluded.logo_url,
       custom_domain=excluded.custom_domain,
       domain_status=excluded.domain_status,
       verification_token=excluded.verification_token,
       white_label_requested=excluded.white_label_requested,
       updated_by=excluded.updated_by,
       updated_at=excluded.updated_at`,
  ).run(
    me.community_id,
    brandName,
    accentColor,
    logoUrl,
    domain,
    domainStatus,
    verificationToken,
    whiteLabelRequested ? 1 : 0,
    me.id,
    at,
  )
  return getCommunityBranding(me)
}

/**
 * Verifikasi hanya membuktikan kepemilikan DNS. Ia tidak mengaku bahwa Fly
 * sudah memprovisikan sertifikat/routing; operator tetap harus memasang domain
 * itu pada Fly sebelum pengguna bisa membukanya.
 */
export async function verifyCommunityDomain(me: MemberRow): Promise<{ branding: Branding; verified: boolean }> {
  if (!me.community_id || !canConfigureBranding(me)) throw new HubError('forbidden')
  const row = db
    .prepare('SELECT * FROM community_branding WHERE community_id=?')
    .get(me.community_id) as BrandingRow | undefined
  if (!row?.custom_domain || !row.verification_token) throw new HubError('domain_pending')
  try {
    const { resolveTxt } = await import('node:dns/promises')
    const records = await resolveTxt(`_wjw.${row.custom_domain}`)
    const values = records.map((record) => record.join('')).flat()
    if (!values.includes(row.verification_token)) {
      return { branding: mapBranding(row, true), verified: false }
    }
    db.prepare(
      "UPDATE community_branding SET domain_status='dns_verified', updated_at=? WHERE community_id=?",
    ).run(now(), me.community_id)
    return { branding: getCommunityBranding(me), verified: true }
  } catch {
    return { branding: mapBranding(row, true), verified: false }
  }
}
