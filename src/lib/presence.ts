/**
 * Mengirim posisi HANYA ketika ada peringatan darurat.
 *
 * Tidak ada pengiriman berkala. GPS tidak disentuh sama sekali di
 * hari-hari biasa; server tidak pernah tahu warga sedang di mana.
 *
 * Alurnya:
 *   1. Seorang warga menekan tombol darurat.
 *   2. Server menandai lingkungan itu sedang darurat (`locationWanted`).
 *   3. Aplikasi warga lain — yang memang sudah menghubungi server tiap
 *      beberapa detik — melihat tanda itu, mengambil SATU titik lokasi,
 *      lalu mengirimkannya.
 *   4. Server memakainya untuk memanggil yang terdekat, dan melupakannya
 *      setelah 10 menit.
 *
 * Batas yang jujur: bila aplikasi warga sedang tertutup, langkah 3 tidak
 * berjalan, sehingga ia tidak akan terhitung sebagai tetangga terdekat.
 * Notifikasi push tidak bisa mengambil lokasi — peramban tidak
 * mengizinkan service worker menyentuh GPS. Karena itu satpam dan
 * pengurus tetap dikabari tanpa bergantung pada jarak.
 */
import { api } from './api'
import { getFix } from './capture'

/** Jangan mengirim dua kali untuk kejadian yang sama. */
const MIN_GAP_MS = 60 * 1000

const OPT_OUT_KEY = 'wjw.presence.off'

let lastSentAt = 0
let sending = false

/** Apakah warga mematikan bantuan lokasi darurat? */
export function presenceDisabled(): boolean {
  return localStorage.getItem(OPT_OUT_KEY) === '1'
}

/** Matikan, sekaligus hapus titik yang mungkin masih tersimpan. */
export async function disablePresence(): Promise<void> {
  localStorage.setItem(OPT_OUT_KEY, '1')
  try {
    await api.del('/me/location')
  } catch {
    /* diamkan — titiknya kedaluwarsa sendiri */
  }
}

export function enablePresence(): void {
  localStorage.removeItem(OPT_OUT_KEY)
  lastSentAt = 0
}

/**
 * Ada darurat: ambil satu titik lokasi lalu kirim.
 *
 * Dipanggil hanya ketika server menyatakan lokasi sedang dibutuhkan.
 *
 * @returns true bila titik benar-benar terkirim.
 */
export async function shareLocationForEmergency(now = Date.now()): Promise<boolean> {
  if (presenceDisabled()) return false
  if (sending) return false
  if (now - lastSentAt < MIN_GAP_MS) return false

  sending = true
  try {
    const pos = await getFix()
    if (!pos) return false

    await api.post('/me/location', {
      lat: pos.lat,
      lng: pos.lng,
      accuracy: pos.accuracy,
    })
    lastSentAt = now
    return true
  } catch {
    return false
  } finally {
    sending = false
  }
}

/** Hanya untuk tes: lupakan keadaan pengiriman terakhir. */
export function resetPresenceState(): void {
  lastSentAt = 0
  sending = false
}
