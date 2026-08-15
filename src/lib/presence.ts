/**
 * Melaporkan posisi terakhir ke server.
 *
 * Tujuannya satu: agar ketika seorang warga menekan tombol darurat,
 * sistem tahu siapa yang sedang berada di dekatnya dan bisa menolong
 * lebih dulu daripada siapa pun.
 *
 * Karena ini data lokasi warga, sengaja dibuat sehemat mungkin:
 *
 *   - hanya SATU titik terakhir yang disimpan, menimpa yang sebelumnya;
 *     server tidak pernah menyimpan riwayat perjalanan
 *   - dikirim paling sering sekali per beberapa menit, dan hanya bila
 *     orangnya benar-benar berpindah
 *   - titik yang lebih tua dari 15 menit tidak lagi dipakai server
 *   - warga bisa mematikannya, dan titiknya ikut terhapus
 */
import { api } from './api'

/** Jeda minimum antar pengiriman. */
const MIN_INTERVAL_MS = 3 * 60 * 1000

/** Jarak minimum sebelum dianggap berpindah (meter). */
const MIN_MOVE_M = 20

const OPT_OUT_KEY = 'wjw.presence.off'

let lastSentAt = 0
let lastPoint: { lat: number; lng: number } | null = null

/** Apakah warga mematikan berbagi posisi? */
export function presenceDisabled(): boolean {
  return localStorage.getItem(OPT_OUT_KEY) === '1'
}

/** Matikan berbagi posisi, dan hapus titik yang tersimpan di server. */
export async function disablePresence(): Promise<void> {
  localStorage.setItem(OPT_OUT_KEY, '1')
  lastPoint = null
  try {
    await api.del('/me/location')
  } catch {
    /* diamkan — akan terhapus sendiri saat kedaluwarsa */
  }
}

export function enablePresence(): void {
  localStorage.removeItem(OPT_OUT_KEY)
  // Paksa kiriman berikutnya, jangan menunggu jeda.
  lastSentAt = 0
  lastPoint = null
}

/** Jarak kasar dalam meter, cukup untuk memutuskan "berpindah atau tidak". */
function metersBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const la1 = toRad(a.lat)
  const la2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Kirim posisi bila memang perlu.
 * @returns true bila benar-benar dikirim.
 */
export async function reportLocation(
  pos: { lat: number; lng: number; accuracy: number | null },
  now = Date.now(),
): Promise<boolean> {
  if (presenceDisabled()) return false

  const terlaluCepat = now - lastSentAt < MIN_INTERVAL_MS
  const belumPindah =
    lastPoint !== null && metersBetween(lastPoint, pos) < MIN_MOVE_M
  if (terlaluCepat && belumPindah) return false

  try {
    await api.post('/me/location', {
      lat: pos.lat,
      lng: pos.lng,
      accuracy: pos.accuracy,
    })
    lastSentAt = now
    lastPoint = { lat: pos.lat, lng: pos.lng }
    return true
  } catch {
    return false
  }
}

/** Hanya untuk tes: lupakan keadaan pengiriman terakhir. */
export function resetPresenceState(): void {
  lastSentAt = 0
  lastPoint = null
}
