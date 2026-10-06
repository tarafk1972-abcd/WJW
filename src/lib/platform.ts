/**
 * Deteksi platform: browser vs APK (Capacitor).
 *
 * Login "Masuk dengan Google" memakai Google Identity Services, yang hanya
 * berfungsi di browser/webview dengan jaringan dan origin HTTP yang tepat.
 * Di dalam APK, tombol Google sengaja disembunyikan — jalur itu menyusul
 * lewat plugin Capacitor Google Auth (perlu pengaturan terpisah).
 */
export function isNativePlatform(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean }
  }
  return Boolean(w.Capacitor?.isNativePlatform?.())
}

/** Apakah halaman sedang berjalan di dalam iframe (mis. pratinjau)? */
export function inIframe(): boolean {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}
