import type {
  Announcement,
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
  Report,
  Role,
  Ticket,
} from './types'

export const SUPERADMIN_EMAIL = 'tarafk1972@gmail.com'
export const TRIAL_DAYS = 14
export const DAY = 24 * 60 * 60 * 1000

export const PRICE_MONTHLY = 149000
export const PRICE_YEARLY = 1490000

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
  ensureSuperadmin(cache)
  return cache
}

export function saveDB(db: DBShape) {
  cache = db
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
  window.dispatchEvent(new CustomEvent('wjw:db'))
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
  inviteCode?: string
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
    const now = Date.now()
    community = {
      id: uid('c_'),
      name: (input.communityName || '').trim(),
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

    const code = (input.inviteCode || '').trim().toUpperCase()
    if (code) {
      invite =
        db.invites.find(
          (i) =>
            i.code === code &&
            i.communityId === community!.id &&
            !i.usedBy &&
            i.expiresAt > Date.now(),
        ) ?? null
      if (!invite) return { ok: false, error: 'errInvite' }
      // Invited members skip the queue with the role written on the invite.
      role = invite.role
      status = 'active'
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
    decidedBy: status === 'active' ? (invite ? invite.createdBy : null) : null,
    invitedBy: invite ? invite.createdBy : null,
  }
  db.members.push(member)

  if (firstAdmin) community.createdBy = member.id
  if (invite) invite.usedBy = member.id

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
  m.deviceId = deviceId()
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
): Invite {
  const db = loadDB()
  const code = Math.random().toString(36).slice(2, 8).toUpperCase()
  const inv: Invite = {
    id: uid('i_'),
    communityId,
    code,
    role,
    createdBy: actorId,
    createdAt: Date.now(),
    expiresAt: Date.now() + 7 * DAY,
    usedBy: null,
  }
  db.invites.unshift(inv)
  audit(db, communityId, actorId, 'invite.create', `${role} · ${code}`)
  saveDB(db)
  return inv
}

export function addReport(
  r: Omit<
    Report,
    | 'id'
    | 'createdAt'
    | 'status'
    | 'handledBy'
    | 'handledAt'
    | 'insideArea'
    | 'attachments'
    | 'messages'
    | 'responders'
  > &
    Partial<Pick<Report, 'attachments' | 'messages' | 'responders'>>,
): Report {
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

export function addAttachment(reportId: string, dataUrl: string) {
  const db = loadDB()
  const r = db.reports.find((x) => x.id === reportId)
  if (!r) return
  const a: Attachment = { id: uid('at_'), kind: 'photo', dataUrl, at: Date.now() }
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

export function submitPayment(
  communityId: string,
  createdBy: string,
  plan: 'monthly' | 'yearly',
  method: string,
  reference: string,
): Payment {
  const db = loadDB()
  const p: Payment = {
    id: uid('pay_'),
    communityId,
    plan,
    amount: plan === 'monthly' ? PRICE_MONTHLY : PRICE_YEARLY,
    method,
    reference,
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
