import { api } from './api'

/**
 * Pendaftaran notifikasi push di sisi browser.
 * Semua fungsi aman dipanggil di lingkungan yang tidak mendukung push —
 * mereka mengembalikan false, bukan melempar error.
 */

function urlBase64ToUint8Array(base64: string): BufferSource {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const buf = new ArrayBuffer(raw.length)
  const out = new Uint8Array(buf)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function pushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null
  try {
    return await navigator.serviceWorker.register('/sw.js')
  } catch {
    return null
  }
}

/** Status izin notifikasi saat ini. */
export function permission(): NotificationPermission | 'unsupported' {
  if (!pushSupported()) return 'unsupported'
  return Notification.permission
}

/**
 * Minta izin lalu daftarkan langganan push ke server.
 * @returns true bila berhasil berlangganan.
 */
export async function enablePush(): Promise<boolean> {
  if (!pushSupported()) return false
  try {
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') return false

    const reg = (await navigator.serviceWorker.getRegistration()) ?? (await registerServiceWorker())
    if (!reg) return false
    await navigator.serviceWorker.ready

    const { key } = await api.get<{ key: string }>('/push/key')
    if (!key) return false // server belum dikonfigurasi VAPID

    const existing = await reg.pushManager.getSubscription()
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      }))

    const json = sub.toJSON() as {
      endpoint: string
      keys: { p256dh: string; auth: string }
    }
    await api.post('/push/subscribe', json)
    return true
  } catch {
    return false
  }
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    if (sub) {
      await api.post('/push/unsubscribe', { endpoint: sub.endpoint })
      await sub.unsubscribe()
    }
  } catch {
    /* diamkan */
  }
}
