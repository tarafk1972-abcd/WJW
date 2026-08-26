/**
 * Klien HTTP untuk API WJW.
 *
 * Semua permintaan lewat satu tempat ini agar penanganan token, error, dan
 * mode offline seragam.
 */

const TOKEN_KEY = 'wjw.token.v1'

/** Basis URL API. Kosong = origin yang sama (di-proxy Vite saat dev). */
export const API_BASE = import.meta.env.VITE_API_BASE ?? ''

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(t: string | null) {
  if (t) localStorage.setItem(TOKEN_KEY, t)
  else localStorage.removeItem(TOKEN_KEY)
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

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = getToken()
  let res: Response
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    // jaringan mati / server tidak terjangkau
    throw new ApiError('errOffline', 0)
  }

  // Server perantara (proxy Vite, nginx) membalas 502/503/504 ketika API
  // sedang mati. Itu sama artinya dengan "tidak terjangkau", bukan error
  // aplikasi — perlakukan seperti luring agar jalur cadangan lokal jalan.
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    throw new ApiError('errOffline', 0)
  }

  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    // balasan bukan JSON (mis. halaman error HTML dari proxy)
    if (!res.ok) throw new ApiError('errOffline', 0)
  }

  if (!res.ok) {
    // token kedaluwarsa → paksa login ulang
    if (res.status === 401 && token) setToken(null)
    throw new ApiError(
      (data as { error?: string })?.error ?? 'errUnknown',
      res.status,
      data,
    )
  }
  return data as T
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b),
  put: <T>(p: string, b?: unknown) => request<T>('PUT', p, b),
  del: <T>(p: string) => request<T>('DELETE', p),
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
    }),
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
