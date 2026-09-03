/**
 * Denyut kehadiran klien.
 *
 * Aplikasi menyebut server secara ringan kira-kira sekali semenit selama
 * dipakai. Ini melakukan dua hal sekaligus:
 *
 *   1. Membuktikan ke server bahwa aplikasi ini baru saja terbuka dan
 *      terhubung — nilailah yang dipakai Admin untuk melihat satpam mana
 *      yang sedang aktif. Sama sekali tidak mengirim GPS.
 *   2. Memberi jalur ringan untuk menjalin ulang hubungan bila koneksi
 *      terputus, tanpa bergantung pada satu stream SSE yang bisa diam
 *      oleh Android saat HP dipindahkan.
 *
 * Panggilan sengaja dibuang (fire-and-forget): kegagalan jaringan tidak
 * boleh mengganggu alur utama aplikasi. `last_seen_at` memang akan
 * kedaluwarsa dengan sendirinya di sisi server saat perangkat benar-benar
 * meninggalkan aplikasi.
 */
import { api, getToken } from './api'

/** Jarak antar denyut. Jauh di bawah ambang "aktif" server (3 menit). */
export const HEARTBEAT_MS = 60_000

let lastPing = 0
let stopping = false

/** Kirim satu denyut bila token ada dan belum ada denyut baru-baru ini. */
export async function pingPresence(now = Date.now()): Promise<void> {
  if (!getToken()) return
  if (stopping) return
  // Redam lonjakan: beberapa event (visible, online, interval) bisa tiba
  // bersamaan dan tidak perlu membanjiri server.
  if (now - lastPing < 10_000) return
  lastPing = now
  try {
    await api.post('/me/presence')
  } catch {
    // Diamkan — denyut berikutnya yang akan mencoba lagi.
  }
}

/**
 * Mulai denyut berkala selama pengguna menandatangani.
 *
 * Membersihkan interval saat aplikasi ditutup. Kembalikan fungsi
 * pembatal untuk dipanggil pada unmount.
 */
export function startPresenceHeartbeat(): () => void {
  if (typeof window === 'undefined' || !getToken()) return () => {}

  stopping = false
  lastPing = 0
  void pingPresence()

  const interval = window.setInterval(() => void pingPresence(), HEARTBEAT_MS)

  const onVisible = () => {
    if (document.visibilityState === 'visible') void pingPresence()
  }
  const onOnline = () => void pingPresence()
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', onOnline)

  return () => {
    stopping = true
    window.clearInterval(interval)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', onOnline)
  }
}

/** Hanya untuk tes: setel ulang keadaan denyut. */
export function resetPresenceHeartbeat(): void {
  lastPing = 0
  stopping = false
}
