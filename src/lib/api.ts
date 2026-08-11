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
  raise: (category: string, at: { lat: number; lng: number } | null, accuracy?: number | null) =>
    api.post<{ report: Record<string, unknown> }>('/alerts', { category, at, accuracy }),
  location: (id: string, lat: number, lng: number, accuracy?: number | null) =>
    api.post(`/alerts/${id}/location`, { lat, lng, accuracy }),
  ack: (id: string) => api.post(`/alerts/${id}/ack`),
  close: (id: string, cancelled = false) => api.post(`/alerts/${id}/close`, { cancelled }),
  audience: () => api.get<{ audience: unknown[] }>('/alerts/audience'),
}

export const patrolApi = {
  log: (lat: number, lng: number, opts: { checkpointId?: string; note?: string; force?: boolean } = {}) =>
    api.post<{ log: Record<string, unknown> }>('/patrol/log', { lat, lng, ...opts }),
}

export const adminApi = {
  decide: (id: string, decision: 'accept' | 'reject', role?: string, reason?: string) =>
    api.post(`/members/${id}/decide`, { decision, role, reason }),
  setRole: (id: string, role: string) => api.post(`/members/${id}/role`, { role }),
  saveArea: (area: { lat: number; lng: number }[]) => api.put('/community/area', { area }),
  createInvite: (role: string, days?: number, maxUses?: number | null) =>
    api.post<{ invite: { id: string; code: string } }>('/invites', { role, days, maxUses }),
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

export interface InvoiceDto {
  id: string
  plan: 'monthly' | 'yearly'
  amount: number
  /** pending → awaiting_verification → paid */
  status: 'pending' | 'awaiting_verification' | 'paid' | 'expired'
  reference: string | null
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
      bankInfo: string
      invoices: InvoiceDto[]
    }>('/billing'),
  /** Buat tagihan; server mengirim emailnya ke admin. */
  checkout: (plan: 'monthly' | 'yearly') =>
    api.post<{ invoice: InvoiceDto; reused?: boolean; emailSent?: boolean }>(
      '/billing/checkout',
      { plan },
    ),
  /** Admin menandai sudah transfer. */
  claim: (id: string, reference: string) =>
    api.post(`/billing/${id}/claim`, { reference }),
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
