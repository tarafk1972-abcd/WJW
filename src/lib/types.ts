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
}

export type ReportKind = 'sos' | 'incident'
export type ReportStatus = 'open' | 'ack' | 'resolved'
export type ReportCategory =
  | 'theft'
  | 'suspicious'
  | 'fire'
  | 'medical'
  | 'accident'
  | 'flood'
  | 'fight'
  | 'other'

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
  invites: Invite[]
  tickets: Ticket[]
  payments: Payment[]
  audit: AuditEntry[]
}
