/**
 * Klien HTTP untuk API WJW.
 *
 * Semua permintaan lewat satu tempat ini agar penanganan token, error, dan
 * mode offline seragam.
 */

const TOKEN_KEY = 'wjw.token.v1'

/** Perubahan token pada tab yang sama tidak memicu event `storage`. */
export const AUTH_CHANGED_EVENT = 'wjw:auth-changed'
export const SESSION_EXPIRED_EVENT = 'wjw:session-expired'

/** Basis URL API. Kosong = origin yang sama (di-proxy Vite saat dev). */
export const API_BASE = import.meta.env.VITE_API_BASE ?? ''

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

/**
 * Simpan/hapus token lalu beri tahu AppProvider pada tab yang sama. Ini sangat
 * penting setelah login: SSE harus langsung dibuka, tidak menunggu reload
 * halaman atau polling berikutnya untuk menerima SOS.
 */
export function setToken(t: string | null) {
  const before = localStorage.getItem(TOKEN_KEY)
  if (t) localStorage.setItem(TOKEN_KEY, t)
  else localStorage.removeItem(TOKEN_KEY)
  if (before !== t && typeof window !== 'undefined')
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT))
}

/** Token 401 tidak boleh meninggalkan cache insiden terbuka di layar. */
export function expireSession() {
  setToken(null)
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
}

export class ApiError extends Error {
  /** Kode error dari server, mis. 'errEmailTaken' — cocok dengan kunci i18n. */
  code: string
  status: number
  data?: unknown

  constructor(code: string, status: number, data?: unknown) {
    super(code)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.data = data
  }
}

export interface ApiRequestOptions {
  /** Batas waktu browser-side; terutama penting untuk konfirmasi SOS. */
  timeoutMs?: number
}

const DEFAULT_API_TIMEOUT_MS = 20_000

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: ApiRequestOptions = {},
): Promise<T> {
  const token = getToken()
  const requestedTimeout = Number.isFinite(options.timeoutMs)
    ? Number(options.timeoutMs)
    : DEFAULT_API_TIMEOUT_MS
  const timeoutMs = Math.max(1_000, Math.min(Math.trunc(requestedTimeout), 60_000))
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    let res: Response
    try {
      res = await fetch(`${API_BASE}/api${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        // API mengandung data per-tenant; jangan beri browser kesempatan
        // memakai salinan HTTP lama meski proxy salah konfigurasi.
        cache: 'no-store',
        signal: controller.signal,
      })
    } catch {
      // Jaringan mati, server tidak terjangkau, atau tidak mengonfirmasi sebelum
      // batas waktu. Pemanggil SOS akan menawarkan retry idempoten.
      throw new ApiError('errOffline', 0)
    }

    // Server perantara (proxy Vite, nginx) membalas 502/503/504 ketika API
    // sedang mati. Itu sama artinya dengan "tidak terjangkau", bukan error
    // aplikasi — perlakukan seperti luring agar jalur cadangan lokal jalan.
    if (res.status === 502 || res.status === 503 || res.status === 504)
      throw new ApiError('errOffline', 0)

    let text: string
    try {
      text = await res.text()
    } catch {
      // Koneksi dapat putus setelah header diterima tetapi sebelum JSON selesai.
      throw new ApiError('errOffline', 0)
    }
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      // balasan bukan JSON (mis. halaman error HTML dari proxy)
      if (!res.ok) throw new ApiError('errOffline', 0)
    }

    if (!res.ok) {
      // Token kedaluwarsa → hapus token dan beri tahu AppProvider supaya cache
      // tenant/insiden tidak tertinggal di layar setelah akses ditolak.
      if (res.status === 401 && token) expireSession()
      throw new ApiError(
        (data as { error?: string })?.error ?? 'errUnknown',
        res.status,
        data,
      )
    }
    return data as T
  } finally {
    // Termasuk ketika parser body gagal atau request di-abort setelah header.
    window.clearTimeout(timeout)
  }
}

export const api = {
  get: <T>(p: string, options?: ApiRequestOptions) => request<T>('GET', p, undefined, options),
  post: <T>(p: string, b?: unknown, options?: ApiRequestOptions) => request<T>('POST', p, b, options),
  put: <T>(p: string, b?: unknown, options?: ApiRequestOptions) => request<T>('PUT', p, b, options),
  patch: <T>(p: string, b?: unknown, options?: ApiRequestOptions) => request<T>('PATCH', p, b, options),
  del: <T>(p: string, options?: ApiRequestOptions) => request<T>('DELETE', p, undefined, options),
}

/* ---------------- endpoint bernama ---------------- */

export interface AuthResult {
  token: string
  member: Record<string, unknown>
  firstAdmin?: boolean
}

export const authApi = {
  async register(input: Record<string, unknown>): Promise<AuthResult> {
    const r = await api.post<AuthResult>('/auth/register', input)
    setToken(r.token)
    return r
  },
  async login(identifier: string, password: string, deviceId?: string) {
    const r = await api.post<AuthResult>('/auth/login', {
      identifier,
      password,
      deviceId,
    })
    setToken(r.token)
    return r
  },
  async logout() {
    try {
      await api.post('/auth/logout')
    } catch {
      /* biarkan — token tetap dibuang di sisi klien */
    }
    setToken(null)
  },
  me: () => api.get<{ member: Record<string, unknown> }>('/me'),
}

export const stateApi = {
  fetch: () => api.get<Record<string, unknown>>('/state'),
}

export const alertApi = {
  raise: (
    category: string,
    at: { lat: number; lng: number } | null,
    accuracy?: number | null,
    idempotencyKey?: string,
  ) =>
    api.post<{ report: Record<string, unknown>; reused?: boolean }>('/alerts', {
      category,
      at,
      accuracy,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    }, { timeoutMs: 12_000 }),
  location: (id: string, lat: number, lng: number, accuracy?: number | null) =>
    api.post(`/alerts/${id}/location`, { lat, lng, accuracy }),
  /** Menerima insiden dan mencatat responder sedang menuju lokasi. */
  respond: (id: string) => api.post(`/alerts/${id}/respond`),
  // Alias untuk klien versi sebelumnya.
  ack: (id: string) => api.post(`/alerts/${id}/ack`),
  status: (id: string, status: string) => api.post(`/alerts/${id}/status`, { status }),
  close: (id: string, cancelled = false) => api.post(`/alerts/${id}/close`, { cancelled }),
  audience: () => api.get<{ audience: unknown[] }>('/alerts/audience'),
  /** Kirim pesan pada utas insiden, agar terlihat peserta lain. */
  message: (id: string, body: string) =>
    api.post<{ message: Record<string, unknown> }>(`/alerts/${id}/messages`, { body }),
  /** Lampirkan foto bukti agar terlihat penolong dan pengurus. */
  attach: (id: string, dataUrl: string) =>
    api.post<{ attachment: Record<string, unknown> }>(`/alerts/${id}/attachments`, { dataUrl, kind: 'photo' }),
}

export const patrolApi = {
  /**
   * `accuracy` wajib diteruskan: server memakainya untuk memberi
   * kelonggaran radius. Tanpa itu, satpam yang berdiri tepat di titik
   * ronda bisa ditolak hanya karena GPS-nya sedang meleset.
   */
  log: (
    lat: number,
    lng: number,
    opts: {
      checkpointId?: string
      note?: string
      force?: boolean
      accuracy?: number | null
    } = {},
  ) => api.post<{ log: Record<string, unknown> }>('/patrol/log', { lat, lng, ...opts }),
}

export const adminApi = {
  decide: (id: string, decision: 'accept' | 'reject', role?: string, reason?: string) =>
    api.post(`/members/${id}/decide`, { decision, role, reason }),
  setRole: (id: string, role: string) => api.post(`/members/${id}/role`, { role }),
  assignManagementResponsibility: (
    scope: 'map_patrol' | 'dues' | 'patrol_schedule',
    memberId: string,
    /** Diisi hanya oleh konsol superadmin saat memilih tenant. */
    communityId?: string,
  ) => api.put(`/management-responsibilities/${scope}`, { memberId, ...(communityId ? { communityId } : {}) }),
  saveArea: (area: { lat: number; lng: number }[]) => api.put('/community/area', { area }),
  /**
   * Buat kode undangan.
   *
   * Jawabannya menyertakan `expiresAt` — pemanggil harus memakainya
   * langsung, bukan mencari undangan itu di cache: cache pada render
   * yang sedang berjalan belum memuatnya.
   */
  createInvite: (role: string, days?: number, maxUses?: number | null) =>
    api.post<{
      invite: { id: string; code: string; role: string; expiresAt: number }
    }>('/invites', { role, days, maxUses }),
  revokeInvite: (id: string) => api.del(`/invites/${id}`),
  addCheckpoint: (b: { name: string; lat: number; lng: number; radiusM: number }) =>
    api.post<{ id: string }>('/checkpoints', b),
  removeCheckpoint: (id: string) => api.del(`/checkpoints/${id}`),
  addSchedule: (b: Record<string, unknown>) => api.post<{ id: string }>('/schedules', b),
  removeSchedule: (id: string) => api.del(`/schedules/${id}`),
  broadcast: (b: Record<string, unknown>) => api.post<{ id: string }>('/broadcasts', b),
}

export const publicApi = {
  searchCommunities: (q: string) =>
    api.get<{ communities: { id: string; name: string; city: string; address: string; members: number }[] }>(
      `/communities/search?q=${encodeURIComponent(q)}`,
    ),
  lookupInvite: (code: string) =>
    api.get<{
      invite: { code: string; role: string; expiresAt: number }
      community: { id: string; name: string; city: string }
    }>(`/invites/${encodeURIComponent(code)}`),
}

export type DuesInvoiceStatus = 'unpaid' | 'awaiting_verification' | 'paid' | 'overdue'

export interface DuesInvoiceDto {
  id: string
  communityId: string
  memberId: string
  period: string
  label: string
  amount: number
  dueAt: number
  status: DuesInvoiceStatus
  reference: string
  paymentNote: string
  verifierNote: string
  createdAt: number
  generatedBy: string
  claimedAt: number | null
  paidAt: number | null
  verifiedBy: string | null
  /** Hanya dikirim ke Admin 2 yang berwenang. */
  memberName?: string
  memberHouse?: string
}

export interface DuesSettingsDto {
  communityId: string
  label: string
  amount: number
  dueDay: number
  paymentInstructions: string
  updatedBy: string
  updatedAt: number
}

export interface DuesSummaryDto {
  billed: number
  paid: number
  outstanding: number
  invoices: number
  paidInvoices: number
  awaitingVerification: number
  overdue: number
}

export const duesApi = {
  fetch: () =>
    api.get<{
      settings: DuesSettingsDto | null
      summary: DuesSummaryDto
      canManage: boolean
      invoices: DuesInvoiceDto[]
      members: { id: string; name: string; house: string }[]
    }>('/dues'),
  saveSettings: (body: {
    label: string
    amount: number
    dueDay: number
    paymentInstructions: string
  }) => api.put<{ settings: DuesSettingsDto }>('/dues/settings', body),
  generate: (period: string, memberIds: string[]) =>
    api.post<{ created: number; existing: number; invoices: DuesInvoiceDto[] }>(
      '/dues/invoices/generate',
      { period, memberIds },
    ),
  claim: (id: string, paymentNote: string) =>
    api.post<{ invoice: DuesInvoiceDto }>(`/dues/${id}/claim`, { paymentNote }),
  verify: (id: string, approve: boolean, note = '') =>
    api.post<{ invoice: DuesInvoiceDto }>(`/dues/${id}/verify`, { approve, note }),
}

export interface InvoiceDto {
  id: string
  plan: 'monthly' | 'yearly'
  amount: number
  /** pending → awaiting_verification → paid */
  status: 'pending' | 'awaiting_verification' | 'paid' | 'expired'
  /** Nomor referensi tetap dari sistem, dicantumkan saat membayar. */
  reference: string
  note: string | null
  invoiceNo: string
  createdAt: number
  expiresAt: number | null
  claimedAt: number | null
  paidAt: number | null
}

export const billingApi = {
  fetch: () =>
    api.get<{
      prices: { monthly: number; yearly: number }
      qris: { name: string; phone: string; imageUrl: string; info: string }
      invoices: InvoiceDto[]
    }>('/billing'),
  /** Buat tagihan; server mengirim emailnya ke admin. */
  checkout: (plan: 'monthly' | 'yearly') =>
    api.post<{ invoice: InvoiceDto; reused?: boolean; emailSent?: boolean }>(
      '/billing/checkout',
      { plan },
    ),
  /** Admin menandai sudah membayar. Nomor referensi tidak dikirim
   *  dari klien — sudah melekat pada tagihan. */
  claim: (id: string) => api.post(`/billing/${id}/claim`),
  resend: (id: string) => api.post(`/billing/${id}/resend`),
  /** Superadmin: daftar yang menunggu verifikasi. */
  pending: () =>
    api.get<{
      invoices: (InvoiceDto & {
        communityName: string
        memberName: string
        memberEmail: string
      })[]
    }>('/billing/pending'),
  verify: (id: string, approve: boolean, note?: string) =>
    api.post(`/billing/${id}/verify`, { approve, note }),
}

/** Gambar QRIS — hanya superadmin yang boleh mengubah. */
export const qrisApi = {
  upload: (mime: string, data: string) =>
    api.post<{ ok: true; imageUrl: string }>('/qris', { mime, data }),
  clear: () => api.del('/qris'),
  owner: (name: string, phone: string) =>
    api.post<{ ok: true; name: string; phone: string }>('/qris/owner', {
      name,
      phone,
    }),
}

/** Ganti nama lingkungan — hanya admin. */
export const communityApi = {
  rename: (name: string, city?: string) =>
    api.put<{ ok: true; name: string; city: string }>('/community/name', {
      name,
      city,
    }),
}

export const profileApi = {
  save: (b: { emergency?: unknown; language?: string }) => api.put('/me/profile', b),
}

export const contactApi = {
  add: (b: { name: string; phone: string; kind: string }) =>
    api.post<{ id: string }>('/contacts', b),
  remove: (id: string) => api.del(`/contacts/${id}`),
  verify: (id: string, verified: boolean) =>
    api.post(`/contacts/${id}/verify`, { verified }),
}

export const broadcastApi = {
  respond: (id: string, status: 'safe' | 'need_help', note?: string) =>
    api.post(`/broadcasts/${id}/respond`, { status, note }),
}

/** Buku tamu tenant: identitas sensitif tidak dikembalikan ke cache browser. */
export const guestApi = {
  create: (input: { name: string; purpose?: string; host?: string; plate?: string; idCard?: string }) =>
    api.post<{ guest: { id: string; name: string; purpose: string; host: string; plate: string; checkIn: number } }>(
      '/guests',
      input,
    ),
  checkout: (id: string) => api.post<{ ok: true; checkOut: number }>(`/guests/${id}/checkout`),
}

/* ---------------- Phase 3–5: Community OS ---------------- */

export interface HouseholdMemberDto {
  id: string
  name: string
  relationship: string
  birthDate: string | null
  ageGroup: 'adult' | 'child' | 'unknown'
  role: string
  status: string
}

export interface HouseholdDto {
  id: string
  address: string
  rt: string
  rw: string
  block: string
  headMemberId: string
  headName: string
  members: HouseholdMemberDto[]
}

export interface PopulationDto {
  households: HouseholdDto[]
  summary: {
    households: number
    residents: number
    adults: number
    children: number
    ageUnknown: number
    pending: number
  }
  canManage: boolean
}

export const populationApi = {
  fetch: () => api.get<PopulationDto>('/population'),
  setHead: (householdId: string, memberId: string) =>
    api.put<{ household: HouseholdDto }>(`/population/households/${householdId}/head`, { memberId }),
  setAudience: (householdId: string, input: { rt: string; rw: string; block: string }) =>
    api.put(`/population/households/${householdId}/audience`, input),
  updateMember: (memberId: string, input: { relationship?: string; birthDate?: string | null }) =>
    api.put(`/population/members/${memberId}`, input),
}

export type HubKind =
  | 'finance'
  | 'letter'
  | 'complaint'
  | 'poll'
  | 'deliberation'
  | 'campaign'
  | 'donation'
  | 'arisan'
  | 'bereavement'

export interface HubItemDto {
  id: string
  communityId: string
  kind: HubKind
  title: string
  body: string
  status: string
  visibility: 'community' | 'private'
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
  myAction: { action: string; value: string } | null
  participants: { memberId: string; name: string; action: string; value: string }[]
  comments: { id: string; memberId: string; name: string; body: string; createdAt: number }[]
  winnerName?: string
}

export interface HubOverviewDto {
  items: HubItemDto[]
  residents: { id: string; name: string; house: string; role: string; status: string; createdAt: number }[]
  residentSummary: { total: number; active: number; pending: number; households: number }
  permissions: {
    canManageCommunity: boolean
    canManageFinance: boolean
    canConfigureBranding: boolean
  }
}

export interface BrandingDto {
  brandName: string
  accentColor: string
  logoUrl: string
  customDomain: string
  domainStatus: 'none' | 'pending_dns' | 'dns_verified'
  whiteLabelRequested: boolean
  verificationName?: string
  verificationValue?: string
}

export const hubApi = {
  overview: () => api.get<HubOverviewDto>('/hub'),
  create: (input: { kind: HubKind; title: string; body?: string; metadata?: Record<string, unknown> }) =>
    api.post<{ item: HubItemDto }>('/hub/items', input),
  status: (id: string, status: string, note?: string) =>
    api.patch<{ item: HubItemDto }>(`/hub/items/${id}`, { status, ...(note ? { note } : {}) }),
  action: (id: string, action: string, value?: unknown) =>
    api.post<{ item: HubItemDto }>(`/hub/items/${id}/actions`, { action, value }),
  comment: (id: string, body: string) => api.post<{ item: HubItemDto }>(`/hub/items/${id}/comments`, { body }),
  decideLetter: (id: string, input: { approve: boolean; note?: string; signerName?: string; signerTitle?: string }) =>
    api.post<{ item: HubItemDto }>(`/hub/letters/${id}/decision`, input),
  drawArisan: (id: string) => api.post<{ item: HubItemDto }>(`/hub/items/${id}/draw`),
  branding: () => api.get<{ branding: BrandingDto }>('/hub/branding'),
  saveBranding: (input: Partial<Pick<BrandingDto, 'brandName' | 'accentColor' | 'logoUrl' | 'customDomain' | 'whiteLabelRequested'>>) =>
    api.put<{ branding: BrandingDto }>('/hub/branding', input),
  verifyBrandingDomain: () => api.post<{ branding: BrandingDto; verified: boolean }>('/hub/branding/verify-domain'),
  async downloadLetter(id: string): Promise<Blob> {
    const token = getToken()
    let response: Response
    try {
      response = await fetch(`${API_BASE}/api/hub/letters/${encodeURIComponent(id)}/pdf`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: 'no-store',
      })
    } catch {
      throw new ApiError('errOffline', 0)
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string }
      throw new ApiError(body.error ?? 'letter_pdf_unavailable', response.status)
    }
    return response.blob()
  },
}

export type AnnouncementTargetDto = 'all' | 'rw' | 'rt' | 'block'
export const announcementApi = {
  create: (input: {
    title: string
    body: string
    category: string
    targetScope: AnnouncementTargetDto
    targetValue?: string
    pinned?: boolean
  }) => api.post('/announcements', input),
  remove: (id: string) => api.del(`/announcements/${id}`),
}

export const assistantApi = {
  ask: (question: string) => api.post<{
    answer: string
    mode: 'tenant_data'
    source: string
    historyId: string
    suggestions: { label: string; path: string }[]
  }>('/assistant', { question }),
  history: (limit = 30) => api.get<{
    entries: { id: string; question: string; answer: string; source: string; createdAt: number }[]
  }>(`/assistant/history?limit=${Math.max(1, Math.min(100, limit))}`),
}

export interface TenantDto {
  id: string
  name: string
  address: string
  city: string
  subdomain: string
  subscriptionTier: 'FREE' | 'COMMUNITY' | 'PROFESSIONAL' | 'ENTERPRISE'
  subscriptionStatus: 'trial' | 'active' | 'suspended' | 'expired'
  effectiveSubscriptionStatus: 'trial' | 'active' | 'suspended' | 'expired'
  trialEndsAt: number
  paidUntil: number | null
  residents: number
}

export const superadminApi = {
  overview: () => api.get<{
    metrics: {
      tenants: number
      residents: number
      revenue: number
      pendingVerifications: number
      active: number
      trial: number
      suspended: number
      expired: number
    }
    tenants: TenantDto[]
  }>('/superadmin/overview'),
  createTenant: (input: {
    name: string
    address: string
    city: string
    subdomain: string
    tier: TenantDto['subscriptionTier']
    adminName: string
    adminPhone: string
    adminEmail: string
    adminPassword: string
    adminHouse: string
  }) => api.post<{ tenant: TenantDto; admin: { id: string; name: string; email: string } }>('/superadmin/tenants', input),
  setSubscription: (id: string, input: {
    status?: 'suspended' | 'active'
    tier?: TenantDto['subscriptionTier']
    reason?: string
    extendTrialDays?: number
  }) => api.put<{ tenant: TenantDto }>(`/superadmin/tenants/${id}/subscription`, input),
}
