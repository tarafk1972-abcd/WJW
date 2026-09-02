import webpush from 'web-push'
import { db, now, uid } from './db.js'
import { fcmEnabled, sendFcm } from './fcm.js'

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

/**
 * Simpan token FCM sebuah perangkat Android.
 *
 * Token adalah kunci utamanya: satu HP yang berpindah akun harus berpindah
 * pemilik, bukan menerima notifikasi dua warga sekaligus.
 */
export function saveFcmToken(memberId: string, token: string, platform = 'android') {
  const at = now()
  db.prepare(
    `INSERT INTO fcm_tokens (token, member_id, platform, created_at, updated_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(token) DO UPDATE SET
       member_id  = excluded.member_id,
       platform   = excluded.platform,
       updated_at = excluded.updated_at`,
  ).run(token, memberId, platform, at, at)
}

export function removeFcmToken(token: string) {
  db.prepare('DELETE FROM fcm_tokens WHERE token = ?').run(token)
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
  /** Jumlah perangkat APK (Android) yang ditemukan untuk target ini. */
  fcmTokens?: number
  /** Diterima FCM. Terpisah dari `sent` agar dua jalur bisa dibedakan di log. */
  fcmSent?: number
  fcmFailed?: number
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
    enabled: pushEnabled || fcmEnabled,
  }
  if (targets.length === 0) return empty
  // Dua jalur berdiri sendiri: warga PWA lewat Web Push, warga APK lewat FCM.
  // Cukup salah satunya aktif agar fungsi ini tetap berguna.
  if (!pushEnabled && !fcmEnabled) return empty

  const marks = targets.map(() => '?').join(',')
  const subs = (
    pushEnabled
      ? db.prepare(`SELECT * FROM push_subscriptions WHERE member_id IN (${marks})`).all(...targets)
      : []
  ) as {
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
  // Jalur kedua: perangkat APK. Dikerjakan setelah Web Push supaya kegagalan
  // FCM tidak menunda notifikasi warga yang memakai browser.
  let fcmTokens = 0
  let fcmSent = 0
  let fcmFailed = 0
  if (fcmEnabled) {
    const rows = db
      .prepare(`SELECT token FROM fcm_tokens WHERE member_id IN (${marks})`)
      .all(...targets) as { token: string }[]
    fcmTokens = rows.length
    if (fcmTokens > 0) {
      const hasil = await sendFcm(
        rows.map((r) => r.token),
        payload,
      )
      fcmSent = hasil.sent
      fcmFailed = hasil.failed
      for (const mati of hasil.invalid) removeFcmToken(mati)
    }
  }

  return {
    targets: targets.length,
    subscriptions: subs.length,
    sent,
    failed,
    enabled: true,
    fcmTokens,
    fcmSent,
    fcmFailed,
  }
}
