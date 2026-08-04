import jsQR from 'jsqr'
import { useEffect, useRef, useState } from 'react'
import { parseInvitePayload } from '../lib/db'
import { useApp } from '../lib/store'
import { Icon } from './Icon'

/**
 * Scans a community invite QR using the rear camera, with an image-upload
 * fallback for when camera permission is unavailable (or on desktop).
 * Emits the normalised invite code.
 */
export function QrScanner({
  onCode,
  onClose,
}: {
  onCode: (code: string) => void
  onClose?: () => void
}) {
  const { t } = useApp()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const raf = useRef<number | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState('')
  const [live, setLive] = useState(false)

  useEffect(() => {
    let cancelled = false

    const scan = () => {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        raf.current = requestAnimationFrame(scan)
        return
      }
      const w = video.videoWidth
      const h = video.videoHeight
      if (!w || !h) {
        raf.current = requestAnimationFrame(scan)
        return
      }
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      ctx.drawImage(video, 0, 0, w, h)
      const img = ctx.getImageData(0, 0, w, h)
      const found = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' })
      if (found?.data) {
        const code = parseInvitePayload(found.data)
        if (code) {
          if (navigator.vibrate) navigator.vibrate(40)
          onCode(code)
          return
        }
      }
      raf.current = requestAnimationFrame(scan)
    }

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(t('cameraDenied'))
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          await video.play().catch(() => {})
          setLive(true)
          raf.current = requestAnimationFrame(scan)
        }
      } catch {
        setError(t('cameraDenied'))
      }
    }

    void start()

    return () => {
      cancelled = true
      if (raf.current !== null) cancelAnimationFrame(raf.current)
      streamRef.current?.getTracks().forEach((tr) => tr.stop())
      streamRef.current = null
    }
  }, [onCode, t])

  const fromFile = async (file: File | undefined) => {
    if (!file) return
    setError('')
    try {
      const url = URL.createObjectURL(file)
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image()
        i.onload = () => res(i)
        i.onerror = rej
        i.src = url
      })
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const found = jsQR(data.data, canvas.width, canvas.height)
      const code = found?.data ? parseInvitePayload(found.data) : ''
      if (code) onCode(code)
      else setError(t('qrNotFound'))
    } catch {
      setError(t('qrNotFound'))
    }
  }

  return (
    <div>
      <div className="qr-frame">
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} hidden />
        <span className="qr-reticle" />
        {!live && !error && <span className="qr-status">{t('scanning')}</span>}
      </div>

      <p className="tiny center" style={{ margin: '10px 0' }}>
        {t('scanQrHint')}
      </p>

      {error && <div className="error-box">{error}</div>}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => void fromFile(e.target.files?.[0])}
      />
      <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
        <Icon name="camera" size={14} /> {t('uploadQr')}
      </button>
      {onClose && (
        <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onClose}>
          {t('cancel')}
        </button>
      )}
    </div>
  )
}
