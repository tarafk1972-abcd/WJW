import { API_BASE, getToken, setToken } from './api'

export interface RealtimeSignal {
  id?: string
  type?: string
  entityId?: string
  at?: number
}

export interface RealtimeOptions {
  /** Dipanggil ketika server mengirim event perubahan state. */
  onSignal: (signal: RealtimeSignal) => void
  /** Status koneksi hanya untuk indikator/debug; bukan sumber kebenaran data. */
  onConnection?: (connected: boolean) => void
}

/**
 * Buka SSE dengan fetch, bukan EventSource.
 *
 * Endpoint API memakai Authorization Bearer. EventSource tidak mendukung
 * header khusus, dan menaruh token di URL akan membuatnya bocor ke history,
 * proxy log, serta analytics. Parser kecil ini mempertahankan header sambil
 * tetap menggunakan format SSE standar.
 */
export function startRealtime(options: RealtimeOptions): () => void {
  if (typeof window === 'undefined' || typeof fetch === 'undefined') return () => {}

  let stopped = false
  let controller: AbortController | null = null
  let retryTimer: number | null = null
  let attempts = 0

  const disconnect = () => {
    controller?.abort()
    controller = null
    if (retryTimer !== null) window.clearTimeout(retryTimer)
    retryTimer = null
  }

  const scheduleRetry = () => {
    if (stopped || retryTimer !== null) return
    // Backoff pendek agar perubahan detik-ke-detik tetap cepat setelah jaringan
    // sementara putus, tetapi tidak membanjiri Fly/proxy saat server mati.
    const delay = Math.min(20_000, 700 * 2 ** Math.min(attempts, 5))
    attempts += 1
    retryTimer = window.setTimeout(() => {
      retryTimer = null
      void connect()
    }, delay)
  }

  const emit = (event: string, data: string) => {
    if (event !== 'state' || !data) return
    try {
      options.onSignal(JSON.parse(data) as RealtimeSignal)
    } catch {
      // Event rusak tidak boleh menghentikan koneksi darurat yang sehat.
    }
  }

  const consume = async (body: ReadableStream<Uint8Array>) => {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let event = 'message'
    let data: string[] = []

    const flush = () => {
      if (data.length > 0) emit(event, data.join('\n'))
      event = 'message'
      data = []
    }

    while (!stopped) {
      const next = await reader.read()
      if (next.done) break
      buffer += decoder.decode(next.value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line) {
          flush()
          continue
        }
        if (line.startsWith(':')) continue // SSE heartbeat/comment
        const colon = line.indexOf(':')
        const field = colon === -1 ? line : line.slice(0, colon)
        const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
        if (field === 'event') event = value
        if (field === 'data') data.push(value)
      }
    }
    // Stream dapat berakhir tanpa newline terakhir.
    if (buffer) {
      const dataLine = buffer.startsWith('data:') ? buffer.slice(5).replace(/^ /, '') : ''
      if (dataLine) data.push(dataLine)
    }
    flush()
  }

  const connect = async () => {
    const token = getToken()
    if (stopped || !token) return

    controller = new AbortController()
    try {
      const response = await fetch(`${API_BASE}/api/events`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
        cache: 'no-store',
        signal: controller.signal,
      })
      if (response.status === 401) {
        // Token kadaluarsa: biarkan AppProvider mengarahkan ke login, jangan
        // loop retry tanpa henti dengan kredensial yang sudah tidak valid.
        setToken(null)
        window.dispatchEvent(new Event('wjw:session-expired'))
        return
      }
      if (!response.ok || !response.body) throw new Error('realtime_unavailable')

      attempts = 0
      options.onConnection?.(true)
      await consume(response.body)
    } catch {
      // Tanda koneksi luring ditampilkan oleh syncState setelah event/focus
      // berikutnya. Jangan menganggap alarm berhasil terkirim di sini.
    } finally {
      options.onConnection?.(false)
      controller = null
      if (!stopped) scheduleRetry()
    }
  }

  void connect()
  return () => {
    stopped = true
    disconnect()
    options.onConnection?.(false)
  }
}
