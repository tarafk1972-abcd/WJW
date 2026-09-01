/**
 * Sirene SOS di dalam aplikasi.
 *
 * Notifikasi push memakai suara bawaan sistem dan tidak bisa diganti dari
 * web. Berkas ini menutup celah lain: selama aplikasi TERBUKA, peringatan
 * darurat berbunyi nyaring dengan suara milik lingkungan sendiri.
 *
 * Tiga keputusan yang perlu diketahui sebelum mengubah berkas ini:
 *
 * 1. Browser MELARANG audio berbunyi sebelum pengguna pernah menyentuh
 *    halaman. Karena itu ada unlockAlertSound(): satu sentuhan pertama
 *    dipakai untuk "membuka kunci" audio, jauh sebelum ada keadaan darurat.
 *    Tanpa ini, sirene pertama justru yang paling mungkin gagal berbunyi.
 *
 * 2. Getaran ikut dinyalakan. Kalau HP dalam mode senyap, suara tidak akan
 *    keluar sama sekali — dan peringatan darurat yang tidak terasa sama
 *    saja dengan tidak terkirim.
 *
 * 3. Sirene berhenti sendiri. Bunyi tanpa henti membuat orang menutup
 *    aplikasi, dan aplikasi yang ditutup tidak menolong siapa pun.
 */

/** Berkas suara. Ditaruh di public/ agar ikut ter-cache service worker. */
export const SOS_SOUND_URL = '/audio/sos-alert.mp3'

/** Sirene berhenti sendiri setelah ini, walau tak seorang pun menyentuh layar. */
const MAKS_DURASI_MS = 25_000

let elemen: HTMLAudioElement | null = null
let terbuka = false
let henti: number | null = null

function audio(): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null
  if (!elemen) {
    elemen = new Audio(SOS_SOUND_URL)
    elemen.loop = true
    elemen.preload = 'auto'
  }
  return elemen
}

/**
 * Membuka kunci autoplay memakai sentuhan pertama pengguna.
 *
 * Diputar sekejap dalam keadaan bisu lalu dihentikan — cukup bagi browser
 * untuk menganggap audio sudah diizinkan. Dipanggil sekali saat aplikasi
 * mulai; pendengarnya mencabut diri setelah berhasil.
 */
export function unlockAlertSound(): () => void {
  if (typeof window === 'undefined' || terbuka) return () => {}

  const buka = () => {
    const a = audio()
    if (!a) return
    const bisuSebelumnya = a.muted
    a.muted = true
    a.play()
      .then(() => {
        a.pause()
        a.currentTime = 0
        a.muted = bisuSebelumnya
        terbuka = true
        lepas()
      })
      .catch(() => {
        // Belum diizinkan; biarkan pendengar menunggu sentuhan berikutnya.
        a.muted = bisuSebelumnya
      })
  }

  const lepas = () => {
    window.removeEventListener('pointerdown', buka)
    window.removeEventListener('keydown', buka)
  }

  window.addEventListener('pointerdown', buka)
  window.addEventListener('keydown', buka)
  return lepas
}

/** Sudah pernah dibuka kuncinya? Berguna untuk menampilkan peringatan di UI. */
export function alertSoundUnlocked(): boolean {
  return terbuka
}

/**
 * Membunyikan sirene darurat.
 *
 * Aman dipanggil berkali-kali: panggilan saat sirene masih berbunyi hanya
 * memperpanjang batas waktunya, bukan menumpuk suara kedua.
 */
export function playSosAlert(): void {
  if (typeof window === 'undefined') return

  // Getaran panjang; satu-satunya isyarat yang menembus mode senyap.
  try {
    navigator.vibrate?.([500, 200, 500, 200, 500])
  } catch {
    /* perangkat tanpa getar — abaikan */
  }

  const a = audio()
  if (a) {
    a.currentTime = 0
    // Kegagalan diabaikan dengan sengaja: kalau berkas belum disalin atau
    // autoplay masih terkunci, getaran di atas tetap jalan.
    void a.play().catch(() => {})
  }

  if (henti !== null) window.clearTimeout(henti)
  henti = window.setTimeout(stopSosAlert, MAKS_DURASI_MS)
}

/** Menghentikan sirene — dipakai tombol "Saya lihat" atau saat waktu habis. */
export function stopSosAlert(): void {
  if (henti !== null) {
    window.clearTimeout(henti)
    henti = null
  }
  try {
    navigator.vibrate?.(0)
  } catch {
    /* abaikan */
  }
  if (!elemen) return
  elemen.pause()
  elemen.currentTime = 0
}

/** Sedang berbunyi? */
export function sosAlertPlaying(): boolean {
  return Boolean(elemen && !elemen.paused)
}
