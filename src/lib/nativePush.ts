/**
 * Notifikasi native Android (APK) lewat Firebase Cloud Messaging.
 *
 * Kenapa berkas ini ada: di dalam APK, aplikasi berjalan dalam WebView yang
 * tidak mendukung Web Push. Tanpa jalur ini, warga pemakai APK tidak
 * menerima notifikasi apa pun saat aplikasi tertutup — dan SOS tetangga
 * lewat begitu saja.
 *
 * Empat keputusan yang perlu diketahui sebelum mengubah berkas ini:
 *
 * 1. TANPA IMPORT PAKET. Plugin diakses lewat jembatan global
 *    `window.Capacitor.Plugins`, bukan `import`. Dengan begitu build web
 *    biasa tidak butuh @capacitor/push-notifications sama sekali, dan
 *    aplikasi tetap berjalan di browser tanpa perubahan apa pun.
 *
 * 2. CHANNEL TIDAK BISA DIUBAH SETELAH DIBUAT. Android membekukan suara,
 *    getaran, dan tingkat kepentingan sebuah channel pada saat pembuatannya.
 *    Mengubahnya kemudian tidak berpengaruh sampai warga menghapus dan
 *    memasang ulang aplikasi. Karena itu id-nya diberi versi: bila setelan
 *    perlu berubah, NAIKKAN ANGKANYA menjadi wjw_sos_v2.
 *
 * 3. NAMA BERKAS SUARA TANPA TANDA HUBUNG. Android menolak `sos-alert` sebagai
 *    nama resource. Berkasnya disalin CI ke res/raw/sos_alert.mp3.
 *
 * 4. GAGAL DENGAN DIAM. Di browser biasa seluruh berkas ini tidak melakukan
 *    apa-apa. Tidak ada satu pun kegagalan di sini yang boleh menghentikan
 *    aplikasi berjalan.
 */

import { api } from './api'
import { playSosAlert } from './alertSound'

/** Harus sama persis dengan SOS_CHANNEL_ID di server/fcm.ts. */
const CHANNEL_SOS = 'wjw_sos_v1'

/** Nama resource Android, tanpa tanda hubung dan tanpa huruf kapital. */
const SUARA_SOS = 'sos_alert'

interface PluginPush {
  createChannel(opts: Record<string, unknown>): Promise<void>
  checkPermissions(): Promise<{ receive: string }>
  requestPermissions(): Promise<{ receive: string }>
  register(): Promise<void>
  addListener(event: string, cb: (data: unknown) => void): Promise<unknown>
}

interface JembatanCapacitor {
  isNativePlatform?: () => boolean
  getPlatform?: () => string
  Plugins?: { PushNotifications?: PluginPush }
}

function jembatan(): JembatanCapacitor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { Capacitor?: JembatanCapacitor }
  return w.Capacitor ?? null
}

/** Apakah aplikasi sedang berjalan di dalam APK, bukan di browser. */
export function nativePushSupported(): boolean {
  const c = jembatan()
  return Boolean(c?.isNativePlatform?.() && c.Plugins?.PushNotifications)
}

let sudahJalan = false
let tokenTerakhir = ''

/** Token perangkat saat ini, untuk pencabutan saat keluar akun. */
export function nativePushToken(): string {
  return tokenTerakhir
}

/**
 * Menyalakan notifikasi native. Aman dipanggil berkali-kali; hanya kali
 * pertama yang bekerja.
 *
 * @returns true bila perangkat berhasil didaftarkan ke server.
 */
export async function initNativePush(): Promise<boolean> {
  if (sudahJalan) return Boolean(tokenTerakhir)
  const plugin = jembatan()?.Plugins?.PushNotifications
  if (!nativePushSupported() || !plugin) return false
  sudahJalan = true

  try {
    // Channel dibuat SEBELUM notifikasi pertama tiba. Kalau notifikasi
    // datang lebih dulu, Android memakai channel bawaan yang tidak bersuara
    // sirene — dan channel bawaan itu tidak bisa diperbaiki kemudian.
    await plugin.createChannel({
      id: CHANNEL_SOS,
      name: 'Panggilan Darurat',
      description: 'Sirene SOS dari tetangga. Jangan dimatikan.',
      importance: 5, // IMPORTANCE_HIGH — muncul di layar, berbunyi
      visibility: 1, // VISIBILITY_PUBLIC — terbaca di layar terkunci
      sound: SUARA_SOS,
      vibration: true,
      lights: true,
    })
  } catch {
    // Channel gagal dibuat: notifikasi tetap masuk, hanya suaranya bawaan.
  }

  try {
    let izin = await plugin.checkPermissions()
    // Android 13+ mewajibkan permintaan izin saat berjalan. Tanpa ini,
    // notifikasi tidak pernah muncul dan tidak ada pesan galat apa pun.
    if (izin.receive !== 'granted') izin = await plugin.requestPermissions()
    if (izin.receive !== 'granted') return false

    await plugin.addListener('registration', (data: unknown) => {
      const token = (data as { value?: string })?.value ?? ''
      if (!token || token === tokenTerakhir) return
      tokenTerakhir = token
      // Kegagalan diabaikan: warga yang sedang tidak punya sinyal akan
      // mendaftar ulang pada pembukaan aplikasi berikutnya.
      void api.post('/push/fcm/register', { token, platform: 'android' }).catch(() => {})
    })

    await plugin.addListener('registrationError', () => {
      // Umumnya google-services.json tidak ikut terbangun ke dalam APK.
    })

    // Notifikasi yang tiba saat aplikasi sedang dibuka tidak ditampilkan
    // Android sebagai notifikasi biasa. Sirene dalam aplikasi menutup
    // celah itu.
    await plugin.addListener('pushNotificationReceived', (data: unknown) => {
      const isi = data as { data?: Record<string, string> }
      if (isi?.data?.urgent === '1') playSosAlert()
    })

    await plugin.addListener('pushNotificationActionPerformed', (data: unknown) => {
      const tujuan = (data as { notification?: { data?: { url?: string } } })?.notification?.data
        ?.url
      if (tujuan && tujuan.startsWith('/')) window.location.hash = `#${tujuan}`
    })

    await plugin.register()
    return true
  } catch {
    return false
  }
}

/** Lepaskan perangkat ini saat warga keluar akun, agar tidak menerima SOS milik orang lain. */
export async function disableNativePush(): Promise<void> {
  if (!tokenTerakhir) return
  try {
    await api.post('/push/fcm/unregister', { token: tokenTerakhir })
  } catch {
    /* diamkan */
  }
  tokenTerakhir = ''
}
