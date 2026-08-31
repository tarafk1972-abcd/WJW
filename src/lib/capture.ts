/** How long the automatic voice memo runs when an alert fires. */
export const VOICE_SECONDS = 15

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader()
    fr.onload = () => res(String(fr.result))
    fr.onerror = rej
    fr.readAsDataURL(blob)
  })
}

export interface VoiceCapture {
  /** Resolves with the recording once the timer ends or stop() is called. */
  done: Promise<{ dataUrl: string; seconds: number } | null>
  stop: () => void
}

/**
 * Records ~15 seconds of audio from the microphone.
 * Returns null (never throws) when permission is denied or unsupported, so a
 * missing microphone can never block an emergency alert from going out.
 */
export function recordVoice(seconds = VOICE_SECONDS): VoiceCapture {
  let stopFn: () => void = () => {}

  const done = (async () => {
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return null
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      return null
    }

    return await new Promise<{ dataUrl: string; seconds: number } | null>((resolve) => {
      let rec: MediaRecorder
      try {
        rec = new MediaRecorder(stream)
      } catch {
        stream.getTracks().forEach((t) => t.stop())
        resolve(null)
        return
      }

      const chunks: BlobPart[] = []
      const started = Date.now()
      let settled = false

      const finish = async () => {
        if (settled) return
        settled = true
        stream.getTracks().forEach((t) => t.stop())
        clearTimeout(timer)
        if (!chunks.length) return resolve(null)
        try {
          const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
          resolve({
            dataUrl: await blobToDataUrl(blob),
            seconds: Math.round((Date.now() - started) / 1000),
          })
        } catch {
          resolve(null)
        }
      }

      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      rec.onstop = () => void finish()
      rec.onerror = () => void finish()

      const timer = setTimeout(() => {
        if (rec.state !== 'inactive') rec.stop()
      }, seconds * 1000)

      stopFn = () => {
        if (rec.state !== 'inactive') rec.stop()
      }

      try {
        rec.start()
      } catch {
        void finish()
      }
    })
  })()

  return { done, stop: () => stopFn() }
}

/**
 * Mengapa lokasi tidak bisa diambil sama sekali — bila memang begitu.
 *
 * Peramban hanya mengizinkan geolokasi pada "konteks aman": https://
 * atau localhost. Aplikasi yang dibuka lewat alamat Wi-Fi biasa seperti
 * http://192.168.1.5:5173 ditolak tanpa pernah menampilkan permintaan
 * izin, jadi dari layar hal itu tidak bisa dibedakan dari GPS yang
 * sedang lemah sinyal. Perbedaannya penting: yang satu bisa membaik
 * dengan menunggu, yang satu lagi tidak akan pernah.
 *
 * Mengembalikan null bila tidak ada halangan permanen.
 */
export function locationBlockedReason(): 'insecure' | 'unsupported' | null {
  // isSecureContext bisa tidak ada di lingkungan non-peramban.
  if (typeof isSecureContext === 'boolean' && !isSecureContext) return 'insecure'
  if (!navigator.geolocation) return 'unsupported'
  return null
}

/**
 * One-shot GPS fix. Resolves null instead of throwing.
 *
 * Browser `timeout` biasanya dipatuhi, tetapi beberapa WebView pernah tidak
 * memanggil callback saat GPS/permission macet. Timer kedua memastikan jalur
 * SOS tetap lanjut ke server setelah batas waktu, dengan lokasi null bila
 * perlu—alarm tidak boleh tertahan oleh sensor yang tidak responsif.
 */
export function getFix(
  timeout = 8000,
): Promise<{ lat: number; lng: number; accuracy: number | null } | null> {
  if (!navigator.geolocation) return Promise.resolve(null)
  const requestedTimeout = Number.isFinite(timeout) ? Math.trunc(timeout) : 8000
  const safeTimeout = Math.max(1, Math.min(requestedTimeout, 30_000))
  return new Promise((resolve) => {
    let settled = false
    let timer: number | undefined
    const finish = (value: { lat: number; lng: number; accuracy: number | null } | null) => {
      if (settled) return
      settled = true
      if (timer !== undefined) window.clearTimeout(timer)
      resolve(value)
    }
    // Sedikit toleransi agar callback browser yang tepat di batas waktu tetap
    // berkesempatan membawa koordinat, tanpa memperpanjang jalur SOS berarti.
    timer = window.setTimeout(() => finish(null), safeTimeout + 100)
    try {
      navigator.geolocation.getCurrentPosition(
        (p) =>
          finish({
            lat: p.coords.latitude,
            lng: p.coords.longitude,
            accuracy: p.coords.accuracy ?? null,
          }),
        () => finish(null),
        { enableHighAccuracy: true, timeout: safeTimeout, maximumAge: 0 },
      )
    } catch {
      finish(null)
    }
  })
}

/**
 * Streams location updates. Returns a stop function; safe to call when
 * geolocation is unavailable.
 */
export function watchLocation(
  onPing: (p: { lat: number; lng: number; accuracy: number | null }) => void,
): () => void {
  if (!navigator.geolocation?.watchPosition) return () => {}
  const id = navigator.geolocation.watchPosition(
    (p) =>
      onPing({
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        accuracy: p.coords.accuracy ?? null,
      }),
    () => {},
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
  )
  return () => navigator.geolocation.clearWatch(id)
}
