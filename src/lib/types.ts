export type Lang = 'id' | 'en' | 'su'

export type Role = 'superadmin' | 'admin' | 'satpam' | 'warga'

export type MemberStatus = 'pending' | 'active' | 'rejected' | 'suspended'

export type PlanStatus = 'trial' | 'active' | 'expired' | 'suspended'

/** Mandat admin operasional; terpisah dari role admin umum di tenant. */
export type ManagementScope = 'map_patrol' | 'dues' | 'patrol_schedule'

export interface ManagementResponsibility {
  communityId: string
  scope: ManagementScope
  memberId: string
  assignedBy: string | null
  assignedAt: number
  defaulted: boolean
}

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
  /** Paket SaaS WJW, terpisah dari periode invoice serta iuran warga. */
  subscriptionTier?: 'FREE' | 'COMMUNITY' | 'PROFESSIONAL' | 'ENTERPRISE'
  subscriptionStatus?: PlanStatus
  /** Slug wildcard tenant, mis. rw05 pada rw05.wjw.example.id. */
  subdomain?: string
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
  /** Stempel waktu terakhir aplikasi ini menyebut server (khusus admin utk satpam). */
  lastSeenAt?: number | null
  emergency?: EmergencyProfile
  /** How this member asked to join, shown to the admin reviewing them. */
  joinMethod?: JoinMethod
  /** Invite code used, if any. */
  joinCode?: string | null
  /** Free-text note the applicant wrote when requesting to join. */
  joinNote?: string
}

/** 'sos' = panic button, 'incident' = normal report, 'tip' = (optionally anonymous) intel */
export type ReportKind = 'sos' | 'incident' | 'tip'
export type ReportStatus = 'open' | 'ack' | 'resolved'

/** State machine kanonis insiden darurat. CANCELLED khusus alarm palsu. */
export type IncidentStatus =
  | 'NEW'
  | 'ACKNOWLEDGED'
  | 'RESPONDING'
  | 'ON_SITE'
  | 'RESOLVED'
  | 'CLOSED'
  | 'CANCELLED'

export interface IncidentTimelineEntry {
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
  /** Waktu server menetapkan penerima; bukan bukti push sampai ke perangkat. */
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
  /** Lifecycle server-side yang immutable-audited untuk laporan SOS. */
  incidentStatus?: IncidentStatus
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
  /** Append-only server timeline. May be withheld for non-participants. */
  timeline?: IncidentTimelineEntry[]
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

/** Titik ronda yang ditentukan admin di peta. */
export interface Checkpoint {
  id: string
  communityId: string
  name: string
  lat: number
  lng: number
  /** Radius toleransi (meter) — satpam harus berada di dalamnya. */
  radiusM: number
  order: number
  createdBy: string
  createdAt: number
  active: boolean
}

/** Jadwal ronda, mis. "Ronda Malam 22:00-23:00". */
export interface PatrolSchedule {
  id: string
  communityId: string
  label: string
  /** Menit sejak tengah malam (22:00 = 1320). */
  startMinute: number
  endMinute: number
  /** Hari aktif 0=Minggu..6=Sabtu; kosong = setiap hari. */
  days: number[]
  /** Kosong = seluruh tim; bila terisi, hanya satpam ini yang mendapat jadwal. */
  assignedSatpamIds: string[]
  /** Toleransi keterlambatan (menit) sebelum ditandai "terlambat". */
  graceMin: number
  active: boolean
  createdAt: number
}

export type PatrolLogStatus = 'ontime' | 'late' | 'offschedule'

/** Satu rekaman "saya sudah ronda di titik ini" (satu tombol). */
export interface PatrolLog {
  id: string
  communityId: string
  satpamId: string
  checkpointId: string
  checkpointName: string
  scheduleId: string | null
  scheduleLabel: string
  at: number
  lat: number
  lng: number
  /** Jarak satpam ke titik ronda saat merekam (meter). */
  distanceM: number
  insideRadius: boolean
  status: PatrolLogStatus
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
  /** Hanya dipakai saat input lokal lama; tidak pernah disinkronkan ke cache browser. */
  idCard?: string
  checkIn: number
  checkOut: number | null
  recordedBy: string
}

export type AnnouncementTarget = 'all' | 'rw' | 'rt' | 'block'

export interface Announcement {
  id: string
  communityId: string
  authorId: string
  title: string
  body: string
  /** Keamanan, Keuangan, Kegiatan, Umum, dll. */
  category: string
  /** Audiens dihitung server dari data KK RT/RW/blok. */
  targetScope: AnnouncementTarget
  targetValue: string
  pinned: boolean
  createdAt: number
}

export interface Invite {
  id: string
  communityId: string
  code: string
  /** Role proposed by the invite; the approving admin can still change it. */
  role: Exclude<Role, 'superadmin'>
  createdBy: string
  createdAt: number
  expiresAt: number
  /** Every member who joined with this code (invites are reusable until revoked). */
  usedBy: string[]
  /** Optional cap on how many people may use the code. */
  maxUses: number | null
  revokedAt: number | null
}

/** How a member came to be in the approval queue. */
export type JoinMethod = 'invite' | 'search' | 'founder'

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
  /**
   * Satu-satunya metode pembayaran: QRIS ShopeePay.
   *
   * Dulu ini teks bebas ('Transfer Bank BCA', 'GoPay', 'OVO', …) yang
   * dipilih admin dari daftar. Daftar itu sudah dihapus, tetapi datanya
   * masih tersimpan di perangkat, jadi nilainya dinormalkan saat dibaca
   * agar riwayat lama tidak lagi menyebut metode yang tidak berlaku.
   */
  method: 'QRIS ShopeePay'
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
  managementResponsibilities: ManagementResponsibility[]
  /** Snapshot izin assignment dari server; UI hanya menggunakannya sebagai petunjuk. */
  canAssignManagementResponsibilities: boolean
  checkpoints: Checkpoint[]
  schedules: PatrolSchedule[]
  patrolLogs: PatrolLog[]
  invites: Invite[]
  tickets: Ticket[]
  payments: Payment[]
  audit: AuditEntry[]
}
