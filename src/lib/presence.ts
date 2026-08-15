/**
 * Dua hal: menandai letak rumah, dan mengirim posisi saat darurat.
 *
 * LETAK RUMAH dicatat sekali ketika warga mendaftar, lalu diperhalus
 * pada kesempatan pertama ia membuka aplikasi larut malam — saat itu ia
 * hampir pasti sedang di rumah. Rumah tidak berpindah, jadi titik ini
 * cukup dicatat sekali dan membuat warga tetap terhitung sebagai
 * tetangga terdekat walaupun aplikasinya tertutup.
 *
 * POSISI TERKINI hanya dikirim ketika ada peringatan darurat.
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

/**
 * Apakah warga mematikan bantuan lokasi darurat?
 *
 * Tidak pernah berlaku bagi satpam: bagi mereka lokasi adalah alat kerja,
 * bukan pilihan. Penyimpanan ini bisa saja berisi '1' dari sebelum
 * seseorang diangkat menjadi satpam — atau dari versi lama yang sempat
 * menawarkan tombolnya — dan itu tidak boleh melumpuhkan jalur tugasnya.
 */
export function presenceDisabled(): boolean {
  if (isGuard()) return false
  return localStorage.getItem(OPT_OUT_KEY) === '1'
}

/** Peran anggota pada perangkat ini, dicatat saat sinkronisasi. */
const ROLE_KEY = 'wjw.role.v1'

export function rememberRole(role: string | null | undefined): void {
  if (role) localStorage.setItem(ROLE_KEY, role)
  else localStorage.removeItem(ROLE_KEY)
}

function isGuard(): boolean {
  return localStorage.getItem(ROLE_KEY) === 'satpam'
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

/* ---------------- letak rumah ---------------- */

/**
 * Catat letak rumah saat warga baru mendaftar.
 *
 * Dipanggil sekali, tepat setelah pendaftaran berhasil, ketika warga
 * biasanya memang sedang berada di rumahnya. Rumah tidak berpindah, jadi
 * satu titik ini cukup — tidak ada pembacaan ulang berkala.
 */
export async function markHomeOnRegister(): Promise<boolean> {
  return sendHome('register')
}

/**
 * Warga menandai rumahnya sendiri.
 *
 * Satu-satunya cara memperbaiki titik yang meleset, mis. karena GPS
 * sedang buruk saat mendaftar.
 */
export async function setHomeManually(): Promise<boolean> {
  return sendHome('manual')
}

export async function forgetHome(): Promise<void> {
  try {
    await api.del('/me/home')
  } catch {
    /* diamkan */
  }
}

async function sendHome(source: 'register' | 'manual'): Promise<boolean> {
  if (presenceDisabled()) return false
  try {
    const pos = await getFix()
    if (!pos) return false
    await api.post('/me/home', {
      lat: pos.lat,
      lng: pos.lng,
      accuracy: pos.accuracy,
      source,
    })
    return true
  } catch {
    return false
  }
}
