export type Lang = 'id' | 'en' | 'su'

export type Role = 'superadmin' | 'admin' | 'satpam' | 'warga'

export type MemberStatus = 'pending' | 'active' | 'rejected' | 'suspended'

export type PlanStatus = 'trial' | 'active' | 'expired' | 'suspended'

export type LatLng = { lat: number; lng: number }

export interface Community {
  id: string
  name: string
  address: string
  city: string
  createdAt: number
  createdBy: string
  /** Polygon area drawn by admin, applied to every member's app */
  area: LatLng[]
  areaUpdatedAt: number | null
  areaUpdatedBy: string | null
  center: LatLng
  language: Lang
  plan: PlanStatus
  planName: 'trial' | 'monthly' | 'yearly'
  trialEndsAt: number
  paidUntil: number | null
  suspendedReason?: string
}

export interface Member {
  id: string
  communityId: string | null
  name: string
  phone: string
  email: string
  password: string
  house: string
  role: Role
  status: MemberStatus
  language: Lang
  deviceId: string | null
  createdAt: number
  decidedAt: number | null
  decidedBy: string | null
  rejectedReason?: string
  invitedBy?: string | null
  emergency?: EmergencyProfile
}

/** 'sos' = panic button, 'incident' = normal report, 'tip' = (optionally anonymous) intel */
export type ReportKind = 'sos' | 'incident' | 'tip'
export type ReportStatus = 'open' | 'ack' | 'resolved'
export type ReportCategory =
  | 'theft'
  | 'suspicious'
  | 'fire'
  | 'medical'
  | 'accident'
  | 'flood'
  | 'fight'
  | 'drugs'
  | 'vandalism'
  | 'missing'
  | 'other'

/** Panic-button tiles, in display order (see PANIC_TYPES in lib/meta.ts). */
export type PanicType = 'theft' | 'fight' | 'medical' | 'fire' | 'flood' | 'other'

export type Severity = 'info' | 'warning' | 'critical'

export interface Attachment {
  id: string
  kind: 'photo' | 'video'
  dataUrl: string
  at: number
  bytes: number
}

/** Who an alert is delivered to. Deliberately excludes police / 911 / 112. */
export type ContactKind =
  | 'family'
  | 'friend'
  | 'responder'
  | 'guard'
  | 'volunteer'

/**
 * A person in someone's safety network. Family and friends are personal
 * (owned by one member); responders, guards and volunteers are community-wide
 * and must be verified by an admin before they receive alerts.
 */
export interface TrustedContact {
  id: string
  /** Owner for personal contacts (family/friend); null for community roles. */
  ownerId: string | null
  communityId: string
  name: string
  phone: string
  kind: ContactKind
  /** Community responders/volunteers only count once an admin verifies them. */
  verified: boolean
  /** Set when this contact is also an app member. */
  memberId: string | null
  createdAt: number
}

/** One point in the live location stream of an active alert. */
export interface LocationPing {
  lat: number
  lng: number
  at: number
  accuracy: number | null
}

/** Copy of the caller's details, frozen at the moment the alert was raised. */
export interface ProfileSnapshot {
  name: string
  phone: string
  house: string
  bloodType: string
  allergies: string
  conditions: string
  contactName: string
  contactPhone: string
  notes: string
}

/** Delivery record: who the alert went to and when. */
export interface Recipient {
  id: string
  name: string
  phone: string
  kind: ContactKind
  memberId: string | null
  deliveredAt: number
  /** Set when that person acknowledges they are on the way. */
  acknowledgedAt: number | null
}

/** One entry in an incident's two-way communication thread. */
export interface IncidentMessage {
  id: string
  from: string
  body: string
  at: number
  /** System entries (status changes) are rendered differently and are not editable. */
  system?: boolean
}

export interface Report {
  id: string
  communityId: string
  authorId: string
  kind: ReportKind
  category: ReportCategory
  note: string
  at: LatLng | null
  address: string
  status: ReportStatus
  createdAt: number
  handledBy: string | null
  handledAt: number | null
  resolvedNote?: string
  insideArea: boolean | null
  /** Tips may be submitted without revealing the author to other members. */
  anonymous?: boolean
  attachments: Attachment[]
  /** Two-way communication between the reporter and responders. */
  messages: IncidentMessage[]
  /** Who has been dispatched/acknowledged, for real-time coordination. */
  responders: string[]

  /* ---- MVP alert payload (SOS reports only) ---- */
  /** Live location stream while the alert is active. */
  track: LocationPing[]
  /** True while location is still being streamed. */
  live: boolean
  liveEndedAt: number | null
  /** 15-second voice recording captured automatically, as a data URL. */
  audio: string | null
  audioSeconds: number
  /** Caller details frozen when the alert fired. */
  snapshot: ProfileSnapshot | null
  /** Everyone the alert was delivered to. */
  recipients: Recipient[]
  /** Set when the caller cancels a false alarm. */
  cancelledAt: number | null
}

/**
 * Mass notification pushed by an admin to every member, optionally asking each
 * one to check in as safe (SaferWatch-style safety check).
 */
export interface Broadcast {
  id: string
  communityId: string
  authorId: string
  severity: Severity
  title: string
  body: string
  /** Actionable safety instruction shown prominently, e.g. "Stay indoors". */
  instruction: string
  requireSafetyCheck: boolean
  createdAt: number
  responses: SafetyResponse[]
}

export interface SafetyResponse {
  memberId: string
  status: 'safe' | 'need_help'
  note: string
  at: number
}

/** Biographical/medical detail handed to responders when a panic alert fires. */
export interface EmergencyProfile {
  bloodType: string
  allergies: string
  conditions: string
  contactName: string
  contactPhone: string
  notes: string
}

export interface PatrolPoint {
  lat: number
  lng: number
  at: number
  note: string
}

export interface Patrol {
  id: string
  communityId: string
  satpamId: string
  startedAt: number
  endedAt: number | null
  points: PatrolPoint[]
}

export interface Guest {
  id: string
  communityId: string
  name: string
  purpose: string
  host: string
  plate: string
  idCard: string
  checkIn: number
  checkOut: number | null
  recordedBy: string
}

export interface Announcement {
  id: string
  communityId: string
  authorId: string
  title: string
  body: string
  pinned: boolean
  createdAt: number
}

export interface Invite {
  id: string
  communityId: string
  code: string
  role: Exclude<Role, 'superadmin'>
  createdBy: string
  createdAt: number
  expiresAt: number
  usedBy: string | null
}

export interface TicketMessage {
  id: string
  from: string
  body: string
  at: number
}

export interface Ticket {
  id: string
  communityId: string
  openedBy: string
  subject: string
  status: 'open' | 'answered' | 'closed'
  createdAt: number
  updatedAt: number
  messages: TicketMessage[]
}

export interface Payment {
  id: string
  communityId: string
  plan: 'monthly' | 'yearly'
  amount: number
  method: string
  reference: string
  status: 'pending' | 'verified' | 'rejected'
  createdAt: number
  verifiedAt: number | null
  createdBy: string
}

export interface AuditEntry {
  id: string
  communityId: string | null
  actorId: string
  action: string
  detail: string
  at: number
}

export interface DBShape {
  version: number
  communities: Community[]
  members: Member[]
  reports: Report[]
  patrols: Patrol[]
  guests: Guest[]
  announcements: Announcement[]
  broadcasts: Broadcast[]
  contacts: TrustedContact[]
  invites: Invite[]
  tickets: Ticket[]
  payments: Payment[]
  audit: AuditEntry[]
}
