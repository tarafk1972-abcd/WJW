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
import { disablePush, enablePush, permission, pushSupported } from './pushClient'

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
  /** Satpam ini sedang menjalankan ronda yang belum ditutup. */
  patrolling = false,
): boolean {
  if (!me || me.role !== 'satpam' || me.status !== 'active') return false

  /*
   * Ronda yang sedang berjalan adalah pernyataan tegas "saya bertugas".
   * Itu lebih dapat dipercaya daripada pembacaan GPS: satpam yang sedang
   * berkeliling bisa saja sejenak melewati batas area, atau sinyalnya
   * hilang di antara bangunan. Selama rondanya belum ditutup, notifikasi
   * tidak boleh padam.
   */
  if (patrolling) return true

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
  if (!pushSupported()) return 'off'

  /*
   * Di luar area, atau sedang meredam karena merespons: langganan
   * dicabut, bukan sekadar tidak dipasang.
   *
   * Tanpa pencabutan ini, satpam yang pulang tetap dibunyikan peringatan
   * sepanjang malam — persis kebalikan dari "otomatis tidak aktif ketika
   * tidak sedang bertugas".
   */
  if (!onDuty || silencedFor() > 0) {
    await disablePush()
    return 'off'
  }

  const perm = permission()
  if (perm === 'denied') return 'blocked'
  if (perm === 'default') return 'needsPermission'

  // Izin sudah ada: pasang langganan tanpa bertanya apa pun.
  return (await enablePush()) ? 'on' : 'needsPermission'
}

/* ---------------- izin tanpa tombol pilihan ---------------- */

/**
 * Minta izin notifikasi pada sentuhan pertama satpam di layar.
 *
 * Peramban hanya mengizinkan permintaan izin selama sebuah gestur
 * pengguna. Itu aturan browser dan tidak bisa dilewati. Tetapi gestur itu
 * TIDAK harus berupa tombol "Izinkan" — sentuhan apa pun di dalam
 * aplikasi sudah memenuhinya.
 *
 * Jadi tidak perlu menawarkan pilihan kepada satpam: begitu ia menyentuh
 * layar untuk keperluan apa pun, izin diminta sekali. Yang tersisa
 * hanyalah dialog bawaan peramban, yang memang tidak bisa dihilangkan
 * oleh aplikasi mana pun.
 *
 * @returns fungsi pembatal.
 */
export function requestPushOnNextTouch(onSettled?: () => void): () => void {
  if (!pushSupported() || permission() !== 'default') return () => {}

  let done = false
  const events = ['pointerdown', 'touchstart', 'keydown'] as const

  const handler = () => {
    if (done) return
    done = true
    stop()
    void enablePush().finally(() => onSettled?.())
  }

  const stop = () => {
    for (const e of events) window.removeEventListener(e, handler, true)
  }

  for (const e of events) window.addEventListener(e, handler, true)
  return stop
}
