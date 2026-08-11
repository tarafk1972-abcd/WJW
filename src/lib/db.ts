import type {
  Announcement,
  Checkpoint,
  PatrolLog,
  PatrolLogStatus,
  PatrolSchedule,
  Attachment,
  AuditEntry,
  Broadcast,
  EmergencyProfile,
  Community,
  DBShape,
  Guest,
  Invite,
  Lang,
  LatLng,
  Member,
  Patrol,
  Payment,
  LocationPing,
  ProfileSnapshot,
  Recipient,
  Report,
  Role,
  Ticket,
  TrustedContact,
} from './types'

export const SUPERADMIN_EMAIL = 'tarafk1972@gmail.com'
export const TRIAL_DAYS = 14
export const DAY = 24 * 60 * 60 * 1000

export const PRICE_MONTHLY = 149000
export const PRICE_YEARLY = 1490000

/** Satu-satunya metode pembayaran langganan. */
export const PAYMENT_METHOD = 'QRIS ShopeePay'

const STORAGE_KEY = 'wjw.db.v1'
const SESSION_KEY = 'wjw.session.v1'
const DEVICE_KEY = 'wjw.device.v1'
const LANG_KEY = 'wjw.lang.v1'

/**
 * Always build a *fresh* empty shape. Returning a shared constant here would let
 * callers mutate it (e.g. `db.members.push(...)`) and leak state across resets.
 */
function emptyDB(): DBShape {
  return {
    version: 1,
    communities: [],
    members: [],
    reports: [],
    patrols: [],
    guests: [],
    announcements: [],
    broadcasts: [],
    contacts: [],
    checkpoints: [],
    schedules: [],
    patrolLogs: [],
    invites: [],
    tickets: [],
    payments: [],
    audit: [],
  }
}

export function uid(prefix = ''): string {
  return (
    prefix +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8)
  )
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

let cache: DBShape | null = null

/** Drop the in-memory cache (used when storage is cleared out of band, e.g. tests). */
export function invalidateCache() {
  cache = null
}

export function loadDB(): DBShape {
  // If storage was wiped externally (other tab, devtools, tests), drop the cache.
  if (cache && localStorage.getItem(STORAGE_KEY) === null) cache = null
  if (cache) return cache
  const stored = safeParse<Partial<DBShape> | null>(
    localStorage.getItem(STORAGE_KEY),
    null,
  )
  cache = { ...emptyDB(), ...(stored ?? {}) }
  migrate(cache)
  ensureSuperadmin(cache)
  return cache
}

/**
 * Menyesuaikan data lama yang sudah tersimpan di perangkat.
 *
 * Data disimpan di localStorage, jadi memperbaiki kode saja tidak cukup:
 * pembayaran yang dibuat versi lama tetap membawa metode pilihan admin
 * ('Transfer Bank BCA', 'GoPay', 'OVO', …) dan akan terus tampil di
 * riwayat meski daftar metodenya sudah dihapus.
 */
function migrate(db: DBShape) {
  for (const p of db.payments) {
    if (p.method !== PAYMENT_METHOD) {
      p.method = PAYMENT_METHOD
    }
  }
}

/** Terlempar saat penyimpanan penuh dan tidak bisa dikosongkan lagi. */
export class StorageFullError extends Error {
  constructor() {
    super('storage-full')
    this.name = 'StorageFullError'
  }
}

function isQuotaError(e: unknown): boolean {
  return (
    e instanceof DOMException &&
    (e.name === 'QuotaExceededError' ||
      e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      e.code === 22)
  ) || (e instanceof Error && e.name === 'QuotaExceededError')
}

/**
 * Membuang lampiran terberat dari laporan lama agar ada ruang.
 * Peringatan darurat yang masih aktif tidak pernah disentuh.
 * @returns true bila berhasil membebaskan sesuatu.
 */
function evictOldMedia(db: DBShape): boolean {
  const candidates = db.reports
    .filter((r) => !r.live && (r.attachments.length > 0 || r.audio))
    .sort((a, b) => a.createdAt - b.createdAt)

  for (const r of candidates) {
    if (r.attachments.length) {
      r.attachments = []
      return true
    }
    if (r.audio) {
      r.audio = null
      return true
    }
  }
  return false
}

/**
 * Salinan dangkal dengan identitas array yang baru untuk setiap koleksi.
 *
 * Penulisan dilakukan dengan mengubah isi array langsung
 * (`db.payments.unshift(...)`), sehingga identitas arraynya tidak berubah.
 * Padahal banyak layar memakai `useMemo(..., [db.payments])`: tanpa
 * identitas baru, memo tidak pernah dihitung ulang dan data baru tidak
 * muncul sampai halaman dimuat ulang. Isi tiap array tetap dibagi
 * bersama, jadi biayanya kecil.
 */
function snapshot(db: DBShape): DBShape {
  const out = { ...db } as unknown as Record<string, unknown>
  for (const key of Object.keys(out)) {
    const v = out[key]
    if (Array.isArray(v)) out[key] = [...v]
  }
  return out as unknown as DBShape
}

/**
 * Menyimpan basis data.
 *
 * Penyimpanan browser hanya sekitar 5 MB, sementara satu video bisa
 * menghabiskannya sendiri. Bila kuota penuh, media laporan lama dibuang
 * bertahap agar peringatan darurat yang baru tetap tersimpan — data
 * keselamatan lebih penting daripada lampiran lama.
 */
export function saveDB(db: DBShape) {
  cache = db
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
      // Ganti cache dengan salinan bersnapshot agar layar ikut diperbarui.
      cache = snapshot(db)
      window.dispatchEvent(new CustomEvent('wjw:db'))
      return
    } catch (e) {
      if (!isQuotaError(e)) throw e
      if (!evictOldMedia(db)) {
        // tidak ada lagi yang bisa dibuang
        window.dispatchEvent(new CustomEvent('wjw:storage-full'))
        throw new StorageFullError()
      }
    }
  }
  window.dispatchEvent(new CustomEvent('wjw:storage-full'))
  throw new StorageFullError()
}

/** Perkiraan pemakaian penyimpanan dalam byte. */
export function storageBytes(): number {
  return (localStorage.getItem(STORAGE_KEY) || '').length * 2
}

export function resetDB() {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(SESSION_KEY)
  cache = null
  window.dispatchEvent(new CustomEvent('wjw:db'))
}

function ensureSuperadmin(db: DBShape) {
  if (!db.members.some((m) => m.email === SUPERADMIN_EMAIL)) {
    db.members.push({
      id: 'superadmin',
      communityId: null,
      name: 'Superadmin',
      phone: '+620000000000',
      email: SUPERADMIN_EMAIL,
      password: 'superadmin',
      house: '-',
      role: 'superadmin',
      status: 'active',
      language: 'id',
      deviceId: null,
      createdAt: Date.now(),
      decidedAt: Date.now(),
      decidedBy: null,
    })
  }
}

/* ---------------- device & session ---------------- */

export function deviceId(): string {
  let d = localStorage.getItem(DEVICE_KEY)
  if (!d) {
    d = uid('dev_')
    localStorage.setItem(DEVICE_KEY, d)
  }
  return d
}

export function getSessionId(): string | null {
  return localStorage.getItem(SESSION_KEY)
}

export function setSession(memberId: string | null) {
  if (memberId) localStorage.setItem(SESSION_KEY, memberId)
  else localStorage.removeItem(SESSION_KEY)
  window.dispatchEvent(new CustomEvent('wjw:db'))
}

export function getStoredLang(): Lang | null {
  const v = localStorage.getItem(LANG_KEY)
  return v === 'id' || v === 'en' || v === 'su' ? v : null
}

export function storeLang(lang: Lang) {
  localStorage.setItem(LANG_KEY, lang)
}

/* ---------------- audit ---------------- */

export function audit(
  db: DBShape,
  communityId: string | null,
  actorId: string,
  action: string,
  detail: string,
) {
  const e: AuditEntry = {
    id: uid('a_'),
    communityId,
    actorId,
    action,
    detail,
    at: Date.now(),
  }
  db.audit.unshift(e)
  if (db.audit.length > 500) db.audit.length = 500
}

/* ---------------- billing ---------------- */

export function planState(c: Community): {
  status: 'trial' | 'active' | 'expired' | 'suspended'
  daysLeft: number
} {
  if (c.plan === 'suspended') return { status: 'suspended', daysLeft: 0 }
  const now = Date.now()
  if (c.paidUntil && c.paidUntil > now) {
    return { status: 'active', daysLeft: Math.ceil((c.paidUntil - now) / DAY) }
  }
  if (c.trialEndsAt > now) {
    return { status: 'trial', daysLeft: Math.ceil((c.trialEndsAt - now) / DAY) }
  }
  return { status: 'expired', daysLeft: 0 }
}

/* ---------------- geo ---------------- */

export function pointInPolygon(p: LatLng, poly: LatLng[]): boolean {
  if (poly.length < 3) return false
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].lng
    const yi = poly[i].lat
    const xj = poly[j].lng
    const yj = poly[j].lat
    const intersect =
      yi > p.lat !== yj > p.lat &&
      p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi || 1e-12) + xi
    if (intersect) inside = !inside
  }
  return inside
}

export function polygonCenter(poly: LatLng[]): LatLng | null {
  if (!poly.length) return null
  const lat = poly.reduce((s, p) => s + p.lat, 0) / poly.length
  const lng = poly.reduce((s, p) => s + p.lng, 0) / poly.length
  return { lat, lng }
}

/* ---------------- queries ---------------- */

export function memberById(db: DBShape, id: string | null): Member | null {
  if (!id) return null
  return db.members.find((m) => m.id === id) ?? null
}

export function communityById(
  db: DBShape,
  id: string | null,
): Community | null {
  if (!id) return null
  return db.communities.find((c) => c.id === id) ?? null
}

export function membersOf(db: DBShape, communityId: string): Member[] {
  return db.members.filter((m) => m.communityId === communityId)
}

export function isAdminish(m: Member | null): boolean {
  return !!m && (m.role === 'admin' || m.role === 'superadmin')
}

/* ---------------- mutations ---------------- */

export interface RegisterInput {
  name: string
  phone: string
  email: string
  password: string
  house: string
  language: Lang
  mode: 'create' | 'join'
  communityId?: string
  communityName?: string
  communityAddress?: string
  city?: string
  center?: LatLng
  /** Invite code (typed or scanned from a QR). Optional. */
  inviteCode?: string
  /** Message shown to the admin reviewing the request. */
  joinNote?: string
}

/** Normalise a code so 'abc-123' and 'ABC123' match the same invite. */
export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** Payload encoded in a community QR code. */
export function inviteLink(code: string): string {
  return `${location.origin}${location.pathname}#/join/${code}`
}

/** Extract a code from a raw QR payload (accepts a bare code or a full link). */
export function parseInvitePayload(raw: string): string {
  const text = raw.trim()
  const m = text.match(/#\/join\/([A-Za-z0-9-]+)/)
  return normalizeCode(m ? m[1] : text)
}

export type InviteLookup =
  | { ok: true; invite: Invite; community: Community }
  | { ok: false; error: 'errInvite' | 'errInviteExpired' | 'errInviteUsed' }

/** Validate an invite code without consuming it. */
export function lookupInvite(rawCode: string): InviteLookup {
  const db = loadDB()
  const code = normalizeCode(rawCode)
  if (!code) return { ok: false, error: 'errInvite' }
  const invite = db.invites.find((i) => normalizeCode(i.code) === code)
  if (!invite || invite.revokedAt) return { ok: false, error: 'errInvite' }
  if (invite.expiresAt <= Date.now()) return { ok: false, error: 'errInviteExpired' }
  if (invite.maxUses !== null && invite.usedBy.length >= invite.maxUses)
    return { ok: false, error: 'errInviteUsed' }
  const community = communityById(db, invite.communityId)
  if (!community) return { ok: false, error: 'errInvite' }
  return { ok: true, invite, community }
}

/** Search communities by name or city, for the "request to join" flow. */
export function searchCommunities(query: string): Community[] {
  const db = loadDB()
  const q = query.trim().toLowerCase()
  if (!q) return db.communities.slice(0, 20)
  return db.communities
    .filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.city.toLowerCase().includes(q) ||
        c.address.toLowerCase().includes(q),
    )
    .slice(0, 20)
}

export type RegisterResult =
  | { ok: true; member: Member; community: Community; firstAdmin: boolean }
  | { ok: false; error: string }

export function register(input: RegisterInput): RegisterResult {
  const db = loadDB()
  const email = input.email.trim().toLowerCase()
  const phone = input.phone.replace(/\s|-/g, '')

  if (db.members.some((m) => m.email.toLowerCase() === email))
    return { ok: false, error: 'errEmailTaken' }
  if (db.members.some((m) => m.phone.replace(/\s|-/g, '') === phone))
    return { ok: false, error: 'errPhoneTaken' }

  let community: Community | null = null
  let role: Role = 'warga'
  let status: Member['status'] = 'pending'
  let firstAdmin = false
  let invite: Invite | null = null

  if (input.mode === 'create') {
    /*
     * Nama lingkungan wajib diisi sendiri oleh admin.
     *
     * Tanpa pemeriksaan ini, nama kosong lolos dan judul di bagian atas
     * aplikasi jadi kosong — lalu satu-satunya nama yang terlihat di situ
     * adalah nama admin, seolah lingkungan itu bernama seperti orangnya.
     * Nama orang tidak boleh menjadi nama tempat: pengurus bisa berganti,
     * sedangkan lingkungannya tetap.
     */
    const nama = (input.communityName || '').trim()
    if (!nama) return { ok: false, error: 'errCommunityName' }

    // Menolak nama lingkungan yang sama persis dengan nama pendaftarnya:
    // itu hampir selalu salah isi kolom, bukan nama tempat sungguhan.
    if (nama.toLowerCase() === input.name.trim().toLowerCase())
      return { ok: false, error: 'errCommunityNameIsPerson' }

    const now = Date.now()
    community = {
      id: uid('c_'),
      name: nama,
      address: (input.communityAddress || '').trim(),
      city: (input.city || '').trim(),
      createdAt: now,
      createdBy: '',
      area: [],
      areaUpdatedAt: null,
      areaUpdatedBy: null,
      center: input.center ?? { lat: -6.9829, lng: 107.5197 },
      language: input.language,
      plan: 'trial',
      planName: 'trial',
      trialEndsAt: now + TRIAL_DAYS * DAY,
      paidUntil: null,
    }
    db.communities.push(community)
    // First resident of a new neighbourhood is automatically Admin & approved.
    role = 'admin'
    status = 'active'
    firstAdmin = true
  } else {
    community = communityById(db, input.communityId ?? null)
    if (!community) return { ok: false, error: 'errNoCommunity' }

    // If (edge case) the community somehow has no active admin, first joiner becomes admin.
    const hasAdmin = db.members.some(
      (m) =>
        m.communityId === community!.id &&
        m.role === 'admin' &&
        m.status === 'active',
    )
    if (!hasAdmin) {
      role = 'admin'
      status = 'active'
      firstAdmin = true
    }

    const code = normalizeCode(input.inviteCode || '')
    if (code) {
      const found = lookupInvite(code)
      if (!found.ok) return { ok: false, error: found.error }
      if (found.invite.communityId !== community.id)
        return { ok: false, error: 'errInvite' }
      invite = found.invite
      // An invite proposes a role but does NOT bypass the admin: every joiner
      // still waits in the approval queue.
      role = invite.role
      if (!firstAdmin) status = 'pending'
    }
  }

  const member: Member = {
    id: uid('m_'),
    communityId: community.id,
    name: input.name.trim(),
    phone,
    email,
    password: input.password,
    house: input.house.trim(),
    role,
    status,
    language: input.language,
    deviceId: deviceId(),
    createdAt: Date.now(),
    decidedAt: status === 'active' ? Date.now() : null,
    decidedBy: null,
    invitedBy: invite ? invite.createdBy : null,
    joinMethod: firstAdmin ? 'founder' : invite ? 'invite' : 'search',
    joinCode: invite ? invite.code : null,
    joinNote: (input.joinNote || '').trim(),
  }
  db.members.push(member)

  if (firstAdmin) community.createdBy = member.id
  if (invite) invite.usedBy.push(member.id)

  audit(
    db,
    community.id,
    member.id,
    'register',
    firstAdmin
      ? `${member.name} created ${community.name} and became Admin`
      : `${member.name} registered as ${role} (${status})`,
  )
  saveDB(db)
  setSession(member.id)
  storeLang(input.language)
  return { ok: true, member, community, firstAdmin }
}

export function login(
  identifier: string,
  password: string,
): { ok: true; member: Member } | { ok: false; error: string } {
  const db = loadDB()
  const q = identifier.trim().toLowerCase().replace(/\s|-/g, '')
  const m = db.members.find(
    (x) =>
      (x.email.toLowerCase() === q || x.phone.replace(/\s|-/g, '') === q) &&
      x.password === password,
  )
  if (!m) return { ok: false, error: 'errLogin' }
  // Perangkat hanya diklaim untuk warga — lihat catatan di server/index.ts.
  if (m.role !== 'superadmin') m.deviceId = deviceId()
  saveDB(db)
  setSession(m.id)
  storeLang(m.language)
  return { ok: true, member: m }
}

export function decideMember(
  actorId: string,
  memberId: string,
  decision: 'accept' | 'reject',
  role: Exclude<Role, 'superadmin'> = 'warga',
  reason = '',
) {
  const db = loadDB()
  const m = memberById(db, memberId)
  if (!m) return
  if (decision === 'accept') {
    m.status = 'active'
    m.role = role
    m.rejectedReason = undefined
  } else {
    m.status = 'rejected'
    m.rejectedReason = reason
  }
  m.decidedAt = Date.now()
  m.decidedBy = actorId
  audit(
    db,
    m.communityId,
    actorId,
    decision === 'accept' ? 'member.accept' : 'member.reject',
    `${m.name} → ${decision === 'accept' ? role : 'rejected'}`,
  )
  saveDB(db)
}

export function setRole(
  actorId: string,
  memberId: string,
  role: Exclude<Role, 'superadmin'>,
) {
  const db = loadDB()
  const m = memberById(db, memberId)
  if (!m) return
  m.role = role
  audit(db, m.communityId, actorId, 'member.role', `${m.name} → ${role}`)
  saveDB(db)
}

export function setMemberStatus(
  actorId: string,
  memberId: string,
  status: Member['status'],
) {
  const db = loadDB()
  const m = memberById(db, memberId)
  if (!m) return
  m.status = status
  audit(db, m.communityId, actorId, 'member.status', `${m.name} → ${status}`)
  saveDB(db)
}

export function setMemberLanguage(memberId: string, lang: Lang) {
  const db = loadDB()
  const m = memberById(db, memberId)
  if (!m) return
  m.language = lang
  saveDB(db)
  storeLang(lang)
}

export function saveArea(actorId: string, communityId: string, area: LatLng[]) {
  const db = loadDB()
  const c = communityById(db, communityId)
  if (!c) return
  c.area = area
  c.areaUpdatedAt = Date.now()
  c.areaUpdatedBy = actorId
  const ctr = polygonCenter(area)
  if (ctr) c.center = ctr
  audit(db, c.id, actorId, 'area.save', `${area.length} points`)
  saveDB(db)
}

export function createInvite(
  actorId: string,
  communityId: string,
  role: Exclude<Role, 'superadmin'>,
  opts: { days?: number; maxUses?: number | null } = {},
): Invite {
  const db = loadDB()
  // Avoid ambiguous glyphs (0/O, 1/I) so codes are easy to read aloud.
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  do {
    code = Array.from(
      { length: 6 },
      () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)],
    ).join('')
  } while (db.invites.some((i) => i.code === code))

  const inv: Invite = {
    id: uid('i_'),
    communityId,
    code,
    role,
    createdBy: actorId,
    createdAt: Date.now(),
    expiresAt: Date.now() + (opts.days ?? 7) * DAY,
    usedBy: [],
    maxUses: opts.maxUses ?? null,
    revokedAt: null,
  }
  db.invites.unshift(inv)
  audit(db, communityId, actorId, 'invite.create', `${role} · ${code}`)
  saveDB(db)
  return inv
}

export function revokeInvite(actorId: string, inviteId: string) {
  const db = loadDB()
  const inv = db.invites.find((i) => i.id === inviteId)
  if (!inv) return
  inv.revokedAt = Date.now()
  audit(db, inv.communityId, actorId, 'invite.revoke', inv.code)
  saveDB(db)
}

/* ---------------- trusted contacts (safety network) ---------------- */

export function addContact(
  c: Omit<TrustedContact, 'id' | 'createdAt'>,
): TrustedContact {
  const db = loadDB()
  const contact: TrustedContact = { ...c, id: uid('ct_'), createdAt: Date.now() }
  db.contacts.unshift(contact)
  audit(db, c.communityId, c.ownerId ?? 'system', 'contact.add', `${c.kind}: ${c.name}`)
  saveDB(db)
  return contact
}

export function removeContact(id: string) {
  const db = loadDB()
  db.contacts = db.contacts.filter((c) => c.id !== id)
  saveDB(db)
}

export function setContactVerified(
  actorId: string,
  id: string,
  verified: boolean,
) {
  const db = loadDB()
  const c = db.contacts.find((x) => x.id === id)
  if (!c) return
  c.verified = verified
  audit(db, c.communityId, actorId, 'contact.verify', `${c.name} → ${verified}`)
  saveDB(db)
}

/** Personal contacts (family & friends) belonging to one member. */
export function personalContacts(db: DBShape, memberId: string): TrustedContact[] {
  return db.contacts.filter((c) => c.ownerId === memberId)
}

/**
 * Everyone who should receive this member's alert:
 *   - their own family & friends
 *   - verified community responders, guards and volunteers
 *   - active guards/admins in the community (they are responders by role)
 *
 * Police and emergency services are intentionally NOT included.
 */
export function alertAudience(
  db: DBShape,
  member: Member,
): Omit<Recipient, 'deliveredAt' | 'acknowledgedAt'>[] {
  if (!member.communityId) return []
  const out: Omit<Recipient, 'deliveredAt' | 'acknowledgedAt'>[] = []
  const seen = new Set<string>()

  const push = (r: Omit<Recipient, 'deliveredAt' | 'acknowledgedAt'>) => {
    const key = r.memberId ?? r.phone.replace(/\D/g, '') ?? r.id
    if (!key || seen.has(key)) return
    seen.add(key)
    out.push(r)
  }

  for (const c of db.contacts) {
    if (c.communityId !== member.communityId) continue
    const personal = c.ownerId === member.id
    const community = c.ownerId === null && c.verified
    if (!personal && !community) continue
    push({
      id: c.id,
      name: c.name,
      phone: c.phone,
      kind: c.kind,
      memberId: c.memberId,
    })
  }

  for (const m of db.members) {
    if (
      m.communityId !== member.communityId ||
      m.status !== 'active' ||
      m.id === member.id
    )
      continue
    if (m.role === 'satpam') {
      push({ id: m.id, name: m.name, phone: m.phone, kind: 'guard', memberId: m.id })
    } else if (m.role === 'admin') {
      push({ id: m.id, name: m.name, phone: m.phone, kind: 'responder', memberId: m.id })
    }
  }

  return out
}

export function profileSnapshot(m: Member): ProfileSnapshot {
  return {
    name: m.name,
    phone: m.phone,
    house: m.house,
    bloodType: m.emergency?.bloodType ?? '',
    allergies: m.emergency?.allergies ?? '',
    conditions: m.emergency?.conditions ?? '',
    contactName: m.emergency?.contactName ?? '',
    contactPhone: m.emergency?.contactPhone ?? '',
    notes: m.emergency?.notes ?? '',
  }
}

/**
 * Raise a panic alert: freezes the caller's profile, resolves the audience and
 * marks the alert live so location streaming can begin.
 */
export function raiseAlert(opts: {
  member: Member
  category: Report['category']
  at: LatLng | null
  accuracy?: number | null
}): Report {
  const db = loadDB()
  const { member, category, at } = opts
  if (!member.communityId) throw new Error('member has no community')

  const audience = alertAudience(db, member)
  const now = Date.now()
  const rep: Report = {
    id: uid('r_'),
    communityId: member.communityId,
    authorId: member.id,
    kind: 'sos',
    category,
    note: '',
    at,
    address: member.house,
    status: 'open',
    createdAt: now,
    handledBy: null,
    handledAt: null,
    insideArea: null,
    attachments: [],
    messages: [],
    responders: [],
    track: at
      ? [{ lat: at.lat, lng: at.lng, at: now, accuracy: opts.accuracy ?? null }]
      : [],
    live: true,
    liveEndedAt: null,
    audio: null,
    audioSeconds: 0,
    snapshot: profileSnapshot(member),
    recipients: audience.map((a) => ({
      ...a,
      deliveredAt: now,
      acknowledgedAt: null,
    })),
    cancelledAt: null,
  }

  const c = communityById(db, member.communityId)
  rep.insideArea = c && c.area.length >= 3 && at ? pointInPolygon(at, c.area) : null

  db.reports.unshift(rep)
  audit(
    db,
    member.communityId,
    member.id,
    'alert.raise',
    `${category} → ${rep.recipients.length} recipients`,
  )
  saveDB(db)
  return rep
}

/** Append a live-location ping while the alert is active. */
export function pushLocation(reportId: string, ping: LocationPing) {
  const db = loadDB()
  const r = db.reports.find((x) => x.id === reportId)
  if (!r || !r.live) return
  const last = r.track[r.track.length - 1]
  // ignore duplicate fixes so the trail stays meaningful
  if (last && last.lat === ping.lat && last.lng === ping.lng) return
  r.track.push(ping)
  r.at = { lat: ping.lat, lng: ping.lng }
  if (r.track.length > 500) r.track.shift()
  saveDB(db)
}

export function stopLive(reportId: string) {
  const db = loadDB()
  const r = db.reports.find((x) => x.id === reportId)
  if (!r || !r.live) return
  r.live = false
  r.liveEndedAt = Date.now()
  saveDB(db)
}

export function attachAudio(reportId: string, dataUrl: string, seconds: number) {
  const db = loadDB()
  const r = db.reports.find((x) => x.id === reportId)
  if (!r) return
  r.audio = dataUrl
  r.audioSeconds = seconds
  saveDB(db)
}

/** A recipient confirms they are on the way. */
export function acknowledgeAlert(reportId: string, memberId: string) {
  const db = loadDB()
  const r = db.reports.find((x) => x.id === reportId)
  if (!r) return
  const rec = r.recipients.find((x) => x.memberId === memberId)
  if (rec && !rec.acknowledgedAt) rec.acknowledgedAt = Date.now()
  if (!r.responders.includes(memberId)) r.responders.push(memberId)
  if (r.status === 'open') {
    r.status = 'ack'
    r.handledBy = memberId
    r.handledAt = Date.now()
  }
  saveDB(db)
}

/** Caller cancels their own alert (false alarm). */
export function cancelAlert(reportId: string, actorId: string) {
  const db = loadDB()
  const r = db.reports.find((x) => x.id === reportId)
  if (!r) return
  r.cancelledAt = Date.now()
  r.status = 'resolved'
  r.live = false
  r.liveEndedAt = Date.now()
  audit(db, r.communityId, actorId, 'alert.cancel', r.category)
  saveDB(db)
}

/** Fields the caller supplies; everything else is derived by addReport. */
type NewReport = Pick<
  Report,
  'communityId' | 'authorId' | 'kind' | 'category' | 'note' | 'at' | 'address'
> &
  Partial<
    Pick<Report, 'anonymous' | 'attachments' | 'messages' | 'responders'>
  >

export function addReport(r: NewReport): Report {
  const db = loadDB()
  const c = communityById(db, r.communityId)
  const inside =
    c && c.area.length >= 3 && r.at ? pointInPolygon(r.at, c.area) : null
  const rep: Report = {
    ...r,
    id: uid('r_'),
    createdAt: Date.now(),
    status: 'open',
    handledBy: null,
    handledAt: null,
    insideArea: inside,
    attachments: r.attachments ?? [],
    messages: r.messages ?? [],
    responders: r.responders ?? [],
    track: [],
    live: false,
    liveEndedAt: null,
    audio: null,
    audioSeconds: 0,
    snapshot: null,
    recipients: [],
    cancelledAt: null,
  }
  db.reports.unshift(rep)
  audit(db, r.communityId, r.authorId, `report.${r.kind}`, r.category)
  saveDB(db)
  return rep
}

/** Append a chat message to an incident thread (two-way communication). */
export function addIncidentMessage(
  reportId: string,
  from: string,
  body: string,
  system = false,
) {
  const db = loadDB()
  const r = db.reports.find((x) => x.id === reportId)
  if (!r) return
  r.messages.push({ id: uid('im_'), from, body, at: Date.now(), system })
  saveDB(db)
}

/** Mark the actor as responding to an incident and move it to "in progress". */
export function respondToReport(actorId: string, reportId: string) {
  const db = loadDB()
  const r = db.reports.find((x) => x.id === reportId)
  if (!r) return
  if (!r.responders.includes(actorId)) r.responders.push(actorId)
  if (r.status === 'open') {
    r.status = 'ack'
    r.handledBy = actorId
    r.handledAt = Date.now()
  }
  r.messages.push({
    id: uid('im_'),
    from: actorId,
    body: 'responding',
    at: Date.now(),
    system: true,
  })
  audit(db, r.communityId, actorId, 'report.respond', r.category)
  saveDB(db)
}

export function addAttachment(
  reportId: string,
  dataUrl: string,
  kind: Attachment['kind'] = 'photo',
) {
  const db = loadDB()
  const r = db.reports.find((x) => x.id === reportId)
  if (!r) return
  const a: Attachment = {
    id: uid('at_'),
    kind,
    dataUrl,
    at: Date.now(),
    // rough decoded size of the base64 payload
    bytes: Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75),
  }
  r.attachments.push(a)
  saveDB(db)
}

export function updateReport(
  actorId: string,
  reportId: string,
  patch: Partial<Report>,
) {
  const db = loadDB()
  const r = db.reports.find((x) => x.id === reportId)
  if (!r) return
  Object.assign(r, patch)
  if (patch.status === 'ack') {
    r.handledBy = actorId
    r.handledAt = Date.now()
  }
  audit(db, r.communityId, actorId, 'report.update', patch.status ?? 'edit')
  saveDB(db)
}

export function addGuest(g: Omit<Guest, 'id' | 'checkIn' | 'checkOut'>): Guest {
  const db = loadDB()
  const guest: Guest = { ...g, id: uid('g_'), checkIn: Date.now(), checkOut: null }
  db.guests.unshift(guest)
  audit(db, g.communityId, g.recordedBy, 'guest.in', g.name)
  saveDB(db)
  return guest
}

export function checkoutGuest(actorId: string, guestId: string) {
  const db = loadDB()
  const g = db.guests.find((x) => x.id === guestId)
  if (!g) return
  g.checkOut = Date.now()
  audit(db, g.communityId, actorId, 'guest.out', g.name)
  saveDB(db)
}

/* ---------------- titik ronda & jadwal ---------------- */

/** Jarak dua koordinat dalam meter (haversine). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const la1 = toRad(a.lat)
  const la2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function addCheckpoint(
  actorId: string,
  c: Omit<Checkpoint, 'id' | 'createdAt' | 'createdBy' | 'order' | 'active'> &
    Partial<Pick<Checkpoint, 'order' | 'active'>>,
): Checkpoint {
  const db = loadDB()
  const existing = db.checkpoints.filter((x) => x.communityId === c.communityId)
  const cp: Checkpoint = {
    ...c,
    id: uid('cp_'),
    order: c.order ?? existing.length + 1,
    active: c.active ?? true,
    createdBy: actorId,
    createdAt: Date.now(),
  }
  db.checkpoints.push(cp)
  audit(db, c.communityId, actorId, 'checkpoint.add', cp.name)
  saveDB(db)
  return cp
}

export function removeCheckpoint(actorId: string, id: string) {
  const db = loadDB()
  const cp = db.checkpoints.find((x) => x.id === id)
  if (!cp) return
  db.checkpoints = db.checkpoints.filter((x) => x.id !== id)
  audit(db, cp.communityId, actorId, 'checkpoint.remove', cp.name)
  saveDB(db)
}

export function checkpointsOf(db: DBShape, communityId: string): Checkpoint[] {
  return db.checkpoints
    .filter((c) => c.communityId === communityId && c.active)
    .sort((a, b) => a.order - b.order)
}

export function addSchedule(
  actorId: string,
  sch: Omit<PatrolSchedule, 'id' | 'createdAt' | 'active'> &
    Partial<Pick<PatrolSchedule, 'active'>>,
): PatrolSchedule {
  const db = loadDB()
  const s2: PatrolSchedule = {
    ...sch,
    id: uid('sc_'),
    active: sch.active ?? true,
    createdAt: Date.now(),
  }
  db.schedules.push(s2)
  audit(db, sch.communityId, actorId, 'schedule.add', s2.label)
  saveDB(db)
  return s2
}

export function removeSchedule(actorId: string, id: string) {
  const db = loadDB()
  const sc = db.schedules.find((x) => x.id === id)
  if (!sc) return
  db.schedules = db.schedules.filter((x) => x.id !== id)
  audit(db, sc.communityId, actorId, 'schedule.remove', sc.label)
  saveDB(db)
}

export function minutesOfDay(ts: number): number {
  const d = new Date(ts)
  return d.getHours() * 60 + d.getMinutes()
}

/**
 * Jadwal yang sedang berlaku pada waktu tertentu.
 * Menangani jadwal yang melewati tengah malam (mis. 22:00–02:00).
 */
export function activeSchedule(
  db: DBShape,
  communityId: string,
  at: number = Date.now(),
): { schedule: PatrolSchedule; late: boolean } | null {
  const mins = minutesOfDay(at)
  const day = new Date(at).getDay()

  for (const sc of db.schedules) {
    if (sc.communityId !== communityId || !sc.active) continue
    if (sc.days.length && !sc.days.includes(day)) continue

    const overnight = sc.endMinute <= sc.startMinute
    const end = overnight ? sc.endMinute + 1440 : sc.endMinute
    const now = overnight && mins < sc.startMinute ? mins + 1440 : mins

    if (now >= sc.startMinute && now <= end) {
      return { schedule: sc, late: now > sc.startMinute + sc.graceMin }
    }
  }
  return null
}

export interface RecordPatrolResult {
  ok: boolean
  log?: PatrolLog
  error?: 'errNoCheckpoint' | 'errTooFar' | 'errAlreadyLogged'
  distanceM?: number
  checkpoint?: Checkpoint
}

/**
 * Satu tombol ronda: cari titik terdekat, pastikan satpam benar-benar di
 * sana, lalu catat sesuai jadwal yang sedang berlaku.
 */
export function recordPatrol(opts: {
  communityId: string
  satpamId: string
  at: LatLng
  /** Titik yang dipilih manual; bila kosong dipilih yang terdekat. */
  checkpointId?: string
  note?: string
  /** Lewati pemeriksaan jarak (dipakai saat GPS tidak tersedia). */
  force?: boolean
  now?: number
}): RecordPatrolResult {
  const db = loadDB()
  const now = opts.now ?? Date.now()
  const list = checkpointsOf(db, opts.communityId)
  if (!list.length) return { ok: false, error: 'errNoCheckpoint' }

  let cp: Checkpoint | undefined
  let dist = Infinity
  if (opts.checkpointId) {
    cp = list.find((c) => c.id === opts.checkpointId)
    if (cp) dist = distanceMeters(opts.at, { lat: cp.lat, lng: cp.lng })
  } else {
    for (const c of list) {
      const d = distanceMeters(opts.at, { lat: c.lat, lng: c.lng })
      if (d < dist) {
        dist = d
        cp = c
      }
    }
  }
  if (!cp) return { ok: false, error: 'errNoCheckpoint' }

  const inside = dist <= cp.radiusM
  if (!inside && !opts.force)
    return { ok: false, error: 'errTooFar', distanceM: dist, checkpoint: cp }

  const act = activeSchedule(db, opts.communityId, now)
  let status: PatrolLogStatus = 'offschedule'
  if (act) status = act.late ? 'late' : 'ontime'

  // Cegah dobel-catat di titik yang sama dalam 5 menit.
  // Pakai selisih mutlak: tanpa itu, catatan yang waktunya lebih awal dari
  // log terakhir menghasilkan selisih negatif dan ikut terblokir.
  const recent = db.patrolLogs.find(
    (l) =>
      l.checkpointId === cp!.id &&
      l.satpamId === opts.satpamId &&
      Math.abs(now - l.at) < 5 * 60 * 1000,
  )
  if (recent) return { ok: false, error: 'errAlreadyLogged', checkpoint: cp }

  const log: PatrolLog = {
    id: uid('pl_'),
    communityId: opts.communityId,
    satpamId: opts.satpamId,
    checkpointId: cp.id,
    checkpointName: cp.name,
    scheduleId: act?.schedule.id ?? null,
    scheduleLabel: act?.schedule.label ?? '',
    at: now,
    lat: opts.at.lat,
    lng: opts.at.lng,
    distanceM: Math.round(dist),
    insideRadius: inside,
    status,
    note: (opts.note || '').trim(),
  }
  db.patrolLogs.unshift(log)
  if (db.patrolLogs.length > 1000) db.patrolLogs.length = 1000
  audit(db, opts.communityId, opts.satpamId, 'patrol.log', `${cp.name} · ${status}`)
  saveDB(db)
  return { ok: true, log, checkpoint: cp, distanceM: dist }
}

/** Log ronda pada satu hari (untuk rekap admin). */
export function logsForDay(
  db: DBShape,
  communityId: string,
  dayStart: number,
): PatrolLog[] {
  const dayEnd = dayStart + DAY
  return db.patrolLogs.filter(
    (l) => l.communityId === communityId && l.at >= dayStart && l.at < dayEnd,
  )
}

export function startPatrol(communityId: string, satpamId: string): Patrol {
  const db = loadDB()
  const p: Patrol = {
    id: uid('p_'),
    communityId,
    satpamId,
    startedAt: Date.now(),
    endedAt: null,
    points: [],
  }
  db.patrols.unshift(p)
  audit(db, communityId, satpamId, 'patrol.start', '')
  saveDB(db)
  return p
}

export function addPatrolPoint(
  patrolId: string,
  point: { lat: number; lng: number; note: string },
) {
  const db = loadDB()
  const p = db.patrols.find((x) => x.id === patrolId)
  if (!p) return
  p.points.push({ ...point, at: Date.now() })
  saveDB(db)
}

export function endPatrol(patrolId: string) {
  const db = loadDB()
  const p = db.patrols.find((x) => x.id === patrolId)
  if (!p) return
  p.endedAt = Date.now()
  audit(db, p.communityId, p.satpamId, 'patrol.end', `${p.points.length} checkpoints`)
  saveDB(db)
}

export function addAnnouncement(
  a: Omit<Announcement, 'id' | 'createdAt'>,
): Announcement {
  const db = loadDB()
  const ann: Announcement = { ...a, id: uid('n_'), createdAt: Date.now() }
  db.announcements.unshift(ann)
  audit(db, a.communityId, a.authorId, 'announcement', a.title)
  saveDB(db)
  return ann
}

export function deleteAnnouncement(id: string) {
  const db = loadDB()
  db.announcements = db.announcements.filter((a) => a.id !== id)
  saveDB(db)
}

export function openTicket(
  communityId: string,
  openedBy: string,
  subject: string,
  body: string,
): Ticket {
  const db = loadDB()
  const t: Ticket = {
    id: uid('t_'),
    communityId,
    openedBy,
    subject,
    status: 'open',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [{ id: uid('tm_'), from: openedBy, body, at: Date.now() }],
  }
  db.tickets.unshift(t)
  audit(db, communityId, openedBy, 'ticket.open', subject)
  saveDB(db)
  return t
}

export function replyTicket(ticketId: string, from: string, body: string) {
  const db = loadDB()
  const t = db.tickets.find((x) => x.id === ticketId)
  if (!t) return
  t.messages.push({ id: uid('tm_'), from, body, at: Date.now() })
  t.updatedAt = Date.now()
  t.status = from === 'superadmin' ? 'answered' : 'open'
  saveDB(db)
}

export function closeTicket(ticketId: string) {
  const db = loadDB()
  const t = db.tickets.find((x) => x.id === ticketId)
  if (!t) return
  t.status = 'closed'
  t.updatedAt = Date.now()
  saveDB(db)
}

/**
 * Nomor referensi pembayaran — ditentukan sistem, tidak bisa diisi
 * atau diubah admin. Bentuknya sama dengan yang dibuat server
 * (server/billing.ts): "WJW" + 5 karakter tanpa glif rancu.
 */
export function paymentReference(db: DBShape = loadDB()): string {
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  do {
    code =
      'WJW' +
      Array.from(
        { length: 5 },
        () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)],
      ).join('')
  } while (db.payments.some((p) => p.reference === code))
  return code
}

/**
 * Buat tagihan lokal (mode tanpa server).
 * Metode pembayaran selalu QRIS ShopeePay dan nomor referensinya
 * dibuat sistem — admin hanya mencantumkannya saat membayar.
 */
export function submitPayment(
  communityId: string,
  createdBy: string,
  plan: 'monthly' | 'yearly',
): Payment {
  const db = loadDB()
  const p: Payment = {
    id: uid('pay_'),
    communityId,
    plan,
    amount: plan === 'monthly' ? PRICE_MONTHLY : PRICE_YEARLY,
    method: PAYMENT_METHOD,
    reference: paymentReference(db),
    status: 'pending',
    createdAt: Date.now(),
    verifiedAt: null,
    createdBy,
  }
  db.payments.unshift(p)
  audit(db, communityId, createdBy, 'payment.submit', `${plan} ${p.amount}`)
  saveDB(db)
  return p
}

export function verifyPayment(
  actorId: string,
  paymentId: string,
  approve: boolean,
) {
  const db = loadDB()
  const p = db.payments.find((x) => x.id === paymentId)
  if (!p) return
  p.status = approve ? 'verified' : 'rejected'
  p.verifiedAt = Date.now()
  if (approve) {
    const c = communityById(db, p.communityId)
    if (c) {
      const base = Math.max(Date.now(), c.paidUntil ?? 0)
      c.paidUntil = base + (p.plan === 'monthly' ? 30 : 365) * DAY
      c.plan = 'active'
      c.planName = p.plan
    }
  }
  audit(
    db,
    p.communityId,
    actorId,
    'payment.verify',
    approve ? 'approved' : 'rejected',
  )
  saveDB(db)
}

/* ---------------- mass notification & safety check ---------------- */

export function sendBroadcast(
  b: Omit<Broadcast, 'id' | 'createdAt' | 'responses'>,
): Broadcast {
  const db = loadDB()
  const bc: Broadcast = {
    ...b,
    id: uid('b_'),
    createdAt: Date.now(),
    responses: [],
  }
  db.broadcasts.unshift(bc)
  audit(db, b.communityId, b.authorId, `broadcast.${b.severity}`, b.title)
  saveDB(db)
  return bc
}

export function respondSafety(
  broadcastId: string,
  memberId: string,
  status: 'safe' | 'need_help',
  note = '',
) {
  const db = loadDB()
  const b = db.broadcasts.find((x) => x.id === broadcastId)
  if (!b) return
  const existing = b.responses.find((r) => r.memberId === memberId)
  if (existing) {
    existing.status = status
    existing.note = note
    existing.at = Date.now()
  } else {
    b.responses.push({ memberId, status, note, at: Date.now() })
  }
  audit(db, b.communityId, memberId, 'safety.check', status)
  saveDB(db)
}

export function deleteBroadcast(id: string) {
  const db = loadDB()
  db.broadcasts = db.broadcasts.filter((b) => b.id !== id)
  saveDB(db)
}

export function saveEmergencyProfile(memberId: string, profile: EmergencyProfile) {
  const db = loadDB()
  const m = memberById(db, memberId)
  if (!m) return
  m.emergency = profile
  saveDB(db)
}

/** Members who should be alerted first for an incident: guards then admins. */
export function responderPool(db: DBShape, communityId: string): Member[] {
  return db.members
    .filter(
      (m) =>
        m.communityId === communityId &&
        m.status === 'active' &&
        (m.role === 'satpam' || m.role === 'admin'),
    )
    .sort((a, b) => (a.role === 'satpam' ? -1 : 1) - (b.role === 'satpam' ? -1 : 1))
}

export function setCommunityPlan(
  actorId: string,
  communityId: string,
  plan: Community['plan'],
  reason = '',
) {
  const db = loadDB()
  const c = communityById(db, communityId)
  if (!c) return
  c.plan = plan
  c.suspendedReason = plan === 'suspended' ? reason : undefined
  audit(db, c.id, actorId, 'community.plan', plan)
  saveDB(db)
}

export function extendTrial(actorId: string, communityId: string, days: number) {
  const db = loadDB()
  const c = communityById(db, communityId)
  if (!c) return
  c.trialEndsAt = Math.max(Date.now(), c.trialEndsAt) + days * DAY
  if (c.plan === 'expired') c.plan = 'trial'
  audit(db, c.id, actorId, 'trial.extend', `${days} days`)
  saveDB(db)
}
