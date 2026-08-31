import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import type { Context, Next } from 'hono'
import { z } from 'zod'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import {
  DAY,
  TRIAL_DAYS,
  audit,
  createSession,
  db,
  destroySession,
  ensureSuperadmin,
  fixUnnamedCommunities,
  hashPassword,
  memberFromToken,
  now,
  publicMember,
  purgeSessions,
  uid,
  verifyPassword,
  visibleMember,
  type MemberRow,
} from './db.js'
import { decryptSensitiveJson, encryptSensitiveJson } from './crypto.js'
import { publishCommunityEvent, subscribeCommunity, type RealtimeEvent } from './events.js'
import {
  assignManagementResponsibility,
  canAssignManagementResponsibilities,
  canManageScope,
  isManagementScope,
  listManagementResponsibilities,
} from './community-ops.js'
import {
  claimDuesInvoice,
  duesSummary,
  generateSpecialInvoices,
  listDuesHouseAmounts,
  markDuesInvoicePaidCash,
  setDuesHouseAmount,
  startDuesScheduler,
  restoreDuesInvoice,
  waiveDuesInvoice,
  generateDuesInvoices,
  getDuesInvoice,
  getDuesSettings,
  listDuesInvoices,
  saveDuesSettings,
  verifyDuesInvoice,
} from './dues.js'
import {
  HUB_KINDS,
  HubError,
  actOnHubItem,
  addHubComment,
  approvedLetterPdfData,
  communityHubOverview,
  createHubItem,
  decideLetter,
  drawArisan,
  getCommunityBranding,
  hubAnalytics,
  saveCommunityBranding,
  refreshExpiredHubItems,
  setHubItemStatus,
  verifyCommunityDomain,
} from './community-hub.js'
import { answerAssistant, assistantHistory } from './assistant.js'
import {
  PopulationError,
  ensureHouseholdForMember,
  ensurePopulationHouseholds,
  listBillableHouseholdHeads,
  memberMatchesAudience,
  populationOverview,
  setHouseholdHead,
  updateHouseholdArea,
  updatePopulationMember,
} from './population.js'
import { createLetterPdf } from './letter-pdf.js'
import {
  addIncidentTimeline,
  initialIncidentStatus,
  isIncidentStatus,
  timelineByIncident,
  timelineForIncident,
  transitionIncident,
  type IncidentStatus,
  type TimelineEntry,
} from './incidents.js'
import {
  FRESH_MS,
  nearbyMembers,
  type NearbyRow,
} from './nearby.js'
import {
  activeSchedule,
  distanceMeters,
  normalizeCode,
  pointInPolygon,
  type LatLng,
} from './geo.js'
import { BATAS, alamatKlien, hitRateLimit } from './ratelimit.js'
import {
  PAYMENT_INFO,
  PRICE_MONTHLY,
  QRIS_IMAGE_URL,
  QRIS_NAME,
  QRIS_PHONE,
  PRICE_YEARLY,
  claimPayment,
  createInvoice,
  getInvoice,
  invoiceNumber,
  openInvoiceOf,
  pendingVerifications,
  rejectPayment,
  verifyPayment,
} from './billing.js'
import { billEmail, paidEmail } from './email-templates.js'
import {
  QRIS_MAX_BYTES,
  QRIS_MIME,
  clearQrisImage,
  getQrisImage,
  qrisImagePath,
  qrisName,
  qrisPhone,
  setQrisImage,
  setQrisOwner,
} from './settings.js'
import { mailEnabled, sendMail, verifyMail } from './mailer.js'
import { runRenewalCheck, startRenewalScheduler } from './renewals.js'
import {
  pushEnabled,
  pushToMembers,
  removeSubscription,
  saveSubscription,
  vapidPublicKey,
} from './push.js'

ensureSuperadmin()
fixUnnamedCommunities()
// Migrasi idempoten: komunitas lama langsung mendapatkan struktur KK tanpa
// meminta warga memasukkan ulang data saat aplikasi diperbarui.
ensurePopulationHouseholds()
setInterval(purgeSessions, 6 * 60 * 60 * 1000).unref?.()
// Penutupan polling/tenggat tidak bergantung pada layar admin sedang terbuka.
setInterval(() => {
  const communities = db.prepare('SELECT id FROM communities').all() as { id: string }[]
  for (const community of communities) {
    for (const itemId of refreshExpiredHubItems(community.id))
      publishCommunityEvent(community.id, 'community.hub.updated', itemId)
  }
}, 60_000).unref?.()

/**
 * Kelonggaran maksimum untuk ketidakpastian GPS saat menandai ronda.
 *
 * Cukup untuk menutupi fix buruk di antara bangunan, tetapi tidak
 * selebar itu sehingga titik ronda bisa ditandai dari luar pagar.
 */
const GPS_SLACK_MAX_M = 35

/**
 * Batas satu lampiran (byte) dan jumlah lampiran per peringatan.
 *
 * Klien sudah mengecilkan gambar ke sisi terpanjang 720 px, yang biasanya
 * jauh di bawah batas ini. Batas tetap ditegakkan di server karena klien
 * bisa diubah siapa saja, dan satu berkas besar cukup untuk membuat
 * seluruh peringatan gagal dimuat di ponsel lain.
 */
const ATTACH_MAX_BYTES = 600_000
const ATTACH_MAX_COUNT = 12

type Env = { Variables: { me: MemberRow } }
const app = new Hono<Env>()

// `process.cwd()` adalah root proyek pada npm local maupun WORKDIR /app di
// image Fly. Hindari import.meta.url karena Vite mengubah URL modul menjadi
// http:// saat tes UI mengimpor app.fetch().
const ROOT = resolve(process.env.WJW_ROOT ?? process.cwd())
const STATIC_ROOT = resolve(process.env.WJW_WEB_ROOT ?? join(ROOT, 'dist'))

/*
 * API produksi berjalan satu origin dengan PWA, jadi CORS tidak diperlukan.
 * Bila operator sengaja memisahkan web dan API — atau APK Capacitor memanggil
 * API Fly dari https://localhost — origin eksplisit dapat diisi lewat
 * WJW_CORS_ORIGINS (dipisah koma). Jangan pernah memantulkan origin sembarang
 * pada endpoint yang menerima Bearer token.
 */
const corsOrigins = (process.env.WJW_CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
if (corsOrigins.length > 0) {
  app.use('/api/*', cors({ origin: corsOrigins, credentials: false }))
}

// Semua API menerima JSON kecil, kecuali bukti foto (maks. 600 KB) dan QRIS
// superadmin (maks. 1 MB sebelum base64). Batas 2 MiB ini memberi ruang untuk
// encoding JSON, tetapi menghentikan request chunked/content-length palsu
// sebelum parser JSON menghabiskan memori proses tunggal untuk tenant lain.
const MAX_API_BODY_BYTES = 2 * 1024 * 1024
app.use(
  '/api/*',
  bodyLimit({
    maxSize: MAX_API_BODY_BYTES,
    onError: (c) => c.json({ error: 'payload_too_large' }, 413),
  }),
)

/*
 * Header browser-level untuk mengurangi dampak XSS, MIME sniffing dan iframe.
 * Arena menampilkan preview dalam iframe lintas-origin. Mode itu harus
 * diaktifkan eksplisit hanya pada proses sandbox agar deployment publik tetap
 * anti-clickjacking secara default.
 */
const allowEmbeddedPreview = process.env.WJW_ALLOW_EMBEDDED_PREVIEW === '1'
app.use('*', async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  // OSM meminta Referer yang valid untuk tile web. Mode strict ini hanya
  // mengirim origin (bukan path/query) ke domain lain, jadi tetap menjaga
  // privasi URL sambil mematuhi kebijakan tile OpenStreetMap.
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  if (!allowEmbeddedPreview) c.header('X-Frame-Options', 'DENY')
  c.header('Permissions-Policy', 'geolocation=(self), microphone=(self), camera=(self)')
  // /api/state dapat berisi koordinasi SOS, daftar tamu, atau riwayat privat.
  // Jangan biarkan browser/proxy menyimpan respons Bearer ini di disk. Endpoint
  // yang punya aturan cache khusus (SSE, PDF) mempertahankan headernya sendiri.
  if (c.req.path.startsWith('/api/') && !c.res.headers.get('Cache-Control'))
    c.header('Cache-Control', 'private, no-store')
  c.header(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'self'; " +
      (allowEmbeddedPreview ? '' : "frame-ancestors 'none'; ") +
      "form-action 'self'; img-src 'self' data: blob: https://*.tile.openstreetmap.org; " +
      "media-src 'self' data: blob:; connect-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self'; worker-src 'self' blob:",
  )
})

/* ---------------- util ---------------- */

const J = (s: string) => JSON.parse(s || 'null')

/**
 * JSON insiden SOS disimpan AES-GCM di produksi. Data versi lama tanpa prefix
 * tetap dibaca oleh decryptSensitiveJson agar migrasi tidak memutus insiden
 * historis; record korup justru dikosongkan (fail closed), bukan dilempar ke
 * seluruh respons /api/state.
 */
function secureArray<T>(stored: unknown): T[] {
  if (typeof stored !== 'string' || !stored) return []
  try {
    const value = decryptSensitiveJson<unknown>(stored)
    return Array.isArray(value) ? (value as T[]) : []
  } catch {
    return []
  }
}

function secureObject(stored: unknown): Record<string, unknown> | null {
  if (typeof stored !== 'string' || !stored) return null
  try {
    const value = decryptSensitiveJson<unknown>(stored)
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** Audio legacy berupa data URL (bukan JSON); bungkus saat migrasi baru. */
function secureAudio(stored: unknown): string | null {
  if (typeof stored !== 'string' || !stored) return null
  // Kompatibilitas rows lama sebelum migrasi: jangan mencoba JSON.parse atas
  // data URL. Saat kunci tersedia, db.ts akan membungkusnya saat boot.
  if (!stored.startsWith('enc:v1:')) return stored
  try {
    const value = decryptSensitiveJson<unknown>(stored)
    return typeof value === 'string' ? value : null
  } catch {
    return null
  }
}

function bearer(c: Context): string | null {
  const h = c.req.header('Authorization') ?? ''
  return h.startsWith('Bearer ') ? h.slice(7) : null
}

type TenantHost = { id: string; name: string; subdomain: string } | null | undefined

/**
 * Tenant subdomain is opt-in through WJW_BASE_DOMAIN (for example
 * `wjw.example.id`). The Fly preview/default hostname continues to work as
 * the apex while operators configure wildcard DNS. We use the actual request
 * URL/Host, not a client-supplied tenant header.
 *
 * undefined: no tenant subdomain in this deployment/request
 * null: host claims a tenant subdomain but no tenant owns it
 */
function tenantHost(c: Context): TenantHost {
  const base = (process.env.WJW_BASE_DOMAIN ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, '')
  if (!base) return undefined
  let host = ''
  try {
    host = new URL(c.req.url).hostname.toLowerCase()
  } catch {
    return undefined
  }
  if (host === base || !host.endsWith(`.${base}`)) return undefined
  const subdomain = host.slice(0, -(base.length + 1))
  // One label only: `rw05.wjw.example.id`, never an arbitrary nested host.
  if (!/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(subdomain)) return null
  return (db
    .prepare('SELECT id,name,subdomain FROM communities WHERE lower(subdomain)=?')
    .get(subdomain) as { id: string; name: string; subdomain: string } | undefined) ?? null
}

/** Wajib login dan—bila memakai subdomain—harus milik tenant host tersebut. */
async function auth(c: Context<Env>, next: Next) {
  const me = memberFromToken(bearer(c))
  if (!me) return c.json({ error: 'unauthorized' }, 401)
  const tenant = tenantHost(c)
  if (tenant === null) return c.json({ error: 'tenant_not_found' }, 404)
  // Konsol superadmin hanya di apex. Dengan demikian token operasional tidak
  // bisa dipakai pada subdomain warga untuk melompati batas tenant.
  if (tenant && (me.role === 'superadmin' || me.community_id !== tenant.id))
    return c.json({ error: 'tenant_forbidden' }, 403)
  if (me.role !== 'superadmin' && me.community_id && c.req.path !== '/api/auth/logout') {
    const subscription = db
      .prepare('SELECT plan,subscription_status FROM communities WHERE id=?')
      .get(me.community_id) as { plan: string; subscription_status?: string } | undefined
    if (subscription?.plan === 'suspended' || subscription?.subscription_status === 'suspended')
      return c.json({ error: 'tenant_suspended' }, 403)
  }
  c.set('me', me)
  await next()
}

/** Wajib login DAN sudah disetujui admin. */
async function active(c: Context<Env>, next: Next) {
  const me = c.get('me')
  if (me.status !== 'active') return c.json({ error: 'not_active' }, 403)
  // Superadmin tetap dapat mengelola tenant yang disuspensi dari konsol;
  // akun tenant sendiri tidak dapat mengakses data/operasi selama suspend.
  if (me.role !== 'superadmin' && me.community_id) {
    const community = db
      .prepare('SELECT plan,subscription_status FROM communities WHERE id=?')
      .get(me.community_id) as { plan: string; subscription_status?: string } | undefined
    if (community?.plan === 'suspended' || community?.subscription_status === 'suspended')
      return c.json({ error: 'tenant_suspended' }, 403)
  }
  await next()
}

function requireAdmin(c: Context<Env>) {
  const me = c.get('me')
  return me.role === 'admin' || me.role === 'superadmin'
}

/** Pastikan sumber daya milik lingkungan pemanggil. */
function sameCommunity(me: MemberRow, communityId: string | null): boolean {
  if (me.role === 'superadmin') return true
  return !!communityId && me.community_id === communityId
}

const bad = (c: Context, msg: string, code = 400) =>
  c.json({ error: msg }, code as 400)

/* ---------------- mapper baris → JSON ---------------- */

function mapCommunity(r: Record<string, unknown>) {
  return {
    id: r.id,
    name: r.name,
    address: r.address,
    city: r.city,
    createdAt: r.created_at,
    createdBy: r.created_by,
    area: J(r.area as string) ?? [],
    areaUpdatedAt: r.area_updated_at,
    areaUpdatedBy: r.area_updated_by,
    center: J(r.center as string),
    language: r.language,
    // Tetap kompatibel dengan UI lama yang membaca `plan`, sambil menyediakan
    // status SaaS eksplisit. Suspensi tidak menimpa periode tagihan asli.
    plan: r.subscription_status === 'suspended' ? 'suspended' : r.plan,
    planName: r.plan_name,
    subscriptionTier: r.subscription_tier ?? 'FREE',
    subscriptionStatus: subscriptionStatus(r),
    subdomain: r.subdomain ?? '',
    trialEndsAt: r.trial_ends_at,
    paidUntil: r.paid_until,
    suspendedReason: r.suspended_reason ?? undefined,
  }
}

/**
 * Cek apakah viewer boleh melihat detail insiden SOS.
 *
 * Semua anggota boleh tahu ada darurat aktif, tetapi lokasi presisi, profil
 * medis, media, chat, dan daftar penerima hanya untuk pelapor serta orang
 * yang benar-benar diberi wewenang menangani insiden. Ini penting karena
 * /api/state dibaca ulang oleh banyak layar sekaligus.
 */
function canViewIncidentDetails(me: MemberRow | undefined, r: Record<string, unknown>): boolean {
  if (!me || r.kind !== 'sos') return false
  if (r.author_id === me.id) return true
  // Daftar penerima dibekukan ketika SOS dikirim. Jadi petugas yang baru
  // ditambahkan kemudian tidak otomatis bisa membuka lokasi, bukti, atau
  // profil medis insiden lama hanya karena perannya admin/satpam.
  const recipients = secureArray<{ memberId?: string | null }>(r.recipients)
  return recipients.some((recipient) => recipient.memberId === me.id)
}

/**
 * Laporan anonimus non-SOS adalah kanal terbatas: hanya pelapor dan admin
 * tenant yang boleh membacanya. Satpam dan warga lain tidak menerima record
 * sama sekali — termasuk foto/catatan yang dapat mengungkap identitas lewat
 * konteks. Ini sengaja tidak berlaku pada SOS karena keselamatan tidak boleh
 * disembunyikan oleh mode anonimus.
 */
function canReadReport(me: MemberRow, r: Record<string, unknown>): boolean {
  if (r.kind === 'sos' || !r.anonymous) return true
  return r.author_id === me.id || me.role === 'admin'
}

function canRevealAnonymousReportAuthor(viewer: MemberRow | undefined, r: Record<string, unknown>) {
  return !r.anonymous || r.kind === 'sos' || !!viewer && (r.author_id === viewer.id || viewer.role === 'admin')
}

function mapReport(
  r: Record<string, unknown>,
  viewer?: MemberRow,
  timeline: TimelineEntry[] = [],
) {
  const isSos = r.kind === 'sos'
  const canSeeDetails = canViewIncidentDetails(viewer, r)
  const revealAuthor = canRevealAnonymousReportAuthor(viewer, r)
  const incidentStatus = isIncidentStatus(r.incident_status)
    ? r.incident_status
    : initialIncidentStatus(r.status)

  return {
    id: r.id,
    communityId: r.community_id,
    // Tidak ada ID pengganti/pseudonim yang dapat dikorelasikan di cache
    // warga. Pelapor dan admin tetap menerima ID asli agar layar miliknya
    // dan alur penanganan berfungsi.
    ...(revealAuthor ? { authorId: r.author_id } : {}),
    kind: r.kind,
    category: r.category,
    note: r.note,
    // Jangan mengirim titik GPS atau nomor rumah spesifik ke warga yang
    // bukan peserta insiden. Mereka tetap bisa melihat status darurat umum.
    at: !isSos || canSeeDetails ? (r.at_lat === null ? null : { lat: r.at_lat, lng: r.at_lng }) : null,
    address: !isSos || canSeeDetails ? r.address : '',
    status: r.status,
    incidentStatus,
    createdAt: r.created_at,
    handledBy: !isSos || canSeeDetails ? r.handled_by : null,
    handledAt: !isSos || canSeeDetails ? r.handled_at : null,
    resolvedNote: r.resolved_note ?? undefined,
    insideArea: r.inside_area === null ? null : !!r.inside_area,
    anonymous: !!r.anonymous,
    // Semua blob SOS di bawah disimpan terenkripsi. Jangan dekripsi satu pun
    // sampai viewer lolos pemeriksaan penerima insiden di atas.
    attachments: isSos
      ? canSeeDetails ? secureArray(r.attachments) : []
      : J(r.attachments as string) ?? [],
    messages: isSos
      ? canSeeDetails ? secureArray(r.messages) : []
      : J(r.messages as string) ?? [],
    responders: isSos
      ? canSeeDetails ? secureArray(r.responders) : []
      : J(r.responders as string) ?? [],
    track: isSos
      ? canSeeDetails ? secureArray(r.track) : []
      : J(r.track as string) ?? [],
    live: !!r.live,
    liveEndedAt: r.live_ended_at,
    audio: isSos ? (canSeeDetails ? secureAudio(r.audio) : null) : r.audio,
    audioSeconds: !isSos || canSeeDetails ? r.audio_seconds : 0,
    // Snapshot disimpan terenkripsi di database dan dibuka hanya setelah
    // pemeriksaan otorisasi ini.
    snapshot: isSos && canSeeDetails ? secureObject(r.snapshot) : null,
    recipients: isSos
      ? canSeeDetails ? secureArray(r.recipients) : []
      : J(r.recipients as string) ?? [],
    timeline: !isSos || canSeeDetails ? timeline : [],
    cancelledAt: r.cancelled_at,
  }
}

function mapCheckpoint(r: Record<string, unknown>) {
  return {
    id: r.id,
    communityId: r.community_id,
    name: r.name,
    lat: r.lat,
    lng: r.lng,
    radiusM: r.radius_m,
    order: r.ord,
    createdBy: r.created_by,
    createdAt: r.created_at,
    active: !!r.active,
  }
}

function mapSchedule(r: Record<string, unknown>) {
  return {
    id: r.id,
    communityId: r.community_id,
    label: r.label,
    startMinute: r.start_minute,
    endMinute: r.end_minute,
    days: J(r.days as string) ?? [],
    assignedSatpamIds: J(r.assigned_satpam_ids as string) ?? [],
    graceMin: r.grace_min,
    active: !!r.active,
    createdAt: r.created_at,
  }
}

function mapLog(r: Record<string, unknown>) {
  return {
    id: r.id,
    communityId: r.community_id,
    satpamId: r.satpam_id,
    checkpointId: r.checkpoint_id,
    checkpointName: r.checkpoint_name,
    scheduleId: r.schedule_id,
    scheduleLabel: r.schedule_label,
    at: r.at,
    lat: r.lat,
    lng: r.lng,
    distanceM: r.distance_m,
    insideRadius: !!r.inside_radius,
    status: r.status,
    note: r.note,
  }
}

function mapAnnouncement(r: Record<string, unknown>) {
  return {
    id: r.id,
    communityId: r.community_id,
    authorId: r.author_id,
    title: r.title,
    body: r.body,
    category: r.category ?? 'Umum',
    targetScope: r.target_scope ?? 'all',
    targetValue: r.target_value ?? '',
    pinned: !!r.pinned,
    createdAt: r.created_at,
  }
}

function canReadAnnouncement(me: MemberRow, r: Record<string, unknown>): boolean {
  if (me.role === 'admin' || me.role === 'superadmin') return true
  const scope = r.target_scope
  const target: 'all' | 'rw' | 'rt' | 'block' =
    scope === 'rw' || scope === 'rt' || scope === 'block' ? scope : 'all'
  return memberMatchesAudience(
    String(r.community_id),
    me.id,
    target,
    typeof r.target_value === 'string' ? r.target_value : '',
  )
}

/* ================= kesehatan ================= */

/** Health check Fly: proses dan koneksi SQLite harus benar-benar siap. */
app.get('/api/health', (c) => {
  try {
    db.prepare('SELECT 1').get()
    return c.json({ ok: true, push: pushEnabled, time: now() })
  } catch {
    return c.json({ ok: false, error: 'database_unavailable' }, 503)
  }
})

app.get('/api/push/key', (c) => c.json({ key: vapidPublicKey() }))

/**
 * Server-Sent Events untuk perubahan tenant secara real-time.
 *
 * Browser membuka stream lewat fetch agar Authorization Bearer tetap berada
 * di header (EventSource bawaan browser tidak bisa menambah header dan akan
 * memaksa token masuk ke query string/log). Event hanya sinyal invalidasi;
 * klien mengambil ulang state yang sudah difilter RBAC, bukan menerima data
 * insiden sensitif di stream ini.
 */
app.get('/api/events', auth, active, (c) => {
  const me = c.get('me')
  if (!me.community_id) return bad(c, 'errNoCommunity', 403)

  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let closed = false
  let cleanup = () => {}

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, payload: unknown) => {
        if (closed) return
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`),
          )
        } catch {
          // Koneksi bisa putus di antara pemeriksaan dan enqueue.
          cleanup()
        }
      }
      cleanup = () => {
        if (closed) return
        closed = true
        unsubscribe?.()
        if (heartbeat) clearInterval(heartbeat)
      }

      unsubscribe = subscribeCommunity(me.community_id!, (event: RealtimeEvent) => {
        send('state', event)
      })
      // Pesan awal membuat klien tahu koneksi SSE benar-benar hidup.
      send('ready', { at: now() })
      heartbeat = setInterval(() => send('ping', { at: now() }), 25_000)
      heartbeat.unref?.()
      // Pada beberapa adapter Node, stream cancel baru tiba setelah socket
      // ditutup; signal request memberi jalur cleanup tambahan agar listener
      // tenant tidak bocor bila tab/browser mendadak hilang.
      c.req.raw.signal.addEventListener('abort', cleanup, { once: true })

    },
    // `cancel()` dipanggil saat fetch AbortController klien menghentikan
    // stream. Kedua jalur memakai closure cleanup yang sama.
    cancel() {
      cleanup()
    },
  })

  return c.body(stream, 200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
})

/**
 * Gambar QRIS yang diunggah superadmin.
 *
 * Sengaja terbuka tanpa login: klien email tidak membawa token, padahal
 * gambar ini justru perlu tampil di email tagihan. Isinya memang untuk
 * disebarluaskan — sama seperti QR yang ditempel di papan pengumuman.
 */
app.get('/api/qris.png', (c) => {
  const img = getQrisImage()
  if (!img) return c.json({ error: 'qrisNotSet' }, 404)
  const body = Buffer.from(img.data, 'base64')
  return c.body(body, 200, {
    'Content-Type': img.mime,
    // Ada penanda ?v= pada URL, jadi aman disimpan lama.
    'Cache-Control': 'public, max-age=31536000, immutable',
  })
})

/** Superadmin mengunggah atau mengganti gambar QRIS. */
app.post('/api/qris', auth, async (c) => {
  if (c.get('me').role !== 'superadmin') return bad(c, 'forbidden', 403)

  const b = (await c.req.json().catch(() => ({}))) as {
    mime?: string
    data?: string
  }
  const mime = String(b.mime ?? '')
  const data = String(b.data ?? '')

  if (!(QRIS_MIME as readonly string[]).includes(mime))
    return bad(c, 'errQrisType')
  if (!data) return bad(c, 'errRequired')

  // Panjang base64 kira-kira 4/3 ukuran aslinya.
  const bytes = Math.floor((data.length * 3) / 4)
  if (bytes > QRIS_MAX_BYTES) return bad(c, 'errQrisTooBig')

  // Pastikan benar-benar base64 yang sah sebelum disimpan, supaya
  // tidak menyimpan sampah yang nanti gagal ditampilkan.
  let decoded: Buffer
  try {
    decoded = Buffer.from(data, 'base64')
    if (decoded.length === 0) throw new Error('empty')
  } catch {
    return bad(c, 'errQrisType')
  }
  if (!looksLikeImage(decoded, mime)) return bad(c, 'errQrisType')

  setQrisImage(mime, decoded.toString('base64'))
  audit(null, c.get('me').id, 'qris.upload', mime)
  return c.json({ ok: true, imageUrl: qrisImagePath(QRIS_IMAGE_URL) })
})

/** Superadmin mengubah nama dan nomor pemilik akun QRIS. */
app.post('/api/qris/owner', auth, async (c) => {
  if (c.get('me').role !== 'superadmin') return bad(c, 'forbidden', 403)
  const b = (await c.req.json().catch(() => ({}))) as {
    name?: string
    phone?: string
  }
  const name = String(b.name ?? '').trim().slice(0, 80)
  const phone = String(b.phone ?? '').trim().slice(0, 40)
  if (!name) return bad(c, 'errRequired')

  setQrisOwner(name, phone)
  audit(null, c.get('me').id, 'qris.owner', name)
  return c.json({ ok: true, name, phone })
})

/** Superadmin menghapus gambar QRIS. */
app.delete('/api/qris', auth, (c) => {
  if (c.get('me').role !== 'superadmin') return bad(c, 'forbidden', 403)
  clearQrisImage()
  audit(null, c.get('me').id, 'qris.clear', '')
  return c.json({ ok: true })
})

/**
 * Periksa angka ajaib berkas, bukan sekadar percaya jenis yang dikirim.
 * Mencegah berkas apa pun disimpan lalu disajikan sebagai gambar.
 */
function looksLikeImage(buf: Buffer, mime: string): boolean {
  if (mime === 'image/png')
    return buf.length > 8 && buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
  if (mime === 'image/jpeg') return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8
  if (mime === 'image/webp')
    return (
      buf.length > 12 &&
      buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP'
    )
  return false
}

/* ================= komunitas publik ================= */

app.get('/api/communities/search', (c) => {
  const q = (c.req.query('q') ?? '').trim().toLowerCase()
  const hostTenant = tenantHost(c)
  if (hostTenant === null) return bad(c, 'errNoCommunity', 404)
  // Pada subdomain, halaman daftar/join tidak menjadi direktori tenant lain.
  const rows = (hostTenant
    ? db.prepare('SELECT * FROM communities WHERE id=?').all(hostTenant.id)
    : db.prepare('SELECT * FROM communities').all()) as Record<string, unknown>[]
  const out = rows
    .filter((r) =>
      !q
        ? true
        : String(r.name).toLowerCase().includes(q) ||
          String(r.city).toLowerCase().includes(q) ||
          String(r.address).toLowerCase().includes(q),
    )
    .slice(0, 20)
    .map((r) => ({
      id: r.id,
      name: r.name,
      city: r.city,
      address: r.address,
      members: (
        db
          .prepare(
            "SELECT count(*) n FROM members WHERE community_id = ? AND status='active'",
          )
          .get(r.id) as { n: number }
      ).n,
    }))
  return c.json({ communities: out })
})

/** Cek kode undangan tanpa memakainya. */
app.get('/api/invites/:code', (c) => {
  const hostTenant = tenantHost(c)
  if (hostTenant === null) return bad(c, 'errInvite', 404)
  const code = normalizeCode(c.req.param('code'))
  const inv = db
    .prepare('SELECT * FROM invites WHERE code = ?')
    .get(code) as Record<string, unknown> | undefined
  if (!inv || inv.revoked_at) return bad(c, 'errInvite', 404)
  if (hostTenant && inv.community_id !== hostTenant.id) return bad(c, 'errInvite', 404)
  if ((inv.expires_at as number) <= now()) return bad(c, 'errInviteExpired', 410)
  const used: string[] = J(inv.used_by as string) ?? []
  if (inv.max_uses !== null && used.length >= (inv.max_uses as number))
    return bad(c, 'errInviteUsed', 410)
  const com = db
    .prepare('SELECT * FROM communities WHERE id = ?')
    .get(inv.community_id) as Record<string, unknown> | undefined
  if (!com) return bad(c, 'errInvite', 404)
  return c.json({
    invite: { code: inv.code, role: inv.role, expiresAt: inv.expires_at },
    community: { id: com.id, name: com.name, city: com.city },
  })
})

/* ================= konsol superadmin / tenant SaaS ================= */

const SUBSCRIPTION_TIERS = ['FREE', 'COMMUNITY', 'PROFESSIONAL', 'ENTERPRISE'] as const

type SubscriptionTier = (typeof SUBSCRIPTION_TIERS)[number]

function cleanSubdomain(raw: unknown, fallback: string): string {
  const source = (typeof raw === 'string' && raw.trim() ? raw : fallback)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return source.replace(/-+$/g, '').replace(/^-+/, '')
}

function subscriptionStatus(row: Record<string, unknown>): string {
  if (row.subscription_status === 'suspended' || row.plan === 'suspended') return 'suspended'
  if (typeof row.paid_until === 'number' && row.paid_until > now()) return 'active'
  if (typeof row.trial_ends_at === 'number' && row.trial_ends_at > now()) return 'trial'
  return 'expired'
}

function superadminOnly(c: Context<Env>): MemberRow | null {
  const me = c.get('me')
  return me.role === 'superadmin' ? me : null
}

app.get('/api/superadmin/overview', auth, (c) => {
  if (!superadminOnly(c)) return bad(c, 'forbidden', 403)
  const communities = db.prepare(
    `SELECT c.*, count(m.id) AS residents
     FROM communities c LEFT JOIN members m ON m.community_id=c.id AND m.role<>'superadmin'
     GROUP BY c.id ORDER BY c.created_at DESC`,
  ).all() as (Record<string, unknown> & { residents: number })[]
  const revenue = db.prepare("SELECT coalesce(sum(amount),0) AS amount FROM invoices WHERE status='paid'").get() as { amount: number }
  const pending = db.prepare("SELECT count(*) AS count FROM invoices WHERE status='awaiting_verification'").get() as { count: number }
  const residentCount = db.prepare("SELECT count(*) AS count FROM members WHERE role<>'superadmin'").get() as { count: number }
  const statuses = communities.map((tenant) => subscriptionStatus(tenant))
  return c.json({
    metrics: {
      tenants: communities.length,
      residents: residentCount.count,
      revenue: revenue.amount,
      pendingVerifications: pending.count,
      active: statuses.filter((status) => status === 'active').length,
      trial: statuses.filter((status) => status === 'trial').length,
      suspended: statuses.filter((status) => status === 'suspended').length,
      expired: statuses.filter((status) => status === 'expired').length,
    },
    tenants: communities.map((tenant) => ({
      ...mapCommunity(tenant),
      residents: tenant.residents,
      effectiveSubscriptionStatus: subscriptionStatus(tenant),
    })),
  })
})

/** Superadmin membuat tenant dan satu admin aktif dalam satu transaksi. */
app.post('/api/superadmin/tenants', auth, async (c) => {
  const actor = superadminOnly(c)
  if (!actor) return bad(c, 'forbidden', 403)
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: unknown
    address?: unknown
    city?: unknown
    subdomain?: unknown
    tier?: unknown
    adminName?: unknown
    adminPhone?: unknown
    adminEmail?: unknown
    adminPassword?: unknown
    adminHouse?: unknown
    language?: unknown
  }
  const name = typeof body.name === 'string' ? body.name.replaceAll('\u0000', '').trim().slice(0, 80) : ''
  const address = typeof body.address === 'string' ? body.address.replaceAll('\u0000', '').trim().slice(0, 160) : ''
  const city = typeof body.city === 'string' ? body.city.replaceAll('\u0000', '').trim().slice(0, 80) : ''
  const adminName = typeof body.adminName === 'string' ? body.adminName.replaceAll('\u0000', '').trim().slice(0, 80) : ''
  const adminEmail = typeof body.adminEmail === 'string' ? body.adminEmail.trim().toLowerCase() : ''
  const adminPhone = typeof body.adminPhone === 'string' ? body.adminPhone.replace(/\s|-/g, '').slice(0, 30) : ''
  const adminHouse = typeof body.adminHouse === 'string' ? body.adminHouse.replaceAll('\u0000', '').trim().slice(0, 160) : ''
  const password = typeof body.adminPassword === 'string' ? body.adminPassword : ''
  const tier = SUBSCRIPTION_TIERS.includes(body.tier as SubscriptionTier)
    ? body.tier as SubscriptionTier
    : 'FREE'
  const subdomain = cleanSubdomain(body.subdomain, name)
  const language = body.language === 'en' || body.language === 'su' ? body.language : 'id'
  if (!name || !adminName || !adminEmail || !adminPhone || !adminHouse || password.length < 8 || !subdomain)
    return bad(c, 'invalid_tenant_input', 422)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) return bad(c, 'invalid_tenant_input', 422)
  if (db.prepare('SELECT 1 FROM communities WHERE lower(subdomain)=?').get(subdomain))
    return bad(c, 'subdomain_taken', 409)
  if (db.prepare('SELECT 1 FROM members WHERE lower(email)=? OR phone=?').get(adminEmail, adminPhone))
    return bad(c, 'admin_identity_taken', 409)

  const communityId = uid('c_')
  const adminId = uid('m_')
  const at = now()
  // Hitung bcrypt sebelum memegang transaksi SQLite, tetapi jangan membuat
  // tenant/member terlihat sebagian: seluruh INSERT dan KK pertama harus
  // berhasil atau seluruhnya rollback.
  const passwordHash = hashPassword(password)
  try {
    db.transaction(() => {
      db.prepare(
        `INSERT INTO communities
         (id,name,address,city,created_at,created_by,area,center,language,plan,plan_name,
          subscription_tier,subscription_status,subdomain,trial_ends_at)
         VALUES (?,?,?,?,?,'','[]',?,?,'trial','trial',?,'trial',?,?)`,
      ).run(
        communityId,
        name,
        address,
        city,
        at,
        JSON.stringify({ lat: -6.914744, lng: 107.60981 }),
        language,
        tier,
        subdomain,
        at + TRIAL_DAYS * DAY,
      )
      db.prepare(
        `INSERT INTO members
         (id,community_id,name,phone,email,password_hash,house,role,status,language,created_at,decided_at,decided_by,join_method,join_note)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        adminId,
        communityId,
        adminName,
        adminPhone,
        adminEmail,
        passwordHash,
        adminHouse,
        'admin',
        'active',
        language,
        at,
        at,
        actor.id,
        'superadmin_create',
        '',
      )
      ensureHouseholdForMember({ communityId, memberId: adminId, address: adminHouse, createdAt: at })
      db.prepare('UPDATE communities SET created_by=? WHERE id=?').run(adminId, communityId)
    })()
  } catch {
    // Tidak tampilkan detail SQLite (mis. constraint/struktur) ke browser.
    return bad(c, 'tenant_create_failed', 422)
  }
  audit(null, actor.id, 'tenant.create', `${communityId}:${tier}`)
  return c.json({
    tenant: {
      id: communityId,
      name,
      subdomain,
      subscriptionTier: tier,
      subscriptionStatus: 'trial',
      trialEndsAt: at + TRIAL_DAYS * DAY,
    },
    admin: { id: adminId, name: adminName, email: adminEmail },
  }, 201)
})

/** Suspensi tidak menghapus data; aktivasi memulihkan status berdasarkan masa trial/aktif yang nyata. */
app.put('/api/superadmin/tenants/:id/subscription', auth, async (c) => {
  const actor = superadminOnly(c)
  if (!actor) return bad(c, 'forbidden', 403)
  const id = c.req.param('id') ?? ''
  const tenant = db.prepare('SELECT * FROM communities WHERE id=?').get(id) as Record<string, unknown> | undefined
  if (!tenant) return bad(c, 'not_found', 404)
  const body = (await c.req.json().catch(() => ({}))) as {
    status?: unknown
    tier?: unknown
    reason?: unknown
    extendTrialDays?: unknown
  }
  const current = subscriptionStatus(tenant)
  const requested = body.status === 'suspended' || body.status === 'active' ? body.status : undefined
  const tier = SUBSCRIPTION_TIERS.includes(body.tier as SubscriptionTier)
    ? body.tier as SubscriptionTier
    : String(tenant.subscription_tier ?? 'FREE') as SubscriptionTier
  const extend = Number.isInteger(body.extendTrialDays) && Number(body.extendTrialDays) >= 1 && Number(body.extendTrialDays) <= 365
    ? Number(body.extendTrialDays)
    : 0
  if (body.status !== undefined && !requested) return bad(c, 'invalid_subscription_status', 422)
  if (body.tier !== undefined && !SUBSCRIPTION_TIERS.includes(body.tier as SubscriptionTier))
    return bad(c, 'invalid_subscription_tier', 422)
  const reason = typeof body.reason === 'string' ? body.reason.replaceAll('\u0000', '').trim().slice(0, 300) : ''
  const trialEnds = extend ? Math.max(Number(tenant.trial_ends_at) || 0, now()) + extend * DAY : Number(tenant.trial_ends_at)
  let status = requested ?? current
  if (requested === 'active') {
    status = Number(tenant.paid_until) > now() ? 'active' : trialEnds > now() ? 'trial' : 'expired'
  } else if (extend && status !== 'suspended') {
    // Perpanjangan trial menghidupkan kembali tenant kedaluwarsa tanpa
    // memalsukan status pembayaran sebagai active.
    status = Number(tenant.paid_until) > now() ? 'active' : 'trial'
  }
  db.prepare(
    `UPDATE communities SET subscription_tier=?, subscription_status=?, trial_ends_at=?, suspended_reason=? WHERE id=?`,
  ).run(tier, status, trialEnds, status === 'suspended' ? reason || 'Ditangguhkan oleh Superadmin' : null, id)
  audit(null, actor.id, 'tenant.subscription.update', `${id}:${status}:${tier}${extend ? `:+${extend}d` : ''}`)
  publishCommunityEvent(id, 'community.hub.updated', 'subscription')
  return c.json({
    tenant: {
      ...mapCommunity(db.prepare('SELECT * FROM communities WHERE id=?').get(id) as Record<string, unknown>),
      effectiveSubscriptionStatus: status,
    },
  })
})

/* ================= auth ================= */

const registerSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(8),
  email: z.string().email(),
  password: z.string().min(6),
  house: z.string().min(1),
  language: z.enum(['id', 'en', 'su']).default('id'),
  mode: z.enum(['create', 'join']),
  communityId: z.string().optional(),
  communityName: z.string().optional(),
  communityAddress: z.string().optional(),
  city: z.string().optional(),
  center: z.object({ lat: z.number(), lng: z.number() }).optional(),
  inviteCode: z.string().optional(),
  joinNote: z.string().optional(),
  deviceId: z.string().optional(),
})

app.post('/api/auth/register', async (c) => {
  /*
   * Tiap pendaftaran menambah satu baris di antrean persetujuan admin —
   * pekerjaan untuk manusia sungguhan. Tanpa batas, satu skrip bisa
   * mengubur pendaftar asli di antara ratusan yang palsu.
   *
   * Batasnya lapang karena QR di pos satpam memang dimaksudkan untuk
   * dipindai banyak warga berturut-turut, sering dari Wi-Fi yang sama.
   * Penyaring sesungguhnya tetap persetujuan admin.
   */
  if (!hitRateLimit('register', alamatKlien(c.req.raw.headers), BATAS.register))
    return bad(c, 'errTooManyAttempts', 429)

  const parsed = registerSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return bad(c, 'errRequired')
  const i = parsed.data
  const hostTenant = tenantHost(c)
  if (hostTenant === null) return bad(c, 'errNoCommunity', 404)
  // Tenant baru hanya dibuat pada apex. Pada subdomain, warga hanya dapat
  // meminta bergabung ke lingkungan pemilik host tersebut.
  if (hostTenant && (i.mode !== 'join' || i.communityId !== hostTenant.id))
    return bad(c, 'tenant_forbidden', 403)

  const email = i.email.trim().toLowerCase()
  const phone = i.phone.replace(/\s|-/g, '')

  if (db.prepare('SELECT 1 FROM members WHERE lower(email)=?').get(email))
    return bad(c, 'errEmailTaken', 409)
  if (db.prepare('SELECT 1 FROM members WHERE phone=?').get(phone))
    return bad(c, 'errPhoneTaken', 409)

  let communityId: string
  let role = 'warga'
  let status = 'pending'
  let firstAdmin = false
  let invite: Record<string, unknown> | null = null

  if (i.mode === 'create') {
    /*
     * Nama lingkungan wajib diisi admin sendiri, dan tidak boleh sekadar
     * namanya. Judul di bagian atas aplikasi memakai nama ini; bila kosong
     * atau berisi nama orang, lingkungan itu tampak bernama seperti
     * pengurusnya — padahal pengurus berganti sedangkan tempatnya tetap.
     */
    const nama = i.communityName?.trim() ?? ''
    if (!nama) return bad(c, 'errCommunityName')
    if (nama.toLowerCase() === i.name.trim().toLowerCase())
      return bad(c, 'errCommunityNameIsPerson')
    communityId = uid('c_')
    db.prepare(
      `INSERT INTO communities
       (id,name,address,city,created_at,created_by,area,center,language,
        plan,plan_name,trial_ends_at)
       VALUES (?,?,?,?,?,'','[]',?,?,'trial','trial',?)`,
    ).run(
      communityId,
      nama,
      i.communityAddress?.trim() ?? '',
      i.city?.trim() ?? '',
      now(),
      JSON.stringify(i.center ?? { lat: -6.9829, lng: 107.5197 }),
      i.language,
      now() + TRIAL_DAYS * DAY,
    )
    role = 'admin'
    status = 'active'
    firstAdmin = true
  } else {
    if (!i.communityId) return bad(c, 'errNoCommunity')
    const com = db
      .prepare('SELECT id FROM communities WHERE id = ?')
      .get(i.communityId)
    if (!com) return bad(c, 'errNoCommunity', 404)
    communityId = i.communityId

    const hasAdmin = db
      .prepare(
        "SELECT 1 FROM members WHERE community_id=? AND role='admin' AND status='active'",
      )
      .get(communityId)
    if (!hasAdmin) {
      role = 'admin'
      status = 'active'
      firstAdmin = true
    }

    const code = normalizeCode(i.inviteCode ?? '')
    if (code) {
      invite = (db.prepare('SELECT * FROM invites WHERE code = ?').get(code) ??
        null) as Record<string, unknown> | null
      if (!invite || invite.revoked_at) return bad(c, 'errInvite', 404)
      if ((invite.expires_at as number) <= now())
        return bad(c, 'errInviteExpired', 410)
      const used: string[] = J(invite.used_by as string) ?? []
      if (invite.max_uses !== null && used.length >= (invite.max_uses as number))
        return bad(c, 'errInviteUsed', 410)
      if (invite.community_id !== communityId) return bad(c, 'errInvite')
      // Undangan hanya MENGUSULKAN peran — approval admin tetap wajib.
      role = invite.role as string
      if (!firstAdmin) status = 'pending'
    }
  }

  const id = uid('m_')
  db.prepare(
    `INSERT INTO members
     (id,community_id,name,phone,email,password_hash,house,role,status,language,
      device_id,created_at,decided_at,decided_by,invited_by,join_method,join_code,join_note)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?)`,
  ).run(
    id,
    communityId,
    i.name.trim(),
    phone,
    email,
    hashPassword(i.password),
    i.house.trim(),
    role,
    status,
    i.language,
    i.deviceId ?? null,
    now(),
    status === 'active' ? now() : null,
    invite ? (invite.created_by as string) : null,
    firstAdmin ? 'founder' : invite ? 'invite' : 'search',
    invite ? (invite.code as string) : null,
    (i.joinNote ?? '').trim(),
  )

  // Pendaftaran baru langsung dilekatkan pada KK alamatnya. Bila alamat sudah
  // ada, ia menjadi anggota keluarga; tidak mungkin lahir dua kepala keluarga
  // untuk satu alamat hanya karena registrasi dilakukan dari HP lain.
  ensureHouseholdForMember({
    communityId,
    memberId: id,
    address: i.house.trim(),
  })

  if (firstAdmin)
    db.prepare('UPDATE communities SET created_by=? WHERE id=?').run(id, communityId)
  if (invite) {
    const used: string[] = J(invite.used_by as string) ?? []
    used.push(id)
    db.prepare('UPDATE invites SET used_by=? WHERE id=?').run(
      JSON.stringify(used),
      invite.id,
    )
  }

  audit(communityId, id, 'register', `${role} (${status})`)

  // Beri tahu admin ada pendaftar baru
  if (status === 'pending') {
    const admins = db
      .prepare(
        "SELECT id FROM members WHERE community_id=? AND role='admin' AND status='active'",
      )
      .all(communityId) as { id: string }[]
    void pushToMembers(
      admins.map((a) => a.id),
      {
        title: 'Pendaftar baru',
        body: `${i.name.trim()} ingin bergabung.`,
        url: '#/app/admin',
        tag: 'join-request',
      },
    )
  }

  const token = createSession(id, i.deviceId)
  const me = db.prepare('SELECT * FROM members WHERE id=?').get(id) as MemberRow
  return c.json({ token, member: publicMember(me), firstAdmin }, 201)
})

app.post('/api/auth/login', async (c) => {
  /*
   * Batasi percobaan masuk per alamat.
   *
   * Sengaja longgar: SATU RW berbagi satu alamat publik, jadi seluruh
   * warga tampak datang dari alamat yang sama persis seperti penyerang.
   * Batas yang ketat akan mengunci tetangga sungguhan. Yang benar-benar
   * memperlambat penebakan sandi adalah bcrypt; batas ini hanya
   * mencegah pembanjiran.
   *
   * Dibatasi per alamat, BUKAN per akun. Mengunci akun terdengar lebih
   * aman, padahal memberi penyerang cara membungkam warga: salah-sandi
   * berkali-kali atas nama orang lain, dan orang itu terkunci dari
   * aplikasi yang mungkin ia butuhkan malam itu juga.
   */
  if (!hitRateLimit('login', alamatKlien(c.req.raw.headers), BATAS.login))
    return bad(c, 'errTooManyAttempts', 429)

  const body = (await c.req.json().catch(() => ({}))) as {
    identifier?: string
    password?: string
    deviceId?: string
  }
  const identifier = (body.identifier ?? '').trim().toLowerCase()
  // Tanda hubung sah pada bagian lokal email (`nama-warga@...`), jadi jangan
  // normalisasi email seperti nomor telepon. Nomor tetap boleh diketik dengan
  // spasi atau tanda hubung agar nyaman di ponsel.
  const emailQuery = identifier.replace(/\s/g, '')
  const phoneQuery = identifier.replace(/\s|-/g, '')
  if (!emailQuery || !body.password) return bad(c, 'errLogin', 401)

  const hostTenant = tenantHost(c)
  // Akun tidak bisa dipakai lintas subdomain. Respons tetap generik agar host
  // tidak menjadi oracle daftar akun/tenant untuk penyerang.
  if (hostTenant === null) return bad(c, 'errLogin', 401)
  const row = (hostTenant
    ? db
        .prepare('SELECT * FROM members WHERE community_id=? AND (lower(email)=? OR phone=?)')
        .get(hostTenant.id, emailQuery, phoneQuery)
    : db
        .prepare('SELECT * FROM members WHERE lower(email)=? OR phone=?')
        .get(emailQuery, phoneQuery)) as MemberRow | undefined

  // Selalu bandingkan hash agar waktu respons tidak membocorkan
  // apakah email terdaftar atau tidak.
  const ok = verifyPassword(
    body.password,
    row?.password_hash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv',
  )
  if (!row || !ok) return bad(c, 'errLogin', 401)
  if (row.role !== 'superadmin' && row.community_id) {
    const subscription = db
      .prepare('SELECT plan,subscription_status FROM communities WHERE id=?')
      .get(row.community_id) as { plan: string; subscription_status?: string } | undefined
    if (subscription?.plan === 'suspended' || subscription?.subscription_status === 'suspended')
      return bad(c, 'tenant_suspended', 403)
  }

  // Perangkat hanya diklaim untuk warga. Superadmin mengelola layanan dari
  // perangkat mana saja — mengikatnya akan merebut perangkat dari warga
  // yang memakainya, lalu membuat halaman depan menyapa "Superadmin".
  if (body.deviceId && row.role !== 'superadmin')
    db.prepare('UPDATE members SET device_id=? WHERE id=?').run(body.deviceId, row.id)

  const token = createSession(row.id, body.deviceId)
  return c.json({ token, member: publicMember(row) })
})

app.post('/api/auth/logout', auth, (c) => {
  const t = bearer(c)
  if (t) destroySession(t)
  return c.json({ ok: true })
})

app.get('/api/me', auth, (c) => c.json({ member: publicMember(c.get('me')) }))

/* ================= snapshot data ================= */

/**
 * Satu panggilan berisi seluruh data yang boleh dilihat pemanggil.
 * Klien memakai ini untuk mengisi state dan menyegarkan berkala.
 */
app.get('/api/state', auth, (c) => {
  const me = c.get('me')
  const cid = me.community_id

  if (me.role === 'superadmin') {
    return c.json({
      me: publicMember(me),
      communities: (
        db.prepare('SELECT * FROM communities').all() as Record<string, unknown>[]
      ).map(mapCommunity),
      // Konsol SaaS hanya membutuhkan identitas operasional/metric tenant.
      // Jangan jadikan peran superadmin jalan pintas untuk menduplikasi profil
      // medis seluruh warga ke cache browser; snapshot SOS tetap dibatasi
      // kepada penerima insiden di jalur tenant.
      members: (db.prepare('SELECT * FROM members').all() as MemberRow[]).map((member) =>
        visibleMember(member, me),
      ),
      audit: db.prepare('SELECT * FROM audit ORDER BY at DESC LIMIT 200').all(),
    })
  }

  if (!cid) return c.json({ me: publicMember(me) })

  const one = <T>(sql: string) => db.prepare(sql).all(cid) as T[]
  const community = db
    .prepare('SELECT * FROM communities WHERE id=?')
    .get(cid) as Record<string, unknown>

  // Anggota yang belum aktif hanya boleh melihat dirinya sendiri.
  if (me.status !== 'active') {
    return c.json({
      me: publicMember(me),
      community: mapCommunity(community),
      members: [],
      reports: [],
    })
  }

  const members = (
    db.prepare('SELECT * FROM members WHERE community_id=?').all(cid) as MemberRow[]
  ).map((m) => visibleMember(m, me))

  // Timeline dibaca per tenant sekali lalu digabungkan ke setiap laporan;
  // hindari query N+1 ketika dashboard memuat banyak insiden.
  const timelines = timelineByIncident(cid)
  const reports = (
    one<Record<string, unknown>>(
      'SELECT * FROM reports WHERE community_id=? ORDER BY created_at DESC LIMIT 200',
    )
  )
    .filter((report) => canReadReport(me, report))
    .map((report) => mapReport(report, me, timelines.get(String(report.id)) ?? []))

  /*
   * Apakah aplikasi perlu menanyakan lokasi sekarang?
   *
   * Hanya ketika ada peringatan darurat yang masih berlangsung di
   * lingkungan ini. Di luar itu klien tidak menyentuh GPS sama sekali,
   * sehingga posisi warga tidak pernah terkumpul di hari-hari biasa.
   */
  const daruratAktif = db
    .prepare(
      `SELECT 1 FROM reports
       WHERE community_id=? AND kind='sos' AND status='open' AND created_at > ?`,
    )
    .get(cid, now() - FRESH_MS)

  return c.json({
    me: publicMember(me),
    community: mapCommunity(community),
    // Semua anggota aktif boleh tahu siapa penanggung jawab operasional;
    // hak mengubahnya tetap hanya pendiri/superadmin dan ditegakkan endpoint.
    managementResponsibilities: listManagementResponsibilities(cid),
    canAssignManagementResponsibilities: canAssignManagementResponsibilities(me),
    members,
    reports,
    locationWanted: !!daruratAktif,
    checkpoints: one<Record<string, unknown>>(
      'SELECT * FROM checkpoints WHERE community_id=? AND active=1 ORDER BY ord',
    ).map(mapCheckpoint),
    schedules: one<Record<string, unknown>>(
      'SELECT * FROM schedules WHERE community_id=?',
    ).map(mapSchedule),
    // Rute/pola ronda adalah data operasional satpam dan pengurus, bukan feed
    // semua warga. Warga tetap dapat melihat pengumuman keselamatan tanpa GPS
    // log patroli orang lain.
    patrolLogs: me.role === 'admin' || me.role === 'satpam'
      ? one<Record<string, unknown>>(
          'SELECT * FROM patrol_logs WHERE community_id=? ORDER BY at DESC LIMIT 200',
        ).map(mapLog)
      : [],
    invites: requireAdmin(c)
      ? one<Record<string, unknown>>('SELECT * FROM invites WHERE community_id=?').map(
          (r) => ({
            id: r.id,
            communityId: r.community_id,
            code: r.code,
            role: r.role,
            createdBy: r.created_by,
            createdAt: r.created_at,
            expiresAt: r.expires_at,
            usedBy: J(r.used_by as string) ?? [],
            maxUses: r.max_uses,
            revokedAt: r.revoked_at,
          }),
        )
      : [],
    contacts: db
      .prepare(
        'SELECT * FROM contacts WHERE community_id=? AND (owner_id IS NULL OR owner_id=?)',
      )
      .all(cid, me.id)
      .map((v) => {
        const r = v as Record<string, unknown>
        return {
          id: r.id,
          ownerId: r.owner_id,
          communityId: r.community_id,
          name: r.name,
          phone: r.phone,
          kind: r.kind,
          verified: !!r.verified,
          memberId: r.member_id,
          createdAt: r.created_at,
        }
      }),
    broadcasts: one<Record<string, unknown>>(
      'SELECT * FROM broadcasts WHERE community_id=? ORDER BY created_at DESC LIMIT 50',
    ).map((r) => ({
      id: r.id,
      communityId: r.community_id,
      authorId: r.author_id,
      severity: r.severity,
      title: r.title,
      body: r.body,
      instruction: r.instruction,
      requireSafetyCheck: !!r.require_safety_check,
      createdAt: r.created_at,
      responses: J(r.responses as string) ?? [],
    })),
    announcements: one<Record<string, unknown>>(
      'SELECT * FROM announcements WHERE community_id=? ORDER BY pinned DESC, created_at DESC',
    )
      // Target pengumuman selalu dihitung server dari RT/RW/blok KK. Klien
      // tidak dapat meminta pengumuman blok tetangga dengan mengubah filter UI.
      .filter((row) => canReadAnnouncement(me, row))
      .map(mapAnnouncement),
    // Buku tamu termasuk identitas tamu/plakat kendaraan, jadi hanya satpam
    // dan admin tenant yang menerimanya. Menyembunyikan tab UI saja tidak
    // cukup karena /state adalah sumber cache semua perangkat.
    guests: me.role === 'admin' || me.role === 'satpam'
      ? one<Record<string, unknown>>(
          'SELECT * FROM guests WHERE community_id=? ORDER BY check_in DESC LIMIT 100',
        ).map((r) => ({
          id: r.id,
          communityId: r.community_id,
          name: r.name,
          purpose: r.purpose,
          host: r.host,
          plate: r.plate,
          // Nomor KTP bukan data yang dibutuhkan layar daftar tamu. Jangan
          // masukkan ke cache/browser walaupun viewer adalah petugas.
          checkIn: r.check_in,
          checkOut: r.check_out,
          recordedBy: r.recorded_by,
        }))
      : [],
  })
})

/* ================= approval anggota ================= */

app.post('/api/members/:id/decide', auth, active, async (c) => {
  if (!requireAdmin(c)) return bad(c, 'adminOnly', 403)
  const me = c.get('me')
  const target = db
    .prepare('SELECT * FROM members WHERE id=?')
    .get(c.req.param('id')) as MemberRow | undefined
  if (!target) return bad(c, 'not_found', 404)
  if (!sameCommunity(me, target.community_id)) return bad(c, 'forbidden', 403)

  const b = (await c.req.json().catch(() => ({}))) as {
    decision?: 'accept' | 'reject'
    role?: string
    reason?: string
  }
  const roles = ['warga', 'satpam', 'admin']
  if (b.decision === 'accept') {
    const role = roles.includes(b.role ?? '') ? b.role! : 'warga'
    db.prepare(
      "UPDATE members SET status='active', role=?, decided_at=?, decided_by=?, rejected_reason=NULL WHERE id=?",
    ).run(role, now(), me.id, target.id)
    audit(target.community_id, me.id, 'member.accept', `${target.name} → ${role}`)
    void pushToMembers([target.id], {
      title: 'Pendaftaran disetujui',
      body: `Selamat datang di lingkungan Anda.`,
      url: '#/app',
      tag: 'approved',
    })
  } else {
    db.prepare(
      "UPDATE members SET status='rejected', rejected_reason=?, decided_at=?, decided_by=? WHERE id=?",
    ).run((b.reason ?? '').trim(), now(), me.id, target.id)
    audit(target.community_id, me.id, 'member.reject', target.name)
    void pushToMembers([target.id], {
      title: 'Pendaftaran ditolak',
      body: (b.reason ?? '').trim() || 'Hubungi pengurus lingkungan.',
      tag: 'rejected',
    })
  }
  return c.json({ ok: true })
})

app.post('/api/members/:id/role', auth, active, async (c) => {
  if (!requireAdmin(c)) return bad(c, 'adminOnly', 403)
  const me = c.get('me')
  const t = db.prepare('SELECT * FROM members WHERE id=?').get(c.req.param('id')) as
    | MemberRow
    | undefined
  if (!t || !sameCommunity(me, t.community_id)) return bad(c, 'forbidden', 403)
  const b = (await c.req.json()) as { role?: string }
  if (!['warga', 'satpam', 'admin'].includes(b.role ?? '')) return bad(c, 'bad_role')
  db.prepare('UPDATE members SET role=? WHERE id=?').run(b.role, t.id)
  // Tanggung jawab tidak boleh bertahan pada akun yang baru diturunkan
  // menjadi warga/satpam. Fallback pendiri langsung mengambil alih sampai
  // penugasan admin baru dilakukan.
  if (b.role !== 'admin')
    db.prepare('DELETE FROM management_responsibilities WHERE community_id=? AND member_id=?').run(
      t.community_id,
      t.id,
    )
  audit(t.community_id, me.id, 'member.role', `${t.name} → ${b.role}`)
  publishCommunityEvent(t.community_id!, 'management.updated', t.id)
  return c.json({ ok: true })
})

app.put('/api/me/profile', auth, async (c) => {
  const me = c.get('me')
  const b = (await c.req.json()) as { emergency?: unknown; language?: string }
  if (b.emergency !== undefined) {
    if (!b.emergency || typeof b.emergency !== 'object') return bad(c, 'errRequired')
    // Data medis/kontak disimpan AES-256-GCM saat WJW_DATA_ENCRYPTION_KEY
    // tersedia (wajib pada produksi); jangan pernah audit isi field ini.
    db.prepare('UPDATE members SET emergency=? WHERE id=?').run(
      encryptSensitiveJson(b.emergency),
      me.id,
    )
    audit(me.community_id, me.id, 'emergency_profile.update', '')
  }
  if (b.language && ['id', 'en', 'su'].includes(b.language))
    db.prepare('UPDATE members SET language=? WHERE id=?').run(b.language, me.id)
  return c.json({ ok: true })
})

/* ================= undangan ================= */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

app.post('/api/invites', auth, active, async (c) => {
  if (!requireAdmin(c)) return bad(c, 'adminOnly', 403)
  const me = c.get('me')
  const b = (await c.req.json().catch(() => ({}))) as {
    role?: string
    days?: number
    maxUses?: number | null
  }
  const role = ['warga', 'satpam', 'admin'].includes(b.role ?? '') ? b.role! : 'warga'

  let code = ''
  do {
    code = Array.from(
      { length: 6 },
      () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)],
    ).join('')
  } while (db.prepare('SELECT 1 FROM invites WHERE code=?').get(code))

  const id = uid('i_')
  db.prepare(
    `INSERT INTO invites (id,community_id,code,role,created_by,created_at,expires_at,used_by,max_uses)
     VALUES (?,?,?,?,?,?,?,'[]',?)`,
  ).run(
    id,
    me.community_id,
    code,
    role,
    me.id,
    now(),
    now() + (b.days ?? 7) * DAY,
    b.maxUses ?? null,
  )
  audit(me.community_id, me.id, 'invite.create', `${role} · ${code}`)
  return c.json({ invite: { id, code, role, expiresAt: now() + (b.days ?? 7) * DAY } }, 201)
})

app.delete('/api/invites/:id', auth, active, (c) => {
  if (!requireAdmin(c)) return bad(c, 'adminOnly', 403)
  const me = c.get('me')
  const inv = db.prepare('SELECT * FROM invites WHERE id=?').get(c.req.param('id')) as
    | Record<string, unknown>
    | undefined
  if (!inv || !sameCommunity(me, inv.community_id as string))
    return bad(c, 'forbidden', 403)
  db.prepare('UPDATE invites SET revoked_at=? WHERE id=?').run(now(), inv.id)
  return c.json({ ok: true })
})

/* ================= penanggung jawab operasional ================= */

/**
 * Pendiri tenant (atau superadmin) menunjuk Admin 1/2/3 berdasarkan mandat.
 * Pengguna yang ditunjuk harus admin aktif dari tenant yang sama; ID lintas
 * tenant atau akun satpam/warga tidak pernah dapat dijadikan pemegang mandat.
 */
app.put('/api/management-responsibilities/:scope', auth, active, async (c) => {
  const me = c.get('me')
  const scope = c.req.param('scope')
  if (!isManagementScope(scope)) return bad(c, 'invalid_scope')

  const body = (await c.req.json().catch(() => ({}))) as {
    memberId?: string
    /** Hanya dipakai konsol superadmin; admin tenant selalu memakai tenant sendiri. */
    communityId?: string
  }
  const targetCommunityId = me.role === 'superadmin' ? body.communityId : me.community_id
  if (!targetCommunityId || !canAssignManagementResponsibilities(me, targetCommunityId))
    return bad(c, 'forbidden', 403)
  if (!body.memberId) return bad(c, 'errRequired')
  const responsibility = assignManagementResponsibility(me, scope, body.memberId, targetCommunityId)
  if (!responsibility) return bad(c, 'invalid_admin', 422)

  audit(targetCommunityId, me.id, 'management.responsibility.assign', `${scope} → ${body.memberId}`)
  publishCommunityEvent(targetCommunityId, 'management.updated', scope)
  return c.json({ responsibility })
})

/* ================= kependudukan / kartu keluarga ================= */

function populationFailure(c: Context, error: unknown) {
  if (!(error instanceof PopulationError)) return bad(c, 'population_unavailable', 500)
  const status = error.code === 'not_found' ? 404 : error.code === 'forbidden' ? 403 : 422
  return bad(c, error.code, status)
}

app.get('/api/population', auth, active, (c) => {
  try {
    return c.json(populationOverview(c.get('me')))
  } catch (error) {
    return populationFailure(c, error)
  }
})

app.put('/api/population/households/:id/head', auth, active, async (c) => {
  const me = c.get('me')
  const body = (await c.req.json().catch(() => ({}))) as { memberId?: unknown }
  try {
    const household = setHouseholdHead(me, c.req.param('id') ?? '', body.memberId)
    audit(me.community_id, me.id, 'population.household.head', household.id)
    publishCommunityEvent(me.community_id, 'population.updated', household.id)
    return c.json({ household })
  } catch (error) {
    return populationFailure(c, error)
  }
})

app.put('/api/population/households/:id/audience', auth, active, async (c) => {
  const me = c.get('me')
  const body = (await c.req.json().catch(() => ({}))) as { rt?: unknown; rw?: unknown; block?: unknown }
  try {
    updateHouseholdArea(me, c.req.param('id') ?? '', body)
    audit(me.community_id, me.id, 'population.household.audience', c.req.param('id') ?? '')
    publishCommunityEvent(me.community_id, 'population.updated', c.req.param('id') ?? '')
    return c.json({ ok: true })
  } catch (error) {
    return populationFailure(c, error)
  }
})

app.put('/api/population/members/:id', auth, active, async (c) => {
  const me = c.get('me')
  const body = (await c.req.json().catch(() => ({}))) as { relationship?: unknown; birthDate?: unknown }
  try {
    const memberId = c.req.param('id') ?? ''
    updatePopulationMember(me, memberId, body)
    audit(me.community_id, me.id, 'population.member.update', memberId)
    publishCommunityEvent(me.community_id, 'population.updated', memberId)
    return c.json({ ok: true })
  } catch (error) {
    return populationFailure(c, error)
  }
})

/* ================= area lingkungan ================= */

/**
 * Ganti nama lingkungan.
 *
 * Nama ini tampil di bagian atas aplikasi setiap warga, jadi lingkungan
 * yang terlanjur bernama salah perlu bisa diperbaiki. Aturannya sama
 * dengan saat mendaftar: wajib diisi, dan bukan nama orang yang mengubah.
 */
app.put('/api/community/name', auth, active, async (c) => {
  if (!requireAdmin(c)) return bad(c, 'adminOnly', 403)
  const me = c.get('me')
  const b = (await c.req.json().catch(() => ({}))) as {
    name?: string
    city?: string
  }

  const nama = (b.name ?? '').trim().slice(0, 80)
  if (!nama) return bad(c, 'errCommunityName')
  if (nama.toLowerCase() === me.name.trim().toLowerCase())
    return bad(c, 'errCommunityNameIsPerson')

  const before = db
    .prepare('SELECT name, city FROM communities WHERE id=?')
    .get(me.community_id) as { name: string; city: string } | undefined
  if (!before) return bad(c, 'errNoCommunity', 404)

  // Kota ikut bisa diperbaiki; bila tidak dikirim, biarkan apa adanya.
  const kota = b.city === undefined ? before.city : b.city.trim().slice(0, 80)

  db.prepare('UPDATE communities SET name=?, city=? WHERE id=?').run(
    nama,
    kota,
    me.community_id,
  )
  audit(me.community_id, me.id, 'community.rename', `${before.name} -> ${nama}`)
  return c.json({ ok: true, name: nama, city: kota })
})

app.put('/api/community/area', auth, active, async (c) => {
  const me = c.get('me')
  if (!canManageScope(me, 'map_patrol')) return bad(c, 'forbidden', 403)
  const b = (await c.req.json()) as { area?: LatLng[] }
  const area = Array.isArray(b.area) ? b.area : []
  const center =
    area.length > 0
      ? {
          lat: area.reduce((s, p) => s + p.lat, 0) / area.length,
          lng: area.reduce((s, p) => s + p.lng, 0) / area.length,
        }
      : undefined
  db.prepare(
    `UPDATE communities SET area=?, area_updated_at=?, area_updated_by=?
     ${center ? ', center=?' : ''} WHERE id=?`,
  ).run(
    ...[
      JSON.stringify(area),
      now(),
      me.id,
      ...(center ? [JSON.stringify(center)] : []),
      me.community_id,
    ],
  )
  audit(me.community_id, me.id, 'area.save', `${area.length} titik`)
  publishCommunityEvent(me.community_id!, 'community.map.updated', '')
  return c.json({ ok: true })
})

/* ================= peringatan darurat ================= */

/** Siapa yang menerima peringatan anggota ini. Tanpa polisi. */
/**
 * Siapa saja yang dikabari saat tombol darurat ditekan.
 *
 * Selalu: keluarga, teman tepercaya, satpam, dan pengurus.
 * Ditambah: warga di sekitar lokasi kejadian (lihat server/nearby.ts) —
 * merekalah yang bisa tiba lebih dulu daripada siapa pun.
 */
function alertAudience(
  me: MemberRow,
  at: LatLng | null = null,
  accuracy: number | null = null,
) {
  const out: {
    id: string
    name: string
    phone: string
    kind: string
    memberId: string | null
    /** Jarak dari lokasi kejadian, bila orang ini dipanggil karena dekat. */
    meters?: number
    /** 'live' = posisi terkini, 'home' = letak rumahnya. */
    basis?: 'live' | 'home'
  }[] = []
  const seen = new Set<string>()
  const push = (r: (typeof out)[number]) => {
    const key = r.memberId ?? r.phone.replace(/\D/g, '') ?? r.id
    if (!key || seen.has(key)) return
    seen.add(key)
    out.push(r)
  }

  const contacts = db
    .prepare(
      `SELECT * FROM contacts WHERE community_id=?
       AND (owner_id=? OR (owner_id IS NULL AND verified=1))`,
    )
    .all(me.community_id, me.id) as Record<string, unknown>[]
  for (const ct of contacts)
    push({
      id: ct.id as string,
      name: ct.name as string,
      phone: ct.phone as string,
      kind: ct.kind as string,
      memberId: (ct.member_id as string) ?? null,
    })

  const staff = db
    .prepare(
      `SELECT * FROM members WHERE community_id=? AND status='active' AND id<>?
       AND role IN ('satpam','admin')`,
    )
    .all(me.community_id, me.id) as MemberRow[]
  for (const s of staff)
    push({
      id: s.id,
      name: s.name,
      phone: s.phone,
      kind: s.role === 'satpam' ? 'guard' : 'responder',
      memberId: s.id,
    })

  /*
   * Warga di sekitar lokasi. Satpam sudah masuk lewat daftar di atas,
   * tetapi jarak mereka tetap dihitung agar yang terdekat terlihat lebih
   * dulu oleh pengirim.
   */
  if (at) {
    /*
     * Ambil siapa pun yang punya salah satu titik: posisi terkini ATAU
     * letak rumah. Rumahlah yang membuat warga tetap terpanggil ketika
     * aplikasinya sedang tertutup.
     */
    const rows = db
      .prepare(
        `SELECT id, name, phone, role,
                last_lat, last_lng, last_seen_at, last_accuracy,
                home_lat, home_lng, home_accuracy
         FROM members
         WHERE community_id=? AND status='active' AND id<>?
           AND (last_lat IS NOT NULL OR home_lat IS NOT NULL)`,
      )
      .all(me.community_id, me.id) as NearbyRow[]

    for (const hit of nearbyMembers(at, accuracy, rows)) {
      push({
        id: hit.member.id,
        name: hit.member.name,
        phone: hit.member.phone,
        kind: hit.member.role === 'satpam' ? 'guard' : 'neighbour',
        memberId: hit.member.id,
        meters: hit.meters,
        basis: hit.basis,
      })
    }
  }

  return out
}

/**
 * Anggota melaporkan posisi terakhirnya.
 *
 * Dipakai hanya untuk menentukan siapa yang berada di dekat sebuah
 * peringatan darurat. Yang disimpan cuma SATU titik terakhir, menimpa
 * yang sebelumnya — bukan riwayat perjalanan, agar tidak menjadi alat
 * pelacak pergerakan warga.
 */
app.post('/api/me/location', auth, active, async (c) => {
  const me = c.get('me')
  const b = (await c.req.json().catch(() => ({}))) as {
    lat?: number
    lng?: number
    accuracy?: number | null
  }
  if (typeof b.lat !== 'number' || typeof b.lng !== 'number')
    return bad(c, 'errRequired')
  if (Math.abs(b.lat) > 90 || Math.abs(b.lng) > 180) return bad(c, 'errRequired')

  db.prepare(
    'UPDATE members SET last_lat=?, last_lng=?, last_accuracy=?, last_seen_at=? WHERE id=?',
  ).run(b.lat, b.lng, b.accuracy ?? null, now(), me.id)
  return c.json({ ok: true })
})

/**
 * Menandai letak rumah warga.
 *
 * Dicatat SEKALI saat mendaftar. Rumah tidak berpindah, jadi satu titik
 * cukup untuk selamanya: inilah yang membuat warga tetap terhitung
 * sebagai tetangga terdekat walaupun aplikasinya tertutup, tanpa perlu
 * melacak pergerakannya sama sekali.
 *
 * Bila titiknya meleset — mis. GPS sedang buruk saat mendaftar — warga
 * bisa menandainya ulang sendiri ('manual').
 */
app.post('/api/me/home', auth, active, async (c) => {
  const me = c.get('me')
  const b = (await c.req.json().catch(() => ({}))) as {
    lat?: number
    lng?: number
    accuracy?: number | null
    source?: string
  }
  if (typeof b.lat !== 'number' || typeof b.lng !== 'number')
    return bad(c, 'errRequired')
  if (Math.abs(b.lat) > 90 || Math.abs(b.lng) > 180) return bad(c, 'errRequired')

  const source = b.source === 'register' ? 'register' : 'manual'

  const lama = db
    .prepare('SELECT home_source FROM members WHERE id=?')
    .get(me.id) as { home_source: string | null } | undefined

  /*
   * Titik yang ditandai warga sendiri tidak boleh tergeser oleh
   * pembacaan otomatis saat mendaftar — mis. bila ia mendaftar ulang di
   * perangkat baru dari tempat lain.
   */
  if (lama?.home_source === 'manual' && source !== 'manual')
    return c.json({ ok: true, kept: true })

  db.prepare(
    'UPDATE members SET home_lat=?, home_lng=?, home_accuracy=?, home_set_at=?, home_source=? WHERE id=?',
  ).run(b.lat, b.lng, b.accuracy ?? null, now(), source, me.id)
  audit(me.community_id, me.id, 'home.set', source)
  return c.json({ ok: true })
})

/** Anggota menghapus letak rumahnya. */
app.delete('/api/me/home', auth, active, (c) => {
  db.prepare(
    'UPDATE members SET home_lat=NULL, home_lng=NULL, home_accuracy=NULL, home_set_at=NULL, home_source=NULL WHERE id=?',
  ).run(c.get('me').id)
  return c.json({ ok: true })
})

/** Anggota menghapus posisi tersimpannya. */
app.delete('/api/me/location', auth, active, (c) => {
  db.prepare(
    'UPDATE members SET last_lat=NULL, last_lng=NULL, last_accuracy=NULL, last_seen_at=NULL WHERE id=?',
  ).run(c.get('me').id)
  return c.json({ ok: true })
})

app.get('/api/alerts/audience', auth, active, (c) => {
  // Boleh disertai lokasi, agar pengirim melihat siapa yang akan dipanggil
  // karena berada di dekatnya.
  const lat = Number(c.req.query('lat'))
  const lng = Number(c.req.query('lng'))
  const acc = Number(c.req.query('accuracy'))
  const at =
    Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
  return c.json({
    audience: alertAudience(c.get('me'), at, Number.isFinite(acc) ? acc : null),
  })
})

const alertSchema = z.object({
  category: z.enum(['theft', 'fight', 'medical', 'fire', 'flood', 'other']),
  at: z
    .object({
      lat: z.number().finite().min(-90).max(90),
      lng: z.number().finite().min(-180).max(180),
    })
    .nullable()
    .optional(),
  accuracy: z.number().finite().min(0).max(100_000).nullable().optional(),
  // Stabil selama retry satu tombol, tetapi bukan ID yang dipakai sebagai
  // authorization. Server tetap menentukan author dan tenant dari token.
  idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/).optional(),
})

app.post('/api/alerts', auth, active, async (c) => {
  const me = c.get('me')
  if (!me.community_id) return bad(c, 'errNoCommunity')
  const parsed = alertSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return bad(c, 'errRequired')
  const b = parsed.data

  // Retry dari browser/proxy tidak boleh menggandakan satu keadaan darurat.
  if (b.idempotencyKey) {
    const existing = db
      .prepare('SELECT * FROM reports WHERE author_id=? AND idempotency_key=?')
      .get(me.id, b.idempotencyKey) as Record<string, unknown> | undefined
    if (existing) {
      return c.json({
        report: mapReport(existing, me, timelineForIncident(String(existing.id))),
        reused: true,
      })
    }
  }

  const com = db
    .prepare('SELECT * FROM communities WHERE id=?')
    .get(me.community_id) as Record<string, unknown>
  const area: LatLng[] = J(com.area as string) ?? []
  const at = b.at ?? null
  const inside = area.length >= 3 && at ? pointInPolygon(at, area) : null

  const audience = alertAudience(me, at, b.accuracy ?? null)
  const id = uid('r_')
  const createdAt = now()

  // Snapshot medis harus tetap mencerminkan saat tombol ditekan, bukan
  // profil yang mungkin diubah setelah insiden selesai. Bila profil lama
  // rusak, darurat tetap dikirim — jangan jadikan data nonkritis sebagai
  // alasan menahan alarm — tetapi jangan mengaku data medisnya kosong.
  let emergency = {}
  try {
    emergency = decryptSensitiveJson<Record<string, unknown>>(me.emergency) ?? {}
  } catch {
    audit(me.community_id, me.id, 'emergency_profile.unreadable', '')
  }
  const snapshot = { name: me.name, phone: me.phone, house: me.house, ...emergency }

  try {
    db.prepare(
      `INSERT INTO reports
       (id,community_id,author_id,kind,category,note,at_lat,at_lng,address,status,
        created_at,inside_area,attachments,messages,responders,track,live,
        audio_seconds,snapshot,recipients,incident_status,idempotency_key)
       VALUES (?,?,?,'sos',?,'',?,?,?,'open',?,?,?,?,?,?,1,0,?,?,'NEW',?)`,
    ).run(
      id,
      me.community_id,
      me.id,
      b.category,
      at?.lat ?? null,
      at?.lng ?? null,
      me.house,
      createdAt,
      inside === null ? null : inside ? 1 : 0,
      encryptSensitiveJson([]),
      encryptSensitiveJson([]),
      encryptSensitiveJson([]),
      encryptSensitiveJson(
        at ? [{ lat: at.lat, lng: at.lng, at: createdAt, accuracy: b.accuracy ?? null }] : [],
      ),
      encryptSensitiveJson(snapshot),
      // Nama field deliveredAt dipertahankan untuk kompatibilitas klien lama,
      // tetapi nilainya berarti penerima DITETAPKAN server. Hasil Web Push
      // dicatat terpisah di audit alert.push_dispatch dan bukan delivery proof.
      encryptSensitiveJson(
        audience.map((a) => ({ ...a, deliveredAt: createdAt, acknowledgedAt: null })),
      ),
      b.idempotencyKey ?? null,
    )
  } catch (error) {
    // Indeks unik adalah pengaman terakhir jika dua retry tiba pada saat yang
    // sama. Kembalikan insiden pertama, bukan menciptakan insiden kedua.
    if (b.idempotencyKey) {
      const existing = db
        .prepare('SELECT * FROM reports WHERE author_id=? AND idempotency_key=?')
        .get(me.id, b.idempotencyKey) as Record<string, unknown> | undefined
      if (existing)
        return c.json({
          report: mapReport(existing, me, timelineForIncident(String(existing.id))),
          reused: true,
        })
    }
    throw error
  }

  addIncidentTimeline({
    incidentId: id,
    communityId: me.community_id,
    actorId: me.id,
    kind: 'incident.created',
    toStatus: 'NEW',
    detail: b.category,
    at: createdAt,
  })
  audit(me.community_id, me.id, 'alert.raise', `${b.category} → ${audience.length}`)
  publishCommunityEvent(me.community_id, 'incident.created', id)

  // Notifikasi push mendesak ke semua penerima yang punya akun.
  // Tetangga terdekat diberi tahu jaraknya: itu yang menentukan apakah
  // mereka bisa tiba lebih dulu daripada siapa pun.
  const dekat = audience.filter((a) => a.memberId && a.meters !== undefined)
  const jauh = audience.filter((a) => a.memberId && a.meters === undefined)

  const dispatches = [
    pushToMembers(
      jauh.map((a) => a.memberId!),
      {
        title: `🆘 DARURAT — ${me.name}`,
        body: `${me.house}. Buka aplikasi untuk melihat lokasi.`,
        url: `#/app/reports?id=${id}`,
        tag: `sos-${id}`,
        urgent: true,
      },
    ),
  ]

  for (const a of dekat) {
    // Jangan mengaku tahu lebih banyak daripada yang sebenarnya: bila
    // dasarnya letak rumah, orangnya belum tentu sedang berada di sana.
    const judul =
      a.basis === 'live'
        ? `🆘 DARURAT ${a.meters} m dari Anda`
        : `🆘 DARURAT ${a.meters} m dari rumah Anda`
    dispatches.push(
      pushToMembers([a.memberId!], {
        title: judul,
        body: `${me.name} · ${me.house}. Anda termasuk yang paling dekat.`,
        url: `#/app/reports?id=${id}`,
        tag: `sos-${id}`,
        urgent: true,
      }),
    )
  }

  // Catat hasil transport secara asinkron. `accepted` hanya berarti layanan
  // Web Push menerima request; aplikasi tidak pernah menyamakan ini dengan
  // perangkat/manusia yang sudah menerima atau membaca alarm.
  void Promise.all(dispatches)
    .then((results) => {
      const total = results.reduce(
        (sum, result) => ({
          targets: sum.targets + result.targets,
          subscriptions: sum.subscriptions + result.subscriptions,
          accepted: sum.accepted + result.sent,
          failed: sum.failed + result.failed,
          enabled: sum.enabled || result.enabled,
        }),
        { targets: 0, subscriptions: 0, accepted: 0, failed: 0, enabled: false },
      )
      audit(
        me.community_id,
        me.id,
        'alert.push_dispatch',
        `recipients=${audience.length}; member_targets=${total.targets}; subscriptions=${total.subscriptions}; accepted_by_push_service=${total.accepted}; failed=${total.failed}; enabled=${total.enabled}`,
      )
      publishCommunityEvent(me.community_id, 'incident.updated', id)
    })
    .catch(() => {
      // Alarm sudah tersimpan; catat kegagalan accounting tanpa pernah
      // mengubah status SOS menjadi gagal/terkirim palsu.
      audit(me.community_id, me.id, 'alert.push_dispatch_error', `recipients=${audience.length}`)
    })

  const row = db.prepare('SELECT * FROM reports WHERE id=?').get(id) as Record<
    string,
    unknown
  >
  return c.json({ report: mapReport(row, me, timelineForIncident(id)) }, 201)
})

/** Pemilik peringatan mengirim titik lokasi terbaru. */
app.post('/api/alerts/:id/location', auth, active, async (c) => {
  const me = c.get('me')
  const r = db.prepare('SELECT * FROM reports WHERE id=?').get(c.req.param('id')) as
    | Record<string, unknown>
    | undefined
  if (!r || r.kind !== 'sos') return bad(c, 'not_found', 404)
  if (r.author_id !== me.id) return bad(c, 'forbidden', 403)
  if (!r.live) return c.json({ ok: true, ignored: true })

  const b = (await c.req.json().catch(() => ({}))) as { lat?: number; lng?: number; accuracy?: number }
  if (
    !Number.isFinite(b.lat) ||
    !Number.isFinite(b.lng) ||
    (b.lat as number) < -90 ||
    (b.lat as number) > 90 ||
    (b.lng as number) < -180 ||
    (b.lng as number) > 180 ||
    (b.accuracy !== undefined && (!Number.isFinite(b.accuracy) || b.accuracy < 0 || b.accuracy > 100_000))
  )
    return bad(c, 'errRequired')
  const lat = b.lat as number
  const lng = b.lng as number
  const accuracy = b.accuracy ?? null
  const track = secureArray<{
    lat: number
    lng: number
    at: number
    accuracy: number | null
  }>(r.track)
  const last = track[track.length - 1]
  if (!last || last.lat !== lat || last.lng !== lng) {
    track.push({ lat, lng, at: now(), accuracy })
    if (track.length > 500) track.shift()
    db.prepare('UPDATE reports SET track=?, at_lat=?, at_lng=? WHERE id=?').run(
      encryptSensitiveJson(track),
      lat,
      lng,
      r.id,
    )
    publishCommunityEvent(r.community_id as string, 'incident.updated', String(r.id))
  }
  return c.json({ ok: true })
})

/**
 * Peserta menerima dan langsung mulai menuju lokasi. Endpoint lama /ack
 * dipertahankan sebagai alias agar aplikasi versi sebelumnya tidak putus.
 */
function respondToAlert(c: Context<Env>, r: Record<string, unknown>) {
  const me = c.get('me')
  if (!sameCommunity(me, r.community_id as string)) return bad(c, 'forbidden', 403)

  const recipients = secureArray<{
    memberId: string | null
    acknowledgedAt: number | null
  }>(r.recipients)
  const rec = recipients.find((x) => x.memberId === me.id)
  const privileged = requireAdmin(c) || me.role === 'satpam'
  if (!rec && !privileged) return bad(c, 'forbidden', 403)

  const responders = secureArray<string>(r.responders)
  const at = now()
  if (rec && !rec.acknowledgedAt) rec.acknowledgedAt = at
  if (!responders.includes(me.id)) responders.push(me.id)

  db.prepare(
    `UPDATE reports SET recipients=?, responders=?, handled_by=COALESCE(handled_by, ?),
     handled_at=COALESCE(handled_at, ?) WHERE id=? AND community_id=?`,
  ).run(encryptSensitiveJson(recipients), encryptSensitiveJson(responders), me.id, at, r.id, r.community_id)

  let current = isIncidentStatus(r.incident_status)
    ? r.incident_status
    : initialIncidentStatus(r.status)
  try {
    // "Saya menuju lokasi" mencatat dua langkah yang berbeda dalam timeline:
    // penerimaan dan keberangkatan. Status akhir yang terlihat adalah
    // RESPONDING, tanpa menunggu tindakan tambahan dari satpam.
    if (current === 'NEW') {
      transitionIncident({
        incidentId: String(r.id),
        communityId: String(r.community_id),
        actorId: me.id,
        from: current,
        to: 'ACKNOWLEDGED',
        kind: 'incident.acknowledged',
      })
      current = 'ACKNOWLEDGED'
    }
    if (current === 'ACKNOWLEDGED') {
      transitionIncident({
        incidentId: String(r.id),
        communityId: String(r.community_id),
        actorId: me.id,
        from: current,
        to: 'RESPONDING',
        kind: 'incident.responding',
      })
    }
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('invalid_transition')) throw error
  }

  audit(r.community_id as string, me.id, 'alert.respond', String(r.id))
  publishCommunityEvent(r.community_id as string, 'incident.updated', String(r.id))
  void pushToMembers([r.author_id as string], {
    title: 'Bantuan menuju lokasi',
    body: `${me.name} sedang menuju lokasi Anda.`,
    url: '#/app',
    tag: `ack-${r.id}`,
  })
  return c.json({ ok: true })
}

app.post('/api/alerts/:id/respond', auth, active, (c) => {
  const r = db.prepare('SELECT * FROM reports WHERE id=?').get(c.req.param('id')) as
    | Record<string, unknown>
    | undefined
  if (!r || r.kind !== 'sos') return bad(c, 'not_found', 404)
  return respondToAlert(c, r)
})

app.post('/api/alerts/:id/ack', auth, active, (c) => {
  const r = db.prepare('SELECT * FROM reports WHERE id=?').get(c.req.param('id')) as
    | Record<string, unknown>
    | undefined
  if (!r || r.kind !== 'sos') return bad(c, 'not_found', 404)
  return respondToAlert(c, r)
})

/**
 * Ubah status lifecycle secara eksplisit (mis. satpam tiba di lokasi).
 */
app.post('/api/alerts/:id/status', auth, active, async (c) => {
  const me = c.get('me')
  const r = db.prepare('SELECT * FROM reports WHERE id=?').get(c.req.param('id')) as
    | Record<string, unknown>
    | undefined
  if (!r || r.kind !== 'sos' || !sameCommunity(me, r.community_id as string))
    return bad(c, 'forbidden', 403)

  const body = (await c.req.json().catch(() => ({}))) as { status?: unknown }
  if (!isIncidentStatus(body.status)) return bad(c, 'errRequired')
  const target = body.status
  const current = isIncidentStatus(r.incident_status)
    ? r.incident_status
    : initialIncidentStatus(r.status)
  const isOwner = r.author_id === me.id
  const recipients = secureArray<{ memberId: string | null }>(r.recipients)
  const isParticipant = recipients.some((recipient) => recipient.memberId === me.id)
  const privileged = requireAdmin(c) || me.role === 'satpam'

  // Pelapor dapat membatalkan alarm palsu atau menandai dirinya aman, tetapi
  // tidak bisa mengaku sudah tiba di lokasi. CLOSED adalah penutupan admin.
  if (
    (target === 'CANCELLED' && !isOwner && !privileged) ||
    (target === 'CLOSED' && !requireAdmin(c)) ||
    (target !== 'CANCELLED' && target !== 'CLOSED' && !isOwner && !isParticipant && !privileged) ||
    (isOwner && ['ACKNOWLEDGED', 'RESPONDING', 'ON_SITE'].includes(target))
  ) {
    return bad(c, 'forbidden', 403)
  }

  try {
    transitionIncident({
      incidentId: String(r.id),
      communityId: String(r.community_id),
      actorId: me.id,
      from: current,
      to: target,
      kind: target === 'CANCELLED' ? 'incident.cancelled' : 'incident.status_changed',
    })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('invalid_transition'))
      return bad(c, 'invalid_transition', 409)
    if (error instanceof Error && error.message === 'incident_changed')
      return bad(c, 'incident_changed', 409)
    throw error
  }

  audit(r.community_id as string, me.id, 'alert.status', `${current} → ${target}`)
  publishCommunityEvent(r.community_id as string, 'incident.updated', String(r.id))
  return c.json({ ok: true, status: target })
})

/**
 * Kirim pesan pada utas sebuah peringatan.
 *
 * Utas ini dipakai untuk berkoordinasi selama kejadian berlangsung —
 * "sudah sampai gerbang", "pelaku ke arah utara". Sebelumnya balasan
 * hanya tersimpan di perangkat pengirim, jadi tidak pernah terlihat oleh
 * siapa pun. Diam-diam gagal seperti itu berbahaya saat darurat.
 *
 * Yang boleh menulis: pelapor sendiri, penerima peringatan, satpam, dan
 * pengurus — sama seperti yang boleh menutupnya.
 */
app.post('/api/alerts/:id/messages', auth, active, async (c) => {
  const me = c.get('me')
  const r = db.prepare('SELECT * FROM reports WHERE id=?').get(c.req.param('id')) as
    | Record<string, unknown>
    | undefined
  if (!r || r.kind !== 'sos') return bad(c, 'not_found', 404)
  if (!sameCommunity(me, r.community_id as string)) return bad(c, 'forbidden', 403)

  const isOwner = r.author_id === me.id
  const recipients = secureArray<{ memberId: string | null }>(r.recipients)
  const isRecipient = recipients.some((x) => x.memberId === me.id)
  if (!isOwner && !isRecipient && !requireAdmin(c) && me.role !== 'satpam')
    return bad(c, 'forbidden', 403)

  const b = (await c.req.json().catch(() => ({}))) as { body?: string }
  const body = (b.body ?? '').trim().slice(0, 1000)
  if (!body) return bad(c, 'errRequired')

  const messages = secureArray<unknown>(r.messages)
  // Batasi agar satu utas tidak tumbuh tanpa henti.
  if (messages.length >= 500) messages.shift()

  const msg = { id: uid('im_'), from: me.id, body, at: now(), system: false }
  messages.push(msg)
  db.prepare('UPDATE reports SET messages=? WHERE id=?').run(
    encryptSensitiveJson(messages),
    r.id,
  )

  /*
   * Beri tahu peserta lain — pelapor dan para penanggap. Tanpa ini,
   * pesan hanya terlihat oleh yang kebetulan sedang membuka layarnya.
   */
  const responders = secureArray<string>(r.responders)
  const tujuan = new Set<string>([r.author_id as string, ...responders])
  tujuan.delete(me.id)
  if (tujuan.size > 0)
    void pushToMembers([...tujuan], {
      title: `${me.name}`,
      body,
      url: `#/app/reports?id=${r.id}`,
      tag: `im-${r.id}`,
    })

  audit(r.community_id as string, me.id, 'alert.message', String(r.id))
  publishCommunityEvent(r.community_id as string, 'incident.message', String(r.id))
  return c.json({ message: msg }, 201)
})

/**
 * Lampirkan foto bukti pada sebuah peringatan.
 *
 * Sebelumnya foto hanya tersimpan di perangkat pengirim, jadi tidak
 * pernah sampai ke penolong maupun pengurus — bukti yang tidak terlihat
 * siapa pun sama saja tidak ada.
 *
 * Berbeda dengan pesan teks, gambar bisa sangat besar dan mudah membuat
 * basis data membengkak, jadi batasnya ditegakkan di sini: klien memang
 * sudah mengecilkan gambar, tetapi server tidak boleh mempercayainya.
 */
app.post('/api/alerts/:id/attachments', auth, active, async (c) => {
  const me = c.get('me')
  const r = db.prepare('SELECT * FROM reports WHERE id=?').get(c.req.param('id')) as
    | Record<string, unknown>
    | undefined
  if (!r || r.kind !== 'sos') return bad(c, 'not_found', 404)
  if (!sameCommunity(me, r.community_id as string)) return bad(c, 'forbidden', 403)

  const isOwner = r.author_id === me.id
  const recipients = secureArray<{ memberId: string | null }>(r.recipients)
  const isRecipient = recipients.some((x) => x.memberId === me.id)
  if (!isOwner && !isRecipient && !requireAdmin(c) && me.role !== 'satpam')
    return bad(c, 'forbidden', 403)

  const b = (await c.req.json().catch(() => ({}))) as {
    dataUrl?: string
    kind?: string
  }
  const dataUrl = b.dataUrl ?? ''

  // Hanya gambar, dan hanya jenis yang memang bisa ditampilkan.
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!m) return bad(c, 'errAttachType')

  const bytes = Math.floor((m[2].length * 3) / 4)
  if (bytes > ATTACH_MAX_BYTES) return bad(c, 'errAttachTooBig')

  const list = secureArray<unknown>(r.attachments)
  if (list.length >= ATTACH_MAX_COUNT) return bad(c, 'errAttachTooMany')

  const att = {
    id: uid('at_'),
    kind: 'photo',
    dataUrl,
    at: now(),
    bytes,
    by: me.id,
  }
  list.push(att)
  db.prepare('UPDATE reports SET attachments=? WHERE id=?').run(
    encryptSensitiveJson(list),
    r.id,
  )
  audit(r.community_id as string, me.id, 'alert.attach', String(bytes))
  publishCommunityEvent(r.community_id as string, 'incident.evidence', String(r.id))
  return c.json({ attachment: att }, 201)
})

/** Alias kompatibilitas untuk aplikasi lama: false alarm → CANCELLED, lainnya → RESOLVED. */
app.post('/api/alerts/:id/close', auth, active, async (c) => {
  const me = c.get('me')
  const r = db.prepare('SELECT * FROM reports WHERE id=?').get(c.req.param('id')) as
    | Record<string, unknown>
    | undefined
  if (!r || r.kind !== 'sos' || !sameCommunity(me, r.community_id as string))
    return bad(c, 'forbidden', 403)

  const body = (await c.req.json().catch(() => ({}))) as { cancelled?: boolean }
  const target: IncidentStatus = body.cancelled ? 'CANCELLED' : 'RESOLVED'
  const isOwner = r.author_id === me.id
  if (!isOwner && !requireAdmin(c) && me.role !== 'satpam') return bad(c, 'forbidden', 403)

  const current = isIncidentStatus(r.incident_status)
    ? r.incident_status
    : initialIncidentStatus(r.status)
  try {
    transitionIncident({
      incidentId: String(r.id),
      communityId: String(r.community_id),
      actorId: me.id,
      from: current,
      to: target,
      kind: target === 'CANCELLED' ? 'incident.cancelled' : 'incident.resolved',
    })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('invalid_transition'))
      return bad(c, 'invalid_transition', 409)
    throw error
  }

  audit(r.community_id as string, me.id, target === 'CANCELLED' ? 'alert.cancel' : 'alert.close', '')
  publishCommunityEvent(r.community_id as string, 'incident.updated', String(r.id))
  return c.json({ ok: true, status: target })
})

/* ================= titik ronda & jadwal ================= */

app.post('/api/checkpoints', auth, active, async (c) => {
  const me = c.get('me')
  if (!canManageScope(me, 'map_patrol')) return bad(c, 'forbidden', 403)
  const b = (await c.req.json()) as {
    name?: string
    lat?: number
    lng?: number
    radiusM?: number
  }
  if (!b.name?.trim() || typeof b.lat !== 'number' || typeof b.lng !== 'number')
    return bad(c, 'errRequired')

  const n = (
    db
      .prepare('SELECT count(*) n FROM checkpoints WHERE community_id=?')
      .get(me.community_id) as { n: number }
  ).n
  const id = uid('cp_')
  db.prepare(
    `INSERT INTO checkpoints (id,community_id,name,lat,lng,radius_m,ord,created_by,created_at,active)
     VALUES (?,?,?,?,?,?,?,?,?,1)`,
  ).run(id, me.community_id, b.name.trim(), b.lat, b.lng, b.radiusM ?? 50, n + 1, me.id, now())
  audit(me.community_id, me.id, 'checkpoint.add', b.name.trim())
  publishCommunityEvent(me.community_id!, 'patrol.checkpoint.updated', id)
  return c.json({ id }, 201)
})

app.delete('/api/checkpoints/:id', auth, active, (c) => {
  const me = c.get('me')
  if (!canManageScope(me, 'map_patrol')) return bad(c, 'forbidden', 403)
  const cp = db
    .prepare('SELECT * FROM checkpoints WHERE id=?')
    .get(c.req.param('id')) as Record<string, unknown> | undefined
  if (!cp || !sameCommunity(me, cp.community_id as string))
    return bad(c, 'forbidden', 403)
  db.prepare('DELETE FROM checkpoints WHERE id=?').run(cp.id)
  audit(me.community_id, me.id, 'checkpoint.remove', String(cp.name))
  publishCommunityEvent(me.community_id!, 'patrol.checkpoint.updated', String(cp.id))
  return c.json({ ok: true })
})

app.post('/api/schedules', auth, active, async (c) => {
  const me = c.get('me')
  if (!canManageScope(me, 'patrol_schedule')) return bad(c, 'forbidden', 403)
  const b = (await c.req.json()) as {
    label?: string
    startMinute?: number
    endMinute?: number
    days?: number[]
    graceMin?: number
    satpamIds?: string[]
  }
  const startMinute = Number(b.startMinute)
  const endMinute = Number(b.endMinute)
  const graceMin = Number(b.graceMin ?? 15)
  const days = Array.isArray(b.days) ? [...new Set(b.days)] : []
  const satpamIds = Array.isArray(b.satpamIds) ? [...new Set(b.satpamIds)].slice(0, 50) : []
  if (
    !b.label?.trim() ||
    !Number.isInteger(startMinute) ||
    !Number.isInteger(endMinute) ||
    startMinute < 0 ||
    startMinute > 1439 ||
    endMinute < 0 ||
    endMinute > 1439 ||
    !Number.isInteger(graceMin) ||
    graceMin < 0 ||
    graceMin > 180 ||
    days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
  )
    return bad(c, 'errRequired')

  // Jangan izinkan Admin 3 menjadwalkan orang dari tenant lain atau peran lain.
  if (satpamIds.length) {
    const marks = satpamIds.map(() => '?').join(',')
    const staff = db
      .prepare(
        `SELECT id FROM members WHERE community_id=? AND status='active'
         AND role='satpam' AND id IN (${marks})`,
      )
      .all(me.community_id, ...satpamIds) as { id: string }[]
    if (staff.length !== satpamIds.length) return bad(c, 'invalid_satpam', 422)
  }

  const id = uid('sc_')
  db.prepare(
    `INSERT INTO schedules
     (id,community_id,label,start_minute,end_minute,days,assigned_satpam_ids,grace_min,active,created_at)
     VALUES (?,?,?,?,?,?,?,?,1,?)`,
  ).run(
    id,
    me.community_id,
    b.label.trim().slice(0, 100),
    startMinute,
    endMinute,
    JSON.stringify(days),
    JSON.stringify(satpamIds),
    graceMin,
    now(),
  )
  audit(me.community_id, me.id, 'patrol.schedule.add', `${b.label.trim()} · ${satpamIds.length} satpam`)
  publishCommunityEvent(me.community_id!, 'patrol.schedule.updated', id)
  return c.json({ id }, 201)
})

app.delete('/api/schedules/:id', auth, active, (c) => {
  const me = c.get('me')
  if (!canManageScope(me, 'patrol_schedule')) return bad(c, 'forbidden', 403)
  const sc = db.prepare('SELECT * FROM schedules WHERE id=?').get(c.req.param('id')) as
    | Record<string, unknown>
    | undefined
  if (!sc || !sameCommunity(me, sc.community_id as string))
    return bad(c, 'forbidden', 403)
  db.prepare('DELETE FROM schedules WHERE id=?').run(sc.id)
  audit(me.community_id, me.id, 'patrol.schedule.remove', String(sc.label))
  publishCommunityEvent(me.community_id!, 'patrol.schedule.updated', String(sc.id))
  return c.json({ ok: true })
})

/** Satu tombol ronda — verifikasi jarak & jadwal di server. */
app.post('/api/patrol/log', auth, active, async (c) => {
  const me = c.get('me')
  if (me.role !== 'satpam' && !requireAdmin(c)) return bad(c, 'forbidden', 403)

  const b = (await c.req.json()) as {
    lat?: number
    lng?: number
    checkpointId?: string
    note?: string
    force?: boolean
    accuracy?: number | null
  }
  if (typeof b.lat !== 'number' || typeof b.lng !== 'number')
    return bad(c, 'gpsNeeded')

  const list = db
    .prepare('SELECT * FROM checkpoints WHERE community_id=? AND active=1 ORDER BY ord')
    .all(me.community_id) as Record<string, unknown>[]
  if (!list.length) return bad(c, 'errNoCheckpoint', 404)

  const at = { lat: b.lat, lng: b.lng }
  let cp: Record<string, unknown> | undefined
  let dist = Infinity
  if (b.checkpointId) {
    cp = list.find((x) => x.id === b.checkpointId)
    if (cp) dist = distanceMeters(at, { lat: cp.lat as number, lng: cp.lng as number })
  } else {
    for (const x of list) {
      const d = distanceMeters(at, { lat: x.lat as number, lng: x.lng as number })
      if (d < dist) {
        dist = d
        cp = x
      }
    }
  }
  if (!cp) return bad(c, 'errNoCheckpoint', 404)

  /*
   * Perhitungkan ketidakpastian GPS, jangan bandingkan jarak mentah.
   *
   * Titik GPS ponsel biasa meleset 10-30 meter di antara bangunan atau
   * di bawah atap pos ronda. Membandingkan jarak mentah dengan radius
   * membuat satpam yang BERDIRI TEPAT di titik ronda ditolak, karena
   * ponselnya melaporkan dirinya 40 m dari sana. Yang benar-benar perlu
   * dijawab adalah: mungkinkah ia berada di dalam radius?
   *
   * Kelonggarannya dibatasi agar tidak menjadi celah: fix yang sangat
   * buruk tidak boleh membuat titik mana pun bisa ditandai dari jauh.
   */
  const acc = Number.isFinite(b.accuracy as number) ? Math.max(0, b.accuracy!) : 0
  const slack = Math.min(GPS_SLACK_MAX_M, acc)
  const radius = (cp.radius_m as number) + slack

  const inside = dist <= radius
  if (!inside && !b.force)
    return c.json(
      { error: 'errTooFar', distanceM: Math.round(dist), allowedM: Math.round(radius) },
      422,
    )

  const recent = db
    .prepare(
      'SELECT 1 FROM patrol_logs WHERE checkpoint_id=? AND satpam_id=? AND abs(? - at) < 300000',
    )
    .get(cp.id, me.id, now())
  if (recent) return bad(c, 'errAlreadyLogged', 409)

  const schedules = db
    .prepare('SELECT * FROM schedules WHERE community_id=?')
    .all(me.community_id) as unknown as Parameters<typeof activeSchedule>[0]
  // Jadwal tanpa nama berlaku untuk seluruh tim. Admin dapat mencatat sebagai
  // pengawas; helper memaksa filter penugasan saat pelakunya seorang satpam.
  const act = activeSchedule(schedules, now(), me.role === 'satpam' ? me.id : undefined)
  const status = act ? (act.late ? 'late' : 'ontime') : 'offschedule'

  const id = uid('pl_')
  db.prepare(
    `INSERT INTO patrol_logs
     (id,community_id,satpam_id,checkpoint_id,checkpoint_name,schedule_id,schedule_label,
      at,lat,lng,distance_m,inside_radius,status,note)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    me.community_id,
    me.id,
    cp.id,
    cp.name,
    act?.schedule.id ?? null,
    act?.schedule.label ?? '',
    now(),
    b.lat,
    b.lng,
    Math.round(dist),
    inside ? 1 : 0,
    status,
    (b.note ?? '').trim(),
  )
  audit(me.community_id, me.id, 'patrol.log', `${cp.name} · ${status}`)
  publishCommunityEvent(me.community_id!, 'patrol.log.created', id)

  const row = db.prepare('SELECT * FROM patrol_logs WHERE id=?').get(id) as Record<
    string,
    unknown
  >
  return c.json({ log: mapLog(row) }, 201)
})

/* ================= kontak tepercaya ================= */

app.post('/api/contacts', auth, active, async (c) => {
  const me = c.get('me')
  const b = (await c.req.json()) as {
    name?: string
    phone?: string
    kind?: string
  }
  if (!b.name?.trim() || !b.phone?.trim()) return bad(c, 'errRequired')
  const community = ['responder', 'guard', 'volunteer'].includes(b.kind ?? '')
  const id = uid('ct_')
  db.prepare(
    `INSERT INTO contacts (id,owner_id,community_id,name,phone,kind,verified,member_id,created_at)
     VALUES (?,?,?,?,?,?,?,NULL,?)`,
  ).run(
    id,
    community ? null : me.id,
    me.community_id,
    b.name.trim(),
    b.phone.trim(),
    b.kind ?? 'family',
    community ? (requireAdmin(c) ? 1 : 0) : 1,
    now(),
  )
  return c.json({ id }, 201)
})

app.delete('/api/contacts/:id', auth, active, (c) => {
  const me = c.get('me')
  const ct = db.prepare('SELECT * FROM contacts WHERE id=?').get(c.req.param('id')) as
    | Record<string, unknown>
    | undefined
  if (!ct) return bad(c, 'not_found', 404)
  // hanya pemilik, atau admin untuk kontak komunitas
  const mine = ct.owner_id === me.id
  if (!mine && !(ct.owner_id === null && requireAdmin(c)))
    return bad(c, 'forbidden', 403)
  db.prepare('DELETE FROM contacts WHERE id=?').run(ct.id)
  return c.json({ ok: true })
})

app.post('/api/contacts/:id/verify', auth, active, async (c) => {
  if (!requireAdmin(c)) return bad(c, 'adminOnly', 403)
  const me = c.get('me')
  const ct = db.prepare('SELECT * FROM contacts WHERE id=?').get(c.req.param('id')) as
    | Record<string, unknown>
    | undefined
  if (!ct || !sameCommunity(me, ct.community_id as string))
    return bad(c, 'forbidden', 403)
  const b = (await c.req.json().catch(() => ({}))) as { verified?: boolean }
  db.prepare('UPDATE contacts SET verified=? WHERE id=?').run(
    b.verified === false ? 0 : 1,
    ct.id,
  )
  return c.json({ ok: true })
})

/* ================= buku tamu ================= */

/** Buku tamu adalah data operasional satpam/admin, bukan cache seluruh warga. */
function canManageGuestBook(me: MemberRow): boolean {
  return me.role === 'admin' || me.role === 'satpam' || me.role === 'superadmin'
}

app.post('/api/guests', auth, active, async (c) => {
  const me = c.get('me')
  if (!me.community_id || !canManageGuestBook(me)) return bad(c, 'forbidden', 403)
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: unknown
    purpose?: unknown
    host?: unknown
    plate?: unknown
    idCard?: unknown
  }
  const clean = (value: unknown, max: number) =>
    typeof value === 'string' ? value.replaceAll('\u0000', '').trim().slice(0, max) : ''
  const name = clean(body.name, 100)
  if (!name) return bad(c, 'invalid_guest', 422)
  const purpose = clean(body.purpose, 300)
  const host = clean(body.host, 120)
  const plate = clean(body.plate, 20).toUpperCase()
  const idCard = clean(body.idCard, 80)
  const id = uid('g_')
  const at = now()
  // Nomor identitas tidak pernah masuk response/cache perangkat. Simpan
  // terenkripsi di produksi agar backup SQLite juga tidak memuat plaintext.
  const protectedIdCard = idCard ? encryptSensitiveJson({ idCard }) : ''
  db.prepare(
    `INSERT INTO guests
     (id,community_id,name,purpose,host,plate,id_card,check_in,recorded_by)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(id, me.community_id, name, purpose, host, plate, protectedIdCard, at, me.id)
  audit(me.community_id, me.id, 'guest.check_in', id)
  publishCommunityEvent(me.community_id, 'guest.updated', id)
  return c.json({ guest: { id, name, purpose, host, plate, checkIn: at } }, 201)
})

app.post('/api/guests/:id/checkout', auth, active, (c) => {
  const me = c.get('me')
  if (!me.community_id || !canManageGuestBook(me)) return bad(c, 'forbidden', 403)
  const id = c.req.param('id') ?? ''
  const at = now()
  const updated = db
    .prepare(
      `UPDATE guests SET check_out=?
       WHERE id=? AND community_id=? AND check_out IS NULL`,
    )
    .run(at, id, me.community_id)
  if (updated.changes !== 1) return bad(c, 'guest_not_available', 409)
  audit(me.community_id, me.id, 'guest.check_out', id)
  publishCommunityEvent(me.community_id, 'guest.updated', id)
  return c.json({ ok: true, checkOut: at })
})

/* ================= pengumuman bertarget ================= */

const ANNOUNCEMENT_TARGETS = ['all', 'rw', 'rt', 'block'] as const

app.post('/api/announcements', auth, active, async (c) => {
  if (!requireAdmin(c)) return bad(c, 'adminOnly', 403)
  const me = c.get('me')
  const body = (await c.req.json().catch(() => ({}))) as {
    title?: unknown
    body?: unknown
    category?: unknown
    targetScope?: unknown
    targetValue?: unknown
    pinned?: unknown
  }
  const title = typeof body.title === 'string' ? body.title.replaceAll('\u0000', '').trim().slice(0, 140) : ''
  const text = typeof body.body === 'string' ? body.body.replaceAll('\u0000', '').trim().slice(0, 2_000) : ''
  const category = typeof body.category === 'string' ? body.category.replaceAll('\u0000', '').trim().slice(0, 50) : ''
  const targetScope = ANNOUNCEMENT_TARGETS.includes(body.targetScope as (typeof ANNOUNCEMENT_TARGETS)[number])
    ? (body.targetScope as (typeof ANNOUNCEMENT_TARGETS)[number])
    : 'all'
  const targetValue = typeof body.targetValue === 'string'
    ? body.targetValue.replaceAll('\u0000', '').trim().slice(0, 30)
    : ''
  if (!title || !category || (targetScope !== 'all' && !targetValue))
    return bad(c, 'invalid_announcement', 422)

  const id = uid('ann_')
  db.prepare(
    `INSERT INTO announcements
     (id,community_id,author_id,title,body,category,target_scope,target_value,pinned,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    me.community_id,
    me.id,
    title,
    text,
    category,
    targetScope,
    targetValue,
    body.pinned === true ? 1 : 0,
    now(),
  )

  const activeMembers = db
    .prepare("SELECT id FROM members WHERE community_id=? AND status='active' AND id<>?")
    .all(me.community_id, me.id) as { id: string }[]
  const recipients = activeMembers
    .filter((member) => memberMatchesAudience(me.community_id!, member.id, targetScope, targetValue))
    .map((member) => member.id)
  audit(me.community_id, me.id, 'announcement.create', `${category} → ${targetScope}${targetValue ? `:${targetValue}` : ''}`)
  // SSE membuat warga yang menjadi target membaca pengumuman tanpa polling.
  // Warga di target lain juga menerima invalidasi kosong; /state menyaring
  // ulang di server, sehingga isi pengumuman tidak pernah bocor.
  publishCommunityEvent(me.community_id, 'community.hub.updated', id)
  void pushToMembers(recipients, {
    title,
    body: text || category,
    url: '#/app/feed',
    tag: `ann-${id}`,
  })
  return c.json({ announcement: { id, title, body: text, category, targetScope, targetValue } }, 201)
})

app.delete('/api/announcements/:id', auth, active, (c) => {
  if (!requireAdmin(c)) return bad(c, 'adminOnly', 403)
  const me = c.get('me')
  const row = db
    .prepare('SELECT id,community_id,title FROM announcements WHERE id=?')
    .get(c.req.param('id')) as { id: string; community_id: string; title: string } | undefined
  if (!row || !sameCommunity(me, row.community_id)) return bad(c, 'forbidden', 403)
  db.prepare('DELETE FROM announcements WHERE id=? AND community_id=?').run(row.id, row.community_id)
  audit(me.community_id, me.id, 'announcement.delete', row.id)
  publishCommunityEvent(me.community_id, 'community.hub.updated', row.id)
  return c.json({ ok: true })
})

/* ================= siaran ================= */

app.post('/api/broadcasts', auth, active, async (c) => {
  if (!requireAdmin(c)) return bad(c, 'adminOnly', 403)
  const me = c.get('me')
  const b = (await c.req.json()) as {
    severity?: string
    title?: string
    body?: string
    instruction?: string
    requireSafetyCheck?: boolean
  }
  if (!b.title?.trim()) return bad(c, 'errRequired')

  const id = uid('b_')
  db.prepare(
    `INSERT INTO broadcasts (id,community_id,author_id,severity,title,body,instruction,require_safety_check,created_at,responses)
     VALUES (?,?,?,?,?,?,?,?,?,'[]')`,
  ).run(
    id,
    me.community_id,
    me.id,
    b.severity ?? 'info',
    b.title.trim(),
    (b.body ?? '').trim(),
    (b.instruction ?? '').trim(),
    b.requireSafetyCheck ? 1 : 0,
    now(),
  )

  const all = db
    .prepare("SELECT id FROM members WHERE community_id=? AND status='active' AND id<>?")
    .all(me.community_id, me.id) as { id: string }[]
  audit(me.community_id, me.id, 'broadcast.create', id)
  publishCommunityEvent(me.community_id, 'broadcast.updated', id)
  void pushToMembers(
    all.map((m) => m.id),
    {
      title: b.title.trim(),
      body: (b.instruction || b.body || '').trim(),
      url: '#/app',
      tag: `bc-${id}`,
      urgent: b.severity === 'critical',
    },
  )
  return c.json({ id }, 201)
})

app.post('/api/broadcasts/:id/respond', auth, active, async (c) => {
  const me = c.get('me')
  const bc = db.prepare('SELECT * FROM broadcasts WHERE id=?').get(c.req.param('id')) as
    | Record<string, unknown>
    | undefined
  if (!bc || !sameCommunity(me, bc.community_id as string))
    return bad(c, 'forbidden', 403)
  const b = (await c.req.json()) as { status?: 'safe' | 'need_help'; note?: string }
  const responses = (J(bc.responses as string) ?? []) as {
    memberId: string
    status: string
    note: string
    at: number
  }[]
  const found = responses.find((r) => r.memberId === me.id)
  const entry = {
    memberId: me.id,
    status: b.status === 'need_help' ? 'need_help' : 'safe',
    note: (b.note ?? '').trim(),
    at: now(),
  }
  if (found) Object.assign(found, entry)
  else responses.push(entry)
  db.prepare('UPDATE broadcasts SET responses=? WHERE id=?').run(
    JSON.stringify(responses),
    bc.id,
  )

  audit(me.community_id, me.id, 'broadcast.safety_response', entry.status)
  publishCommunityEvent(me.community_id, 'broadcast.updated', String(bc.id))

  if (entry.status === 'need_help') {
    const admins = db
      .prepare(
        "SELECT id FROM members WHERE community_id=? AND role IN ('admin','satpam') AND status='active'",
      )
      .all(me.community_id) as { id: string }[]
    void pushToMembers(
      admins.map((a) => a.id),
      {
        title: '🆘 Butuh bantuan',
        body: `${me.name} (${me.house}) meminta bantuan.`,
        url: '#/app/broadcast',
        urgent: true,
      },
    )
  }
  return c.json({ ok: true })
})

/* ================= iuran pengelolaan lingkungan ================= */

/**
 * Iuran warga sengaja berdiri sendiri dari `/api/billing`: yang terakhir
 * adalah langganan SaaS tenant kepada WJW, sedangkan endpoint ini adalah kas
 * operasional sebuah RT/RW/cluster. Pemisahan mencegah uang keduanya tertukar.
 */
app.get('/api/dues', auth, active, (c) => {
  const me = c.get('me')
  if (!me.community_id) return bad(c, 'errNoCommunity', 404)
  const canManage = canManageScope(me, 'dues')
  const invoices = listDuesInvoices(me.community_id, canManage ? undefined : me.id)
  // Daftar penerima adalah kepala keluarga satu-per-alamat, bukan seluruh
  // akun warga. Ini ditegakkan lagi ketika invoice dibuat di dues.ts.
  const members = canManage ? listBillableHouseholdHeads(me.community_id) : []
  const names = new Map(members.map((member) => [member.id, member]))

  return c.json({
    settings: getDuesSettings(me.community_id),
    houseAmounts: canManage ? listDuesHouseAmounts(me.community_id) : [],
    // Warga hanya menerima agregat tagihannya sendiri; total kas dan
    // tunggakan tetangga adalah rincian operasional khusus Admin 2.
    summary: duesSummary(me.community_id, canManage ? undefined : me.id),
    canManage,
    invoices: invoices.map((invoice) => {
      const member = names.get(invoice.memberId)
      // Nama penunggak hanya dikirim kepada Admin 2; warga mendapat tagihan
      // miliknya sendiri tanpa daftar keuangan tetangga.
      return canManage
        ? { ...invoice, memberName: member?.name ?? 'Anggota', memberHouse: member?.house ?? '' }
        : invoice
    }),
    members,
  })
})

app.put('/api/dues/settings', auth, active, async (c) => {
  const me = c.get('me')
  if (!me.community_id || !canManageScope(me, 'dues')) return bad(c, 'forbidden', 403)
  const body = (await c.req.json().catch(() => ({}))) as {
    label?: string
    amount?: number
    dueDay?: number
    paymentInstructions?: string
    autoMonthly?: boolean
  }
  const label = (body.label ?? '').trim().slice(0, 100)
  const amount = Number(body.amount)
  const dueDay = Number(body.dueDay)
  const paymentInstructions = (body.paymentInstructions ?? '').trim().slice(0, 1000)
  if (
    label.length < 3 ||
    !Number.isInteger(amount) ||
    amount < 1_000 ||
    amount > 50_000_000 ||
    !Number.isInteger(dueDay) ||
    dueDay < 1 ||
    dueDay > 28
  )
    return bad(c, 'invalid_dues_settings')

  const settings = saveDuesSettings({
    communityId: me.community_id,
    actorId: me.id,
    label,
    amount,
    dueDay,
    paymentInstructions,
    autoMonthly: body.autoMonthly === true,
  })
  audit(
    me.community_id,
    me.id,
    'dues.settings.update',
    `${label} · ${amount} · tgl ${dueDay}${settings.autoMonthly ? ' · otomatis' : ''}`,
  )
  publishCommunityEvent(me.community_id, 'dues.updated', 'settings')
  return c.json({ settings })
})

/** Rp 150.000 — dipakai di badan notifikasi iuran agar nominalnya terbaca jelas. */
function rupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount)
}

/** 10 Sep 2026, mengikuti zona waktu server (Asia/Jakarta di produksi). */
function tanggalSingkat(at: number): string {
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(at))
}

/**
 * Siapa yang harus tahu ada klaim pembayaran masuk. Penanggung jawab scope
 * 'dues' didahulukan; kalau belum ditunjuk, jatuh ke pendiri komunitas supaya
 * klaim warga tidak menganggur tanpa ada yang memeriksa.
 */
function duesManagerIds(communityId: string): string[] {
  const responsible = listManagementResponsibilities(communityId)
    .filter((item) => item.scope === 'dues' && item.memberId)
    .map((item) => item.memberId as string)
  if (responsible.length) return responsible
  const founders = db
    .prepare(
      "SELECT id FROM members WHERE community_id=? AND role='admin' AND status='active'",
    )
    .all(communityId) as { id: string }[]
  return founders.map((row) => row.id)
}

app.post('/api/dues/invoices/generate', auth, active, async (c) => {
  const me = c.get('me')
  if (!me.community_id || !canManageScope(me, 'dues')) return bad(c, 'forbidden', 403)
  const body = (await c.req.json().catch(() => ({}))) as { period?: string; memberIds?: string[] }
  const memberIds = Array.isArray(body.memberIds) ? body.memberIds.filter((id) => typeof id === 'string') : []
  try {
    const result = generateDuesInvoices({
      communityId: me.community_id,
      actorId: me.id,
      period: body.period ?? '',
      memberIds,
    })
    audit(me.community_id, me.id, 'dues.invoice.generate', `${body.period} · ${result.created} baru`)
    publishCommunityEvent(me.community_id, 'dues.updated', body.period ?? '')
    // Tagihan yang terbit diam-diam adalah tagihan yang terlewat. Hanya yang
    // benar-benar baru yang diberitahukan, supaya menerbitkan ulang periode
    // yang sama tidak membanjiri warga dengan notifikasi berulang.
    const fresh = result.invoices.filter((invoice) => invoice.status === 'unpaid' && invoice.claimedAt === null)
    for (const invoice of fresh) {
      void pushToMembers([invoice.memberId], {
        title: invoice.label,
        body: `${rupiah(invoice.amount)} · jatuh tempo ${tanggalSingkat(invoice.dueAt)}`,
        url: '#/app/dues',
        tag: `dues-${invoice.id}`,
      })
    }
    return c.json(result, 201)
  } catch (error) {
    const code = error instanceof Error ? error.message : 'errUnknown'
    const status = code === 'invalid_member' || code === 'invalid_household_head' ? 422 : 400
    return bad(c, code, status)
  }
})

/** Nominal khusus satu rumah. Kirim amount null untuk mengembalikannya ke nominal umum. */
app.put('/api/dues/houses/:householdId/amount', auth, active, async (c) => {
  const me = c.get('me')
  if (!me.community_id || !canManageScope(me, 'dues')) return bad(c, 'forbidden', 403)
  const householdId = c.req.param('householdId')
  if (!householdId) return bad(c, 'not_found', 404)
  const body = (await c.req.json().catch(() => ({}))) as { amount?: number | null; note?: string }
  const amount = body.amount === null || body.amount === undefined ? null : Number(body.amount)
  try {
    setDuesHouseAmount({
      communityId: me.community_id,
      householdId,
      actorId: me.id,
      amount,
      note: (body.note ?? '').trim().slice(0, 200),
    })
    audit(
      me.community_id,
      me.id,
      'dues.house.amount',
      amount === null ? `${householdId} · kembali ke nominal umum` : `${householdId} · ${amount}`,
    )
    publishCommunityEvent(me.community_id, 'dues.updated', 'houseAmount')
    return c.json({ houseAmounts: listDuesHouseAmounts(me.community_id) })
  } catch (error) {
    const code = error instanceof Error ? error.message : 'errUnknown'
    return bad(c, code, code === 'not_found' ? 404 : 400)
  }
})

/** Tagihan insidental: kerja bakti, perbaikan gapura, dan sejenisnya. */
app.post('/api/dues/invoices/special', auth, active, async (c) => {
  const me = c.get('me')
  if (!me.community_id || !canManageScope(me, 'dues')) return bad(c, 'forbidden', 403)
  const body = (await c.req.json().catch(() => ({}))) as {
    title?: string
    amount?: number
    dueAt?: number
    memberIds?: string[]
  }
  const memberIds = Array.isArray(body.memberIds) ? body.memberIds.filter((id) => typeof id === 'string') : []
  try {
    const result = generateSpecialInvoices({
      communityId: me.community_id,
      actorId: me.id,
      title: body.title ?? '',
      amount: Number(body.amount),
      dueAt: Number(body.dueAt),
      memberIds,
    })
    audit(me.community_id, me.id, 'dues.invoice.special', `${body.title} · ${result.created} tagihan`)
    publishCommunityEvent(me.community_id, 'dues.updated', 'special')
    for (const invoice of result.invoices) {
      void pushToMembers([invoice.memberId], {
        title: invoice.label,
        body: `${rupiah(invoice.amount)} · jatuh tempo ${tanggalSingkat(invoice.dueAt)}`,
        url: '#/app/dues',
        tag: `dues-${invoice.id}`,
      })
    }
    return c.json(result, 201)
  } catch (error) {
    const code = error instanceof Error ? error.message : 'errUnknown'
    const status = code === 'invalid_household_head' ? 422 : 400
    return bad(c, code, status)
  }
})

app.post('/api/dues/:id/claim', auth, active, async (c) => {
  const me = c.get('me')
  const invoiceId = c.req.param('id')
  if (!invoiceId) return bad(c, 'not_found', 404)
  const invoice = getDuesInvoice(invoiceId)
  if (!invoice || !sameCommunity(me, invoice.communityId)) return bad(c, 'forbidden', 403)
  const body = (await c.req.json().catch(() => ({}))) as { paymentNote?: string }
  const paymentNote = (body.paymentNote ?? '').trim().slice(0, 500)
  try {
    const updated = claimDuesInvoice({ invoiceId: invoice.id, memberId: me.id, paymentNote })
    if (!updated) return bad(c, 'forbidden', 403)
    audit(me.community_id, me.id, 'dues.invoice.claim', invoice.reference)
    publishCommunityEvent(me.community_id!, 'dues.updated', invoice.id)
    void pushToMembers(duesManagerIds(invoice.communityId), {
      title: 'Konfirmasi pembayaran iuran',
      body: `${me.name} menyatakan sudah membayar ${invoice.reference}. Menunggu verifikasi.`,
      url: '#/app/dues',
      tag: `dues-claim-${invoice.id}`,
    })
    return c.json({ invoice: updated })
  } catch (error) {
    return bad(c, error instanceof Error ? error.message : 'errUnknown', 409)
  }
})

app.post('/api/dues/:id/verify', auth, active, async (c) => {
  const me = c.get('me')
  if (!me.community_id || !canManageScope(me, 'dues')) return bad(c, 'forbidden', 403)
  const invoiceId = c.req.param('id')
  if (!invoiceId) return bad(c, 'not_found', 404)
  const invoice = getDuesInvoice(invoiceId)
  if (!invoice || invoice.communityId !== me.community_id) return bad(c, 'forbidden', 403)
  const body = (await c.req.json().catch(() => ({}))) as { approve?: boolean; note?: string }
  if (typeof body.approve !== 'boolean') return bad(c, 'errRequired')
  try {
    const updated = verifyDuesInvoice({
      invoiceId: invoice.id,
      actorId: me.id,
      approve: body.approve,
      note: (body.note ?? '').trim().slice(0, 500),
    })
    if (!updated) return bad(c, 'not_found', 404)
    audit(me.community_id, me.id, body.approve ? 'dues.invoice.verify' : 'dues.invoice.reject', invoice.reference)
    publishCommunityEvent(me.community_id, 'dues.updated', invoice.id)
    void pushToMembers([invoice.memberId], {
      title: body.approve ? 'Pembayaran iuran diterima' : 'Konfirmasi pembayaran ditolak',
      body: body.approve
        ? `${invoice.label} ${invoice.period} lunas. Terima kasih.`
        : (updated.verifierNote || 'Hubungi pengurus untuk penjelasan.'),
      url: '#/app/dues',
      tag: `dues-${invoice.id}`,
    })
    return c.json({ invoice: updated })
  } catch (error) {
    return bad(c, error instanceof Error ? error.message : 'errUnknown', 409)
  }
})

/**
 * Iuran yang dibayar tunai ke pengurus. Tidak ada tahap verifikasi karena
 * tidak ada bukti transfer untuk diperiksa — pengurus yang menekan tombol ini
 * yang bertanggung jawab, dan namanya tercatat di audit.
 */
app.post('/api/dues/:id/cash', auth, active, async (c) => {
  const me = c.get('me')
  if (!me.community_id || !canManageScope(me, 'dues')) return bad(c, 'forbidden', 403)
  const invoiceId = c.req.param('id')
  if (!invoiceId) return bad(c, 'not_found', 404)
  const invoice = getDuesInvoice(invoiceId)
  if (!invoice || invoice.communityId !== me.community_id) return bad(c, 'forbidden', 403)
  const body = (await c.req.json().catch(() => ({}))) as { note?: string }
  try {
    const updated = markDuesInvoicePaidCash({
      invoiceId: invoice.id,
      actorId: me.id,
      note: (body.note ?? '').trim().slice(0, 500),
    })
    if (!updated) return bad(c, 'not_found', 404)
    audit(me.community_id, me.id, 'dues.invoice.cash', `${invoice.reference} · ${invoice.amount}`)
    publishCommunityEvent(me.community_id, 'dues.updated', invoice.id)
    void pushToMembers([invoice.memberId], {
      title: 'Pembayaran tunai dicatat',
      body: `${invoice.label} ${invoice.period} ditandai lunas oleh pengurus.`,
      url: '#/app/dues',
      tag: `dues-${invoice.id}`,
    })
    return c.json({ invoice: updated })
  } catch (error) {
    return bad(c, error instanceof Error ? error.message : 'errUnknown', 409)
  }
})

/** Bebaskan tagihan berikut alasannya; barisnya tetap ada untuk laporan. */
app.post('/api/dues/:id/waive', auth, active, async (c) => {
  const me = c.get('me')
  if (!me.community_id || !canManageScope(me, 'dues')) return bad(c, 'forbidden', 403)
  const invoiceId = c.req.param('id')
  if (!invoiceId) return bad(c, 'not_found', 404)
  const invoice = getDuesInvoice(invoiceId)
  if (!invoice || invoice.communityId !== me.community_id) return bad(c, 'forbidden', 403)
  const body = (await c.req.json().catch(() => ({}))) as { note?: string }
  const note = (body.note ?? '').trim().slice(0, 500)
  // Alasan diwajibkan: pembebasan iuran adalah keputusan yang harus bisa
  // dijelaskan kepada warga lain yang tetap membayar.
  if (note.length < 3) return bad(c, 'dues_waive_reason_required')
  try {
    const updated = waiveDuesInvoice({ invoiceId: invoice.id, actorId: me.id, note })
    if (!updated) return bad(c, 'not_found', 404)
    audit(me.community_id, me.id, 'dues.invoice.waive', `${invoice.reference} · ${note}`)
    publishCommunityEvent(me.community_id, 'dues.updated', invoice.id)
    void pushToMembers([invoice.memberId], {
      title: 'Iuran dibebaskan',
      body: `${invoice.label} ${invoice.period}: ${note}`,
      url: '#/app/dues',
      tag: `dues-${invoice.id}`,
    })
    return c.json({ invoice: updated })
  } catch (error) {
    return bad(c, error instanceof Error ? error.message : 'errUnknown', 409)
  }
})

/** Batalkan pembebasan yang salah tekan; tagihan kembali berlaku. */
app.post('/api/dues/:id/restore', auth, active, (c) => {
  const me = c.get('me')
  if (!me.community_id || !canManageScope(me, 'dues')) return bad(c, 'forbidden', 403)
  const invoiceId = c.req.param('id')
  if (!invoiceId) return bad(c, 'not_found', 404)
  const invoice = getDuesInvoice(invoiceId)
  if (!invoice || invoice.communityId !== me.community_id) return bad(c, 'forbidden', 403)
  try {
    const updated = restoreDuesInvoice({ invoiceId: invoice.id, actorId: me.id })
    if (!updated) return bad(c, 'not_found', 404)
    audit(me.community_id, me.id, 'dues.invoice.restore', invoice.reference)
    publishCommunityEvent(me.community_id, 'dues.updated', invoice.id)
    return c.json({ invoice: updated })
  } catch (error) {
    return bad(c, error instanceof Error ? error.message : 'errUnknown', 409)
  }
})

/* ================= Community Hub — operasi & gotong royong ================= */

/*
 * Fase 3/4 memakai endpoint sendiri dan tabel sendiri, bukan `reports`.
 * Semua endpoint tetap memakai `auth`, `active`, community_id dari token, dan
 * pemeriksaan resource di server/community-hub.ts. Klien tidak pernah memilih
 * tenant lewat body/query sehingga satu admin RW tidak dapat menyentuh RW lain.
 */
const hubCreateSchema = z
  .object({
    kind: z.enum(HUB_KINDS),
    title: z.string().max(180),
    body: z.string().max(2_200).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

function hubFailure(c: Context, error: unknown) {
  if (!(error instanceof HubError)) return bad(c, 'hub_unavailable', 500)
  const status =
    error.code === 'not_found'
      ? 404
      : error.code === 'forbidden' || error.code === 'tier_required'
        ? 403
        : error.code === 'invalid_hub_state'
          ? 409
          : 422
  return bad(c, error.code, status)
}

app.get('/api/hub', auth, active, (c) => {
  try {
    return c.json(communityHubOverview(c.get('me')))
  } catch (error) {
    return hubFailure(c, error)
  }
})

app.post('/api/hub/items', auth, active, async (c) => {
  const me = c.get('me')
  const parsed = hubCreateSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return bad(c, 'invalid_hub_input', 422)
  try {
    const item = createHubItem(me, parsed.data)
    // Jangan mencatat isi surat/aduan maupun nominal janji warga ke audit.
    audit(me.community_id, me.id, `hub.${item.kind}.create`, item.id)
    publishCommunityEvent(me.community_id, 'community.hub.updated', item.id)
    return c.json({ item }, 201)
  } catch (error) {
    return hubFailure(c, error)
  }
})

app.patch('/api/hub/items/:id', auth, active, async (c) => {
  const me = c.get('me')
  const body = (await c.req.json().catch(() => ({}))) as { status?: unknown; note?: unknown }
  try {
    const item = setHubItemStatus(me, c.req.param('id') ?? '', body.status, body.note)
    audit(me.community_id, me.id, `hub.${item.kind}.status`, `${item.id} → ${item.status}`)
    publishCommunityEvent(me.community_id, 'community.hub.updated', item.id)
    return c.json({ item })
  } catch (error) {
    return hubFailure(c, error)
  }
})

/** Admin memutuskan surat; PDF baru boleh diminta setelah APPROVED. */
app.post('/api/hub/letters/:id/decision', auth, active, async (c) => {
  const me = c.get('me')
  const body = (await c.req.json().catch(() => ({}))) as {
    approve?: unknown
    note?: unknown
    signerName?: unknown
    signerTitle?: unknown
  }
  try {
    const item = decideLetter(me, c.req.param('id') ?? '', body)
    audit(me.community_id, me.id, body.approve === true ? 'letter.approve' : 'letter.reject', item.id)
    publishCommunityEvent(me.community_id, 'community.hub.updated', item.id)
    return c.json({ item })
  } catch (error) {
    return hubFailure(c, error)
  }
})

app.get('/api/hub/letters/:id/pdf', auth, active, (c) => {
  const me = c.get('me')
  try {
    const data = approvedLetterPdfData(me, c.req.param('id') ?? '')
    const pdf = createLetterPdf(data)
    audit(me.community_id, me.id, 'letter.pdf.download', data.number)
    return c.body(new Uint8Array(pdf), 200, {
      'Content-Type': 'application/pdf',
      // Angka/ID dikendalikan server; jangan memantulkan judul input warga di header.
      'Content-Disposition': `attachment; filename="surat-${String(data.number).replace(/[^A-Za-z0-9-]/g, '-')}.pdf"`,
      'Cache-Control': 'private, no-store',
    })
  } catch (error) {
    return hubFailure(c, error)
  }
})

app.post('/api/hub/items/:id/actions', auth, active, async (c) => {
  const me = c.get('me')
  const body = (await c.req.json().catch(() => ({}))) as { action?: unknown; value?: unknown }
  try {
    const item = actOnHubItem(me, c.req.param('id') ?? '', body.action, body.value)
    audit(me.community_id, me.id, `hub.${item.kind}.${String(body.action ?? 'action')}`, item.id)
    publishCommunityEvent(me.community_id, 'community.hub.updated', item.id)
    return c.json({ item })
  } catch (error) {
    return hubFailure(c, error)
  }
})

app.post('/api/hub/items/:id/draw', auth, active, (c) => {
  const me = c.get('me')
  try {
    const item = drawArisan(me, c.req.param('id') ?? '')
    audit(me.community_id, me.id, 'hub.arisan.draw', item.id)
    publishCommunityEvent(me.community_id, 'community.hub.updated', item.id)
    return c.json({ item })
  } catch (error) {
    return hubFailure(c, error)
  }
})

app.post('/api/hub/items/:id/comments', auth, active, async (c) => {
  const me = c.get('me')
  const body = (await c.req.json().catch(() => ({}))) as { body?: unknown }
  try {
    const item = addHubComment(me, c.req.param('id') ?? '', body.body)
    audit(me.community_id, me.id, `hub.${item.kind}.comment`, item.id)
    publishCommunityEvent(me.community_id, 'community.hub.updated', item.id)
    return c.json({ item }, 201)
  } catch (error) {
    return hubFailure(c, error)
  }
})

/** Analitik agregat saja—bukan rekam perilaku individu atau pelacak warga. */
app.get('/api/hub/analytics', auth, active, (c) => {
  try {
    return c.json({ analytics: hubAnalytics(c.get('me')) })
  } catch (error) {
    return hubFailure(c, error)
  }
})

app.get('/api/hub/branding', auth, active, (c) => {
  try {
    return c.json({ branding: getCommunityBranding(c.get('me')) })
  } catch (error) {
    return hubFailure(c, error)
  }
})

app.put('/api/hub/branding', auth, active, async (c) => {
  const me = c.get('me')
  const body = (await c.req.json().catch(() => ({}))) as {
    brandName?: unknown
    accentColor?: unknown
    logoUrl?: unknown
    customDomain?: unknown
    whiteLabelRequested?: unknown
  }
  try {
    const branding = saveCommunityBranding(me, body)
    audit(me.community_id, me.id, 'tenant.branding.update', branding.customDomain || 'default')
    publishCommunityEvent(me.community_id, 'community.branding.updated', '')
    return c.json({ branding })
  } catch (error) {
    return hubFailure(c, error)
  }
})

app.post('/api/hub/branding/verify-domain', auth, active, async (c) => {
  const me = c.get('me')
  try {
    const result = await verifyCommunityDomain(me)
    audit(me.community_id, me.id, 'tenant.domain.verify', result.verified ? 'dns_verified' : 'pending')
    publishCommunityEvent(me.community_id, 'community.branding.updated', '')
    return c.json(result)
  } catch (error) {
    return hubFailure(c, error)
  }
})

/*
 * WJW Assistant membaca hanya data tenant yang diizinkan untuk peminta.
 * Tidak ada snapshot tenant/SOS maupun teks pertanyaan yang dikirim keluar.
 */
app.post('/api/assistant', auth, active, async (c) => {
  const me = c.get('me')
  if (!hitRateLimit(`assistant:${me.id}`, alamatKlien(c.req.raw.headers), BATAS.assistant))
    return bad(c, 'errTooManyAttempts', 429)
  const body = (await c.req.json().catch(() => ({}))) as { question?: unknown }
  try {
    const answer = await answerAssistant(me, body.question)
    return c.json(answer)
  } catch (error) {
    if (error instanceof Error && error.message === 'invalid_question')
      return bad(c, 'invalid_assistant_question', 422)
    return bad(c, 'assistant_unavailable', 503)
  }
})

app.get('/api/assistant/history', auth, active, (c) => {
  const me = c.get('me')
  const requested = Number(c.req.query('limit') ?? 30)
  return c.json({ entries: assistantHistory(me, requested) })
})

/* ================= push ================= */

app.post('/api/push/subscribe', auth, async (c) => {
  const me = c.get('me')
  const b = (await c.req.json()) as {
    endpoint?: string
    keys?: { p256dh?: string; auth?: string }
  }
  if (!b.endpoint || !b.keys?.p256dh || !b.keys.auth) return bad(c, 'errRequired')
  saveSubscription(me.id, {
    endpoint: b.endpoint,
    keys: { p256dh: b.keys.p256dh, auth: b.keys.auth },
  })
  return c.json({ ok: true })
})

app.post('/api/push/unsubscribe', auth, async (c) => {
  const b = (await c.req.json()) as { endpoint?: string }
  if (b.endpoint) removeSubscription(b.endpoint)
  return c.json({ ok: true })
})

/* ================= langganan ================= */

function mapInvoice(r: Record<string, unknown>) {
  return {
    id: r.id,
    communityId: r.community_id,
    memberId: r.member_id,
    plan: r.plan,
    amount: r.amount,
    status: r.status,
    reference: r.reference,
    note: r.note,
    invoiceNo: invoiceNumber(r.community_id as string, r.created_at as number),
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    claimedAt: r.claimed_at,
    paidAt: r.paid_at,
  }
}

app.get('/api/billing', auth, active, (c) => {
  const me = c.get('me')
  const rows = db
    .prepare('SELECT * FROM invoices WHERE community_id=? ORDER BY created_at DESC LIMIT 50')
    .all(me.community_id) as Record<string, unknown>[]
  return c.json({
    prices: { monthly: PRICE_MONTHLY, yearly: PRICE_YEARLY },
    qris: {
      name: qrisName(QRIS_NAME),
      phone: qrisPhone(QRIS_PHONE),
      imageUrl: qrisImagePath(QRIS_IMAGE_URL),
      info: PAYMENT_INFO,
    },
    invoices: rows.map(mapInvoice),
  })
})

/** URL gambar QRIS yang bisa dibuka klien email (harus absolut). */
function qrisUrl(): string {
  const path = qrisImagePath(QRIS_IMAGE_URL)
  if (/^https?:\/\//.test(path)) return path
  const base = (process.env.WJW_APP_URL ?? '').replace(/\/+$|#.*$/g, '')
  return base ? `${base}${path}` : path
}

/** Buat tagihan langganan lalu kirim emailnya ke admin. */
app.post('/api/billing/checkout', auth, active, async (c) => {
  if (!requireAdmin(c)) return bad(c, 'adminOnly', 403)
  const me = c.get('me')
  if (!me.community_id) return bad(c, 'errNoCommunity')

  const b = (await c.req.json().catch(() => ({}))) as { plan?: 'monthly' | 'yearly' }
  const plan = b.plan === 'yearly' ? 'yearly' : 'monthly'

  // Cegah tagihan menumpuk.
  const existing = openInvoiceOf(me.community_id)
  if (existing)
    return c.json({
      invoice: mapInvoice(existing as unknown as Record<string, unknown>),
      reused: true,
    })

  const com = db
    .prepare('SELECT name, paid_until, trial_ends_at FROM communities WHERE id=?')
    .get(me.community_id) as {
    name: string
    paid_until: number | null
    trial_ends_at: number
  }

  const inv = createInvoice({ communityId: me.community_id, memberId: me.id, plan })
  const dueAt = com.paid_until && com.paid_until > 0 ? com.paid_until : com.trial_ends_at

  const mail = billEmail({
    adminName: me.name,
    communityName: com.name,
    plan,
    amount: inv.amount,
    dueAt,
    invoiceNo: invoiceNumber(me.community_id, inv.created_at),
    reference: inv.reference,
    qrisName: qrisName(QRIS_NAME),
    qrisImageUrl: qrisUrl(),
    paymentInfo: PAYMENT_INFO,
  })
  const sent = await sendMail({
    to: me.email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    kind: 'bill',
    communityId: me.community_id,
    memberId: me.id,
  })

  return c.json(
    { invoice: mapInvoice(inv as unknown as Record<string, unknown>), emailSent: sent.ok },
    201,
  )
})

/** Admin menandai sudah bayar lewat QRIS; menunggu verifikasi superadmin. */
app.post('/api/billing/:id/claim', auth, active, (c) => {
  if (!requireAdmin(c)) return bad(c, 'adminOnly', 403)
  const me = c.get('me')
  const inv = getInvoice(c.req.param('id') ?? '')
  if (!inv || !sameCommunity(me, inv.community_id)) return bad(c, 'forbidden', 403)

  // Nomor referensi tidak diterima dari admin — sudah melekat pada tagihan.
  if (!claimPayment(inv.id, me.id)) return bad(c, 'errNotPending')

  const supers = db
    .prepare("SELECT id FROM members WHERE role='superadmin'")
    .all() as { id: string }[]
  void pushToMembers(
    supers.map((x) => x.id),
    {
      title: 'Konfirmasi pembayaran',
      body: `${me.name} menandai tagihan sudah dibayar.`,
      url: '#/console',
      tag: `claim-${inv.id}`,
    },
  )
  return c.json({ ok: true })
})

/* ---- verifikasi oleh superadmin ---- */

app.get('/api/billing/pending', auth, (c) => {
  if (c.get('me').role !== 'superadmin') return bad(c, 'forbidden', 403)
  return c.json({
    invoices: pendingVerifications().map((r) => ({
      ...mapInvoice(r as unknown as Record<string, unknown>),
      communityName: r.community_name,
      memberName: r.member_name,
      memberEmail: r.member_email,
    })),
  })
})

app.post('/api/billing/:id/verify', auth, async (c) => {
  const me = c.get('me')
  if (me.role !== 'superadmin') return bad(c, 'forbidden', 403)
  const inv = getInvoice(c.req.param('id') ?? '')
  if (!inv) return bad(c, 'not_found', 404)

  const b = (await c.req.json().catch(() => ({}))) as { approve?: boolean; note?: string }

  if (b.approve === false) {
    if (!rejectPayment(inv.id, me.id, b.note ?? '')) return bad(c, 'errNotPending')
    void pushToMembers([inv.member_id], {
      title: 'Pembayaran belum dapat diverifikasi',
      body: b.note?.trim() || 'Mohon periksa kembali pembayaran QRIS Anda.',
      url: '#/app/billing',
      tag: `reject-${inv.id}`,
    })
    return c.json({ ok: true, approved: false })
  }

  const r = verifyPayment(inv.id, me.id)
  if (!r.ok) return bad(c, 'errNotPending')

  void pushToMembers([inv.member_id], {
    title: 'Pembayaran diterima',
    body: 'Langganan lingkungan Anda sudah aktif. Terima kasih!',
    url: '#/app/billing',
    tag: `paid-${inv.id}`,
  })

  const info = db
    .prepare(
      `SELECT m.name, m.email, c.name AS cname FROM members m
       JOIN communities c ON c.id = m.community_id WHERE m.id = ?`,
    )
    .get(inv.member_id) as { name: string; email: string; cname: string } | undefined
  if (info && r.paidUntil) {
    const mail = paidEmail({
      adminName: info.name,
      communityName: info.cname,
      plan: inv.plan as 'monthly' | 'yearly',
      amount: inv.amount,
      dueAt: inv.expires_at ?? now(),
      invoiceNo: invoiceNumber(inv.community_id, inv.created_at),
      reference: inv.reference,
      activeUntil: r.paidUntil,
    })
    void sendMail({
      to: info.email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      kind: 'paid',
      communityId: inv.community_id,
      memberId: inv.member_id,
    })
  }

  return c.json({ ok: true, approved: true, paidUntil: r.paidUntil })
})

/** Picu pemeriksaan perpanjangan secara manual (superadmin). */
app.post('/api/billing/run-renewals', auth, async (c) => {
  const me = c.get('me')
  if (me.role !== 'superadmin') return bad(c, 'forbidden', 403)
  const result = await runRenewalCheck()
  return c.json(result)
})

/* ================= email ================= */

app.get('/api/email/status', auth, active, (c) => {
  const me = c.get('me')
  if (!requireAdmin(c)) return bad(c, 'adminOnly', 403)
  const rows = db
    .prepare(
      'SELECT id, kind, to_email, subject, status, error, at FROM emails WHERE community_id=? ORDER BY at DESC LIMIT 30',
    )
    .all(me.community_id) as Record<string, unknown>[]
  return c.json({ enabled: mailEnabled(), emails: rows })
})

/** Uji setelan SMTP (superadmin). */
app.post('/api/email/test', auth, async (c) => {
  const me = c.get('me')
  if (me.role !== 'superadmin') return bad(c, 'forbidden', 403)
  const v = await verifyMail()
  if (!v.ok) return c.json({ ok: false, error: v.error }, 200)

  const b = (await c.req.json().catch(() => ({}))) as { to?: string }
  const preview = billEmail({
    adminName: 'Contoh Admin',
    communityName: 'RW 05 Contoh',
    plan: 'monthly',
    amount: 149000,
    dueAt: now() + 7 * DAY,
    invoiceNo: 'CONTOH-001',
    reference: 'WJWABC23',
    qrisName: qrisName(QRIS_NAME),
    qrisImageUrl: qrisUrl(),
    paymentInfo: PAYMENT_INFO,
  })
  const r = await sendMail({
    to: b.to || me.email,
    subject: `[UJI] ${preview.subject}`,
    html: preview.html,
    text: preview.text,
    kind: 'test',
  })
  return c.json(r)
})

/** Kirim ulang email tagihan yang masih menunggu pembayaran. */
app.post('/api/billing/:id/resend', auth, active, async (c) => {
  if (!requireAdmin(c)) return bad(c, 'adminOnly', 403)
  const me = c.get('me')
  const inv = db
    .prepare('SELECT * FROM invoices WHERE id=?')
    .get(c.req.param('id')) as Record<string, unknown> | undefined
  if (!inv || !sameCommunity(me, inv.community_id as string))
    return bad(c, 'forbidden', 403)
  if (inv.status !== 'pending') return bad(c, 'errNotPending')

  const com = db
    .prepare('SELECT name FROM communities WHERE id=?')
    .get(inv.community_id) as { name: string }
  const mail = billEmail({
    adminName: me.name,
    communityName: com.name,
    plan: inv.plan as 'monthly' | 'yearly',
    amount: inv.amount as number,
    dueAt: (inv.expires_at as number) ?? now(),
    invoiceNo: invoiceNumber(inv.community_id as string, inv.created_at as number),
    reference: (inv.reference as string) ?? '',
    qrisName: qrisName(QRIS_NAME),
    qrisImageUrl: qrisUrl(),
    paymentInfo: PAYMENT_INFO,
  })
  const r = await sendMail({
    to: me.email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    kind: 'bill',
    communityId: inv.community_id as string,
    memberId: me.id,
  })
  return c.json(r)
})

/* ================= PWA static host ================= */

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}

/** Sajikan build Vite pada origin yang sama dengan API di Fly.io. */
app.get('*', (c) => {
  if (c.req.path === '/api' || c.req.path.startsWith('/api/'))
    return c.json({ error: 'not_found' }, 404)

  let pathname: string
  try {
    pathname = decodeURIComponent(c.req.path)
  } catch {
    return c.text('Not found', 404)
  }
  if (pathname.includes('\0')) return c.text('Not found', 404)

  const requested = pathname.replace(/^\/+/, '')
  const candidate = resolve(STATIC_ROOT, requested || 'index.html')
  const insideStaticRoot = candidate === STATIC_ROOT || candidate.startsWith(`${STATIC_ROOT}${sep}`)
  if (!insideStaticRoot) return c.text('Not found', 404)

  let file = candidate
  let fallback = false
  try {
    if (!existsSync(file) || !statSync(file).isFile()) {
      // Berkas ber-ekstensi yang hilang harus 404 (bukan index.html), supaya
      // service worker/browser tidak menyimpan HTML sebagai JavaScript/CSS.
      if (extname(requested)) return c.text('Not found', 404)
      file = join(STATIC_ROOT, 'index.html')
      fallback = true
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      return c.text('WJW API berjalan. Build web belum tersedia.', 503)
    }
    const type = MIME[extname(file)] ?? 'application/octet-stream'
    const immutableAsset = requested.startsWith('assets/') && !fallback
    return c.body(readFileSync(file), 200, {
      'Content-Type': type,
      'Cache-Control': immutableAsset
        ? 'public, max-age=31536000, immutable'
        : 'no-cache, no-store, must-revalidate',
    })
  } catch {
    return c.text('Not found', 404)
  }
})

/* ================= start ================= */

// Hanya membuka port saat dijalankan langsung; saat di-import oleh tes,
// aplikasi diuji lewat app.fetch() tanpa menyentuh jaringan.
if (process.env.WJW_NO_LISTEN !== '1') {
  startRenewalScheduler()
  // Iuran rutin terbit sendiri untuk tenant yang mengaktifkannya.
  startDuesScheduler(6 * 60 * 60 * 1000, (results) => {
    for (const item of results) {
      audit(item.communityId, 'system', 'dues.invoice.auto', `${item.period} · ${item.created} tagihan`)
      publishCommunityEvent(item.communityId, 'dues.updated', item.period)
      // Tagihan otomatis yang terbit diam-diam adalah tagihan yang terlewat.
      for (const invoice of item.invoices) {
        void pushToMembers([invoice.memberId], {
          title: invoice.label,
          body: `${rupiah(invoice.amount)} · jatuh tempo ${tanggalSingkat(invoice.dueAt)}`,
          url: '#/app/dues',
          tag: `dues-${invoice.id}`,
        })
      }
    }
  })
  const port = Number(process.env.PORT ?? 8787)
  serve({ fetch: app.fetch, hostname: '0.0.0.0', port }, (info) => {
    console.log(`[WJW] API berjalan di http://0.0.0.0:${info.port}`)
  })
}

export { app }
