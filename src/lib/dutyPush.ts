/**
 * Notifikasi darurat otomatis untuk satpam yang sedang bertugas.
 *
 * Satpam tidak boleh dibebani memilih. Selama ia berada di dalam area
 * lingkungan, notifikasi darurat dinyalakan sendiri — tanpa ajakan, tanpa
 * tombol. Peringatan yang terlewat karena notifikasi belum diaktifkan
 * adalah kegagalan yang tidak boleh terjadi pada orang yang justru
 * ditugaskan menerimanya.
 *
 * Mematikannya hanya boleh lewat satu jalan: saat merespons sebuah
 * peringatan (lihat `silenceWhileResponding`). Di luar itu, tidak ada
 * cara mematikannya dari dalam aplikasi.
 *
 * Catatan jujur soal batasnya: browser hanya bisa meminta izin notifikasi
 * lewat gestur pengguna, dan izin yang sudah ditolak tidak bisa dipulihkan
 * oleh kode mana pun. Jadi "otomatis" di sini berarti: begitu izinnya ada,
 * langganan push dipasang sendiri tanpa bertanya. Bila izin belum
 * diberikan, satpam tetap harus menyentuh sekali — dan itu ditampilkan
 * sebagai kewajiban tugas, bukan pilihan.
 */
import type { Community, Member } from './types'
import { pointInPolygon } from './db'
import { enablePush, permission, pushSupported } from './pushClient'

/** Berapa lama peredaman berlaku setelah satpam merespons. */
export const SILENCE_MS = 15 * 60 * 1000

const SILENCE_KEY = 'wjw.duty.silencedUntil'

/**
 * Apakah anggota ini sedang bertugas di dalam area lingkungannya?
 *
 * Hanya satpam. Bila admin belum menggambar area, tidak ada yang bisa
 * dipastikan, jadi jawabannya false — lebih baik memakai jalur biasa
 * daripada memaksa berdasarkan tebakan.
 */
export function onDutyInArea(
  me: Member | null,
  community: Community | null,
  at: { lat: number; lng: number } | null,
): boolean {
  if (!me || me.role !== 'satpam' || me.status !== 'active') return false
  if (!community || community.area.length < 3) return false
  if (!at) return false
  return pointInPolygon(at, community.area)
}

/** Redam sementara — hanya dipanggil saat satpam merespons peringatan. */
export function silenceWhileResponding(now = Date.now()): void {
  localStorage.setItem(SILENCE_KEY, String(now + SILENCE_MS))
}

/** Batalkan peredaman lebih awal. */
export function resumeDutyPush(): void {
  localStorage.removeItem(SILENCE_KEY)
}

/** Sisa waktu peredaman dalam milidetik; 0 bila tidak sedang diredam. */
export function silencedFor(now = Date.now()): number {
  const until = Number(localStorage.getItem(SILENCE_KEY) ?? 0)
  if (!until || until <= now) return 0
  return until - now
}

/**
 * Pastikan langganan push terpasang untuk satpam yang sedang bertugas.
 *
 * @returns 'on' bila aktif, 'needsPermission' bila menunggu satu sentuhan
 *          pengguna, 'blocked' bila izin ditolak permanen, 'off' bila
 *          tidak berlaku.
 */
export async function ensureDutyPush(
  onDuty: boolean,
): Promise<'on' | 'needsPermission' | 'blocked' | 'off'> {
  if (!onDuty || !pushSupported()) return 'off'
  if (silencedFor() > 0) return 'off'

  const perm = permission()
  if (perm === 'denied') return 'blocked'
  if (perm === 'default') return 'needsPermission'

  // Izin sudah ada: pasang langganan tanpa bertanya apa pun.
  return (await enablePush()) ? 'on' : 'needsPermission'
}
