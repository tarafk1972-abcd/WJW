/**
 * Firebase Cloud Messaging — jalur notifikasi untuk APK Android.
 *
 * Kenapa berkas ini ada: Android WebView (isi APK Capacitor) tidak mendukung
 * Web Push API sama sekali. Pengguna APK karena itu tidak pernah menerima
 * notifikasi apa pun saat aplikasi tertutup — bukan hanya tidak mendengar
 * suaranya. FCM adalah satu-satunya jalur yang bekerja di sana.
 *
 * Tiga hal yang perlu diketahui sebelum mengubah berkas ini:
 *
 * 1. MATI SECARA BAWAAN. Tanpa WJW_FCM_SERVICE_ACCOUNT, seluruh berkas ini
 *    tidak melakukan apa-apa dan server berjalan persis seperti sebelumnya.
 *
 * 2. TANPA DEPENDENSI BARU. Autentikasi HTTP v1 hanya butuh JWT RS256 yang
 *    ditandatangani node:crypto, ditukar menjadi access token di
 *    oauth2.googleapis.com. Menambah firebase-admin berarti menambah puluhan
 *    paket ke server yang berjalan di mesin 512 MB.
 *
 * 3. SUARA SIRENE TIDAK DIKIRIM DARI SINI. Android mengambil suara dari
 *    channel notifikasi, bukan dari payload. Server hanya menyebut nama
 *    channel-nya; channel itu sendiri dibuat di sisi aplikasi
 *    (src/lib/nativePush.ts) dan TIDAK BISA DIUBAH setelah dibuat.
 */

import { createSign } from 'node:crypto'

/** Sesuai channel yang dibuat aplikasi. Naikkan versinya bila setelan channel berubah. */
export const SOS_CHANNEL_ID = 'wjw_sos_v1'

interface ServiceAccount {
  projectId: string
  clientEmail: string
  privateKey: string
}

function readAccount(): ServiceAccount | null {
  const raw = (process.env.WJW_FCM_SERVICE_ACCOUNT ?? '').trim()
  if (!raw) return null
  try {
    // Menerima JSON apa adanya maupun base64 — `fly secrets set` lebih aman
    // dengan base64 karena JSON berisi baris baru dan tanda kutip.
    const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')
    const j = JSON.parse(text) as Record<string, unknown>
    const projectId = typeof j.project_id === 'string' ? j.project_id : ''
    const clientEmail = typeof j.client_email === 'string' ? j.client_email : ''
    const privateKeyRaw = typeof j.private_key === 'string' ? j.private_key : ''
    if (!projectId || !clientEmail || !privateKeyRaw) return null
    // Kunci yang lewat variabel lingkungan sering kehilangan baris barunya.
    return { projectId, clientEmail, privateKey: privateKeyRaw.replace(/\\n/g, '\n') }
  } catch {
    return null
  }
}

const account = readAccount()

/** Apakah pengiriman FCM aktif. False = server berjalan seperti sebelum FCM ada. */
export const fcmEnabled = account !== null

if (!fcmEnabled && (process.env.WJW_FCM_SERVICE_ACCOUNT ?? '').trim()) {
  console.log('[WJW] WJW_FCM_SERVICE_ACCOUNT ada tetapi tidak terbaca — FCM nonaktif.')
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

let cachedToken = ''
let cachedUntil = 0

/**
 * Access token Google, ditukar dari JWT yang ditandatangani service account.
 * Disimpan sampai 60 detik sebelum kedaluwarsa supaya tidak menukar token
 * pada setiap notifikasi.
 */
async function accessToken(): Promise<string | null> {
  if (!account) return null
  const nowSec = Math.floor(Date.now() / 1000)
  if (cachedToken && nowSec < cachedUntil) return cachedToken

  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(
    JSON.stringify({
      iss: account.clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: nowSec,
      exp: nowSec + 3600,
    }),
  )
  let assertion: string
  try {
    const signer = createSign('RSA-SHA256')
    signer.update(`${header}.${claim}`)
    assertion = `${header}.${claim}.${b64url(signer.sign(account.privateKey))}`
  } catch (e) {
    console.error('[WJW] FCM: gagal menandatangani JWT —', (e as Error).message)
    return null
  }

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    })
    if (!res.ok) {
      console.error('[WJW] FCM: penukaran token ditolak —', res.status, await res.text())
      return null
    }
    const j = (await res.json()) as { access_token?: string; expires_in?: number }
    if (!j.access_token) return null
    cachedToken = j.access_token
    cachedUntil = nowSec + (j.expires_in ?? 3600) - 60
    return cachedToken
  } catch (e) {
    console.error('[WJW] FCM: penukaran token gagal —', (e as Error).message)
    return null
  }
}

export interface FcmPayload {
  title: string
  body: string
  url?: string
  tag?: string
  urgent?: boolean
}

export interface FcmResult {
  /** Diterima FCM — bukan bukti sampai ke tangan orang. */
  sent: number
  failed: number
  /** Token yang ditolak permanen; pemanggil wajib menghapusnya. */
  invalid: string[]
}

/**
 * FCM HTTP v1 mengirim satu pesan per permintaan — tidak ada multicast.
 * Dikirim sepuluh sekaligus agar satu lingkungan besar tidak menahan
 * penyimpanan SOS terlalu lama.
 */
const BATCH = 10

/**
 * Kirim ke sekumpulan token perangkat.
 * Tidak pernah melempar error: kegagalan notifikasi tidak boleh menggagalkan
 * penyimpanan peringatan darurat.
 */
export async function sendFcm(tokens: string[], payload: FcmPayload): Promise<FcmResult> {
  const unik = [...new Set(tokens.filter(Boolean))]
  const hasil: FcmResult = { sent: 0, failed: 0, invalid: [] }
  if (!account || unik.length === 0) return hasil

  const token = await accessToken()
  if (!token) {
    hasil.failed = unik.length
    return hasil
  }

  const url = `https://fcm.googleapis.com/v1/projects/${account.projectId}/messages:send`
  const tag = payload.tag ?? 'wjw'

  for (let i = 0; i < unik.length; i += BATCH) {
    const potongan = unik.slice(i, i + BATCH)
    await Promise.all(
      potongan.map(async (perangkat) => {
        const message = {
          token: perangkat,
          notification: { title: payload.title, body: payload.body },
          // Data dibaca aplikasi saat notifikasi diketuk.
          data: {
            url: payload.url ?? '/',
            urgent: payload.urgent ? '1' : '0',
            tag,
          },
          android: {
            priority: payload.urgent ? 'HIGH' : 'NORMAL',
            // TTL pendek untuk darurat: peringatan basi lebih berbahaya
            // daripada tidak ada peringatan.
            ttl: payload.urgent ? '3600s' : '86400s',
            collapse_key: tag,
            notification: {
              // Suara sirene menempel pada channel ini, bukan pada payload.
              channel_id: payload.urgent ? SOS_CHANNEL_ID : undefined,
              tag,
              default_vibrate_timings: false,
              vibrate_timings: payload.urgent ? ['0s', '0.5s', '0.2s', '0.5s'] : undefined,
              notification_priority: payload.urgent ? 'PRIORITY_MAX' : 'PRIORITY_DEFAULT',
              visibility: 'PUBLIC',
            },
          },
        }

        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${token}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ message }),
          })
          if (res.ok) {
            hasil.sent++
            return
          }
          hasil.failed++
          const teks = await res.text()
          // UNREGISTERED = aplikasi dihapus; INVALID_ARGUMENT = token rusak.
          // Keduanya permanen, jadi tokennya dibuang agar tabel tidak
          // menumpuk perangkat mati.
          if (
            res.status === 404 ||
            teks.includes('UNREGISTERED') ||
            teks.includes('INVALID_ARGUMENT')
          ) {
            hasil.invalid.push(perangkat)
          } else {
            console.error('[WJW] FCM ditolak —', res.status, teks.slice(0, 200))
          }
        } catch (e) {
          hasil.failed++
          console.error('[WJW] FCM gagal —', (e as Error).message)
        }
      }),
    )
  }

  return hasil
}
