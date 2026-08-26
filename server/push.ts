import webpush from 'web-push'
import { db, now, uid } from './db.js'

const PUBLIC = process.env.VAPID_PUBLIC_KEY ?? ''
const PRIVATE = process.env.VAPID_PRIVATE_KEY ?? ''
const SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:tarafk1972@gmail.com'

export const pushEnabled = Boolean(PUBLIC && PRIVATE)

if (pushEnabled) {
  webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE)
} else {
  console.log(
    '[WJW] Notifikasi push nonaktif — jalankan `npm run vapid` lalu set VAPID_PUBLIC_KEY & VAPID_PRIVATE_KEY.',
  )
}

export function vapidPublicKey(): string {
  return PUBLIC
}

export function saveSubscription(
  memberId: string,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
) {
  db.prepare(
    `INSERT INTO push_subscriptions (id, member_id, endpoint, p256dh, auth, created_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(endpoint) DO UPDATE SET
       member_id = excluded.member_id,
       p256dh    = excluded.p256dh,
       auth      = excluded.auth`,
  ).run(uid('ps_'), memberId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, now())
}

export function removeSubscription(endpoint: string) {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint)
}

export interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
  urgent?: boolean
}

/** Accounting upaya dispatch Web Push; bukan konfirmasi penerimaan manusia. */
export interface PushDispatchResult {
  /** Jumlah anggota target unik, bukan bukti perangkat menerimanya. */
  targets: number
  /** Jumlah subscription browser yang ditemukan. */
  subscriptions: number
  /** Diterima oleh layanan Web Push, bukan dibuka/dilihat perangkat. */
  sent: number
  /** Penolakan/error dari layanan Web Push. */
  failed: number
  enabled: boolean
}

/**
 * Kirim notifikasi ke sekumpulan anggota.
 * Langganan yang sudah tidak valid (404/410) dibersihkan otomatis.
 * Tidak pernah melempar error — kegagalan push tidak boleh menggagalkan
 * penyimpanan peringatan darurat. Hasilnya adalah accounting dispatch
 * transport, BUKAN bukti bahwa ponsel atau manusia telah menerima alarm.
 */
export async function pushToMembers(
  memberIds: string[],
  payload: PushPayload,
): Promise<PushDispatchResult> {
  const targets = [...new Set(memberIds.filter(Boolean))]
  const empty: PushDispatchResult = {
    targets: targets.length,
    subscriptions: 0,
    sent: 0,
    failed: 0,
    enabled: pushEnabled,
  }
  if (!pushEnabled || targets.length === 0) return empty

  const marks = targets.map(() => '?').join(',')
  const subs = db
    .prepare(`SELECT * FROM push_subscriptions WHERE member_id IN (${marks})`)
    .all(...targets) as {
    endpoint: string
    p256dh: string
    auth: string
  }[]

  let sent = 0
  let failed = 0
  const body = JSON.stringify(payload)

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { urgency: payload.urgent ? 'high' : 'normal', TTL: payload.urgent ? 3600 : 86400 },
        )
        sent++
      } catch (e) {
        failed++
        const code = (e as { statusCode?: number }).statusCode
        if (code === 404 || code === 410) removeSubscription(s.endpoint)
      }
    }),
  )
  return { targets: targets.length, subscriptions: subs.length, sent, failed, enabled: true }
}
