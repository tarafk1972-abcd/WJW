import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Context, Next } from 'hono'
import { z } from 'zod'
import {
  DAY,
  TRIAL_DAYS,
  audit,
  createSession,
  db,
  destroySession,
  ensureSuperadmin,
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
import {
  activeSchedule,
  distanceMeters,
  normalizeCode,
  pointInPolygon,
  type LatLng,
} from './geo.js'
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
setInterval(purgeSessions, 6 * 60 * 60 * 1000).unref?.()

type Env = { Variables: { me: MemberRow } }
const app = new Hono<Env>()

app.use('/api/*', cors({ origin: (o) => o ?? '*', credentials: true }))

/* ---------------- util ---------------- */

const J = (s: string) => JSON.parse(s || 'null')

function bearer(c: Context): string | null {
  const h = c.req.header('Authorization') ?? ''
  return h.startsWith('Bearer ') ? h.slice(7) : null
}

/** Wajib login. */
async function auth(c: Context<Env>, next: Next) {
  const me = memberFromToken(bearer(c))
  if (!me) return c.json({ error: 'unauthorized' }, 401)
  c.set('me', me)
  await next()
}

/** Wajib login DAN sudah disetujui admin. */
async function active(c: Context<Env>, next: Next) {
  const me = c.get('me')
  if (me.status !== 'active') return c.json({ error: 'not_active' }, 403)
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
    plan: r.plan,
    planName: r.plan_name,
    trialEndsAt: r.trial_ends_at,
    paidUntil: r.paid_until,
    suspendedReason: r.suspended_reason ?? undefined,
  }
}

function mapReport(r: Record<string, unknown>) {
  return {
    id: r.id,
    communityId: r.community_id,
    authorId: r.author_id,
    kind: r.kind,
    category: r.category,
    note: r.note,
    at: r.at_lat === null ? null : { lat: r.at_lat, lng: r.at_lng },
    address: r.address,
    status: r.status,
    createdAt: r.created_at,
    handledBy: r.handled_by,
    handledAt: r.handled_at,
    resolvedNote: r.resolved_note ?? undefined,
    insideArea: r.inside_area === null ? null : !!r.inside_area,
    anonymous: !!r.anonymous,
    attachments: J(r.attachments as string) ?? [],
    messages: J(r.messages as string) ?? [],
    responders: J(r.responders as string) ?? [],
    track: J(r.track as string) ?? [],
    live: !!r.live,
    liveEndedAt: r.live_ended_at,
    audio: r.audio,
    audioSeconds: r.audio_seconds,
    snapshot: J(r.snapshot as string),
    recipients: J(r.recipients as string) ?? [],
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

/* ================= kesehatan ================= */

app.get('/api/health', (c) =>
  c.json({ ok: true, push: pushEnabled, time: now() }),
)

app.get('/api/push/key', (c) => c.json({ key: vapidPublicKey() }))

/* ================= komunitas publik ================= */

app.get('/api/communities/search', (c) => {
  const q = (c.req.query('q') ?? '').trim().toLowerCase()
  const rows = db.prepare('SELECT * FROM communities').all() as Record<
    string,
    unknown
  >[]
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
  const code = normalizeCode(c.req.param('code'))
  const inv = db
    .prepare('SELECT * FROM invites WHERE code = ?')
    .get(code) as Record<string, unknown> | undefined
  if (!inv || inv.revoked_at) return bad(c, 'errInvite', 404)
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
  const parsed = registerSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return bad(c, 'errRequired')
  const i = parsed.data

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
    if (!i.communityName?.trim()) return bad(c, 'errRequired')
    communityId = uid('c_')
    db.prepare(
      `INSERT INTO communities
       (id,name,address,city,created_at,created_by,area,center,language,
        plan,plan_name,trial_ends_at)
       VALUES (?,?,?,?,?,'','[]',?,?,'trial','trial',?)`,
    ).run(
      communityId,
      i.communityName.trim(),
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
  const body = (await c.req.json().catch(() => ({}))) as {
    identifier?: string
    password?: string
    deviceId?: string
  }
  const q = (body.identifier ?? '').trim().toLowerCase().replace(/\s|-/g, '')
  if (!q || !body.password) return bad(c, 'errLogin', 401)

  const row = db
    .prepare('SELECT * FROM members WHERE lower(email)=? OR phone=?')
    .get(q, q) as MemberRow | undefined

  // Selalu bandingkan hash agar waktu respons tidak membocorkan
  // apakah email terdaftar atau tidak.
  const ok = verifyPassword(
    body.password,
    row?.password_hash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv',
  )
  if (!row || !ok) return bad(c, 'errLogin', 401)

  if (body.deviceId)
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
      members: (db.prepare('SELECT * FROM members').all() as MemberRow[]).map(
        publicMember,
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

  const reports = (
    one<Record<string, unknown>>(
      'SELECT * FROM reports WHERE community_id=? ORDER BY created_at DESC LIMIT 200',
    )
  ).map(mapReport)

  return c.json({
    me: publicMember(me),
    community: mapCommunity(community),
    members,
    reports,
    checkpoints: one<Record<string, unknown>>(
      'SELECT * FROM checkpoints WHERE community_id=? AND active=1 ORDER BY ord',
    ).map(mapCheckpoint),
    schedules: one<Record<string, unknown>>(
      'SELECT * FROM schedules WHERE community_id=?',
    ).map(mapSchedule),
    patrolLogs: one<Record<string, unknown>>(
      'SELECT * FROM patrol_logs WHERE community_id=? ORDER BY at DESC LIMIT 200',
    ).map(mapLog),
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
    ).map((r) => ({
      id: r.id,
      communityId: r.community_id,
      authorId: r.author_id,
      title: r.title,
      body: r.body,
      pinned: !!r.pinned,
      createdAt: r.created_at,
    })),
    guests: one<Record<string, unknown>>(
      'SELECT * FROM guests WHERE community_id=? ORDER BY check_in DESC LIMIT 100',
    ).map((r) => ({
      id: r.id,
      communityId: r.community_id,
      name: r.name,
      purpose: r.purpose,
      host: r.host,
      plate: r.plate,
      idCard: r.id_card,
      checkIn: r.check_in,
      checkOut: r.check_out,
      recordedBy: r.recorded_by,
    })),
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
  audit(t.community_id, me.id, 'member.role', `${t.name} → ${b.role}`)
  return c.json({ ok: true })
})

app.put('/api/me/profile', auth, async (c) => {
  const me = c.get('me')
  const b = (await c.req.json()) as { emergency?: unknown; language?: string }
  if (b.emergency !== undefined)
    db.prepare('UPDATE members SET emergency=? WHERE id=?').run(
      JSON.stringify(b.emergency),
      me.id,
    )
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

/* ================= area lingkungan ================= */

app.put('/api/community/area', auth, active, async (c) => {
  if (!requireAdmin(c)) return bad(c, 'adminOnly', 403)
  const me = c.get('me')
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
  return c.json({ ok: true })
})

/* ================= peringatan darurat ================= */

/** Siapa yang menerima peringatan anggota ini. Tanpa polisi. */
function alertAudience(me: MemberRow) {
  const out: {
    id: string
    name: string
    phone: string
    kind: string
    memberId: string | null
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

  return out
}

app.get('/api/alerts/audience', auth, active, (c) =>
  c.json({ audience: alertAudience(c.get('me')) }),
)

app.post('/api/alerts', auth, active, async (c) => {
  const me = c.get('me')
  if (!me.community_id) return bad(c, 'errNoCommunity')
  const b = (await c.req.json().catch(() => ({}))) as {
    category?: string
    at?: LatLng | null
    accuracy?: number | null
  }

  const com = db
    .prepare('SELECT * FROM communities WHERE id=?')
    .get(me.community_id) as Record<string, unknown>
  const area: LatLng[] = J(com.area as string) ?? []
  const at = b.at ?? null
  const inside = area.length >= 3 && at ? pointInPolygon(at, area) : null

  const audience = alertAudience(me)
  const id = uid('r_')
  const t = now()
  const snapshot = {
    name: me.name,
    phone: me.phone,
    house: me.house,
    ...(me.emergency ? JSON.parse(me.emergency) : {}),
  }

  db.prepare(
    `INSERT INTO reports
     (id,community_id,author_id,kind,category,note,at_lat,at_lng,address,status,
      created_at,inside_area,attachments,messages,responders,track,live,
      audio_seconds,snapshot,recipients)
     VALUES (?,?,?,'sos',?,'',?,?,?,'open',?,?,'[]','[]','[]',?,1,0,?,?)`,
  ).run(
    id,
    me.community_id,
    me.id,
    b.category ?? 'other',
    at?.lat ?? null,
    at?.lng ?? null,
    me.house,
    t,
    inside === null ? null : inside ? 1 : 0,
    JSON.stringify(
      at ? [{ lat: at.lat, lng: at.lng, at: t, accuracy: b.accuracy ?? null }] : [],
    ),
    JSON.stringify(snapshot),
    JSON.stringify(
      audience.map((a) => ({ ...a, deliveredAt: t, acknowledgedAt: null })),
    ),
  )

  audit(me.community_id, me.id, 'alert.raise', `${b.category} → ${audience.length}`)

  // Notifikasi push mendesak ke semua penerima yang punya akun
  const ids = audience.map((a) => a.memberId).filter((x): x is string => !!x)
  void pushToMembers(ids, {
    title: `🆘 DARURAT — ${me.name}`,
    body: `${me.house}. Buka aplikasi untuk melihat lokasi.`,
    url: `#/app/reports?id=${id}`,
    tag: `sos-${id}`,
    urgent: true,
  })

  const row = db.prepare('SELECT * FROM reports WHERE id=?').get(id) as Record<
    string,
    unknown
  >
  return c.json({ report: mapReport(row) }, 201)
})

/** Pemilik peringatan mengirim titik lokasi terbaru. */
app.post('/api/alerts/:id/location', auth, active, async (c) => {
  const me = c.get('me')
  const r = db.prepare('SELECT * FROM reports WHERE id=?').get(c.req.param('id')) as
    | Record<string, unknown>
    | undefined
  if (!r) return bad(c, 'not_found', 404)
  if (r.author_id !== me.id) return bad(c, 'forbidden', 403)
  if (!r.live) return c.json({ ok: true, ignored: true })

  const b = (await c.req.json()) as { lat: number; lng: number; accuracy?: number }
  const track = (J(r.track as string) ?? []) as {
    lat: number
    lng: number
    at: number
    accuracy: number | null
  }[]
  const last = track[track.length - 1]
  if (!last || last.lat !== b.lat || last.lng !== b.lng) {
    track.push({ lat: b.lat, lng: b.lng, at: now(), accuracy: b.accuracy ?? null })
    if (track.length > 500) track.shift()
    db.prepare('UPDATE reports SET track=?, at_lat=?, at_lng=? WHERE id=?').run(
      JSON.stringify(track),
      b.lat,
      b.lng,
      r.id,
    )
  }
  return c.json({ ok: true })
})

app.post('/api/alerts/:id/ack', auth, active, (c) => {
  const me = c.get('me')
  const r = db.prepare('SELECT * FROM reports WHERE id=?').get(c.req.param('id')) as
    | Record<string, unknown>
    | undefined
  if (!r || !sameCommunity(me, r.community_id as string))
    return bad(c, 'forbidden', 403)

  const recipients = (J(r.recipients as string) ?? []) as {
    memberId: string | null
    acknowledgedAt: number | null
  }[]
  const rec = recipients.find((x) => x.memberId === me.id)
  if (rec && !rec.acknowledgedAt) rec.acknowledgedAt = now()

  const responders: string[] = J(r.responders as string) ?? []
  if (!responders.includes(me.id)) responders.push(me.id)

  db.prepare(
    `UPDATE reports SET recipients=?, responders=?,
     status = CASE WHEN status='open' THEN 'ack' ELSE status END,
     handled_by = COALESCE(handled_by, ?), handled_at = COALESCE(handled_at, ?)
     WHERE id=?`,
  ).run(JSON.stringify(recipients), JSON.stringify(responders), me.id, now(), r.id)

  void pushToMembers([r.author_id as string], {
    title: 'Bantuan menuju lokasi',
    body: `${me.name} sedang menuju lokasi Anda.`,
    url: `#/app`,
    tag: `ack-${r.id}`,
  })
  return c.json({ ok: true })
})

app.post('/api/alerts/:id/close', auth, active, async (c) => {
  const me = c.get('me')
  const r = db.prepare('SELECT * FROM reports WHERE id=?').get(c.req.param('id')) as
    | Record<string, unknown>
    | undefined
  if (!r) return bad(c, 'not_found', 404)
  const isOwner = r.author_id === me.id
  if (!isOwner && !requireAdmin(c) && me.role !== 'satpam')
    return bad(c, 'forbidden', 403)

  const b = (await c.req.json().catch(() => ({}))) as { cancelled?: boolean }
  db.prepare(
    `UPDATE reports SET status='resolved', live=0, live_ended_at=?, cancelled_at=?
     WHERE id=?`,
  ).run(now(), b.cancelled ? now() : null, r.id)
  audit(r.community_id as string, me.id, b.cancelled ? 'alert.cancel' : 'alert.close', '')
  return c.json({ ok: true })
})

/* ================= titik ronda & jadwal ================= */

app.post('/api/checkpoints', auth, active, async (c) => {
  if (!requireAdmin(c)) return bad(c, 'adminOnly', 403)
  const me = c.get('me')
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
  return c.json({ id }, 201)
})

app.delete('/api/checkpoints/:id', auth, active, (c) => {
  if (!requireAdmin(c)) return bad(c, 'adminOnly', 403)
  const me = c.get('me')
  const cp = db
    .prepare('SELECT * FROM checkpoints WHERE id=?')
    .get(c.req.param('id')) as Record<string, unknown> | undefined
  if (!cp || !sameCommunity(me, cp.community_id as string))
    return bad(c, 'forbidden', 403)
  db.prepare('DELETE FROM checkpoints WHERE id=?').run(cp.id)
  return c.json({ ok: true })
})

app.post('/api/schedules', auth, active, async (c) => {
  if (!requireAdmin(c)) return bad(c, 'adminOnly', 403)
  const me = c.get('me')
  const b = (await c.req.json()) as {
    label?: string
    startMinute?: number
    endMinute?: number
    days?: number[]
    graceMin?: number
  }
  if (!b.label?.trim()) return bad(c, 'errRequired')
  const id = uid('sc_')
  db.prepare(
    `INSERT INTO schedules (id,community_id,label,start_minute,end_minute,days,grace_min,active,created_at)
     VALUES (?,?,?,?,?,?,?,1,?)`,
  ).run(
    id,
    me.community_id,
    b.label.trim(),
    b.startMinute ?? 0,
    b.endMinute ?? 0,
    JSON.stringify(b.days ?? []),
    b.graceMin ?? 15,
    now(),
  )
  return c.json({ id }, 201)
})

app.delete('/api/schedules/:id', auth, active, (c) => {
  if (!requireAdmin(c)) return bad(c, 'adminOnly', 403)
  const me = c.get('me')
  const sc = db.prepare('SELECT * FROM schedules WHERE id=?').get(c.req.param('id')) as
    | Record<string, unknown>
    | undefined
  if (!sc || !sameCommunity(me, sc.community_id as string))
    return bad(c, 'forbidden', 403)
  db.prepare('DELETE FROM schedules WHERE id=?').run(sc.id)
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

  const inside = dist <= (cp.radius_m as number)
  if (!inside && !b.force)
    return c.json({ error: 'errTooFar', distanceM: Math.round(dist) }, 422)

  const recent = db
    .prepare(
      'SELECT 1 FROM patrol_logs WHERE checkpoint_id=? AND satpam_id=? AND abs(? - at) < 300000',
    )
    .get(cp.id, me.id, now())
  if (recent) return bad(c, 'errAlreadyLogged', 409)

  const schedules = db
    .prepare('SELECT * FROM schedules WHERE community_id=?')
    .all(me.community_id) as Parameters<typeof activeSchedule>[0]
  const act = activeSchedule(schedules, now())
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
      name: QRIS_NAME,
      phone: QRIS_PHONE,
      imageUrl: QRIS_IMAGE_URL,
      info: PAYMENT_INFO,
    },
    invoices: rows.map(mapInvoice),
  })
})

/** URL gambar QRIS yang bisa dibuka klien email (harus absolut). */
function qrisUrl(): string {
  if (/^https?:\/\//.test(QRIS_IMAGE_URL)) return QRIS_IMAGE_URL
  const base = (process.env.WJW_APP_URL ?? '').replace(/\/+$|#.*$/g, '')
  return base ? `${base}${QRIS_IMAGE_URL}` : QRIS_IMAGE_URL
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
    qrisName: QRIS_NAME,
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

/** Admin menandai sudah transfer; menunggu verifikasi superadmin. */
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
      body: b.note?.trim() || 'Mohon periksa kembali bukti transfer Anda.',
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
    qrisName: QRIS_NAME,
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
    qrisName: QRIS_NAME,
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

/* ================= start ================= */

// Hanya membuka port saat dijalankan langsung; saat di-import oleh tes,
// aplikasi diuji lewat app.fetch() tanpa menyentuh jaringan.
if (process.env.WJW_NO_LISTEN !== '1') {
  startRenewalScheduler()
  const port = Number(process.env.PORT ?? 8787)
  serve({ fetch: app.fetch, hostname: '0.0.0.0', port }, (info) => {
    console.log(`[WJW] API berjalan di http://0.0.0.0:${info.port}`)
  })
}

export { app }
