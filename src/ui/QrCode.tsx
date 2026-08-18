import QRCode from 'qrcode'
import { useEffect, useState } from 'react'

/** Renders a payload as a QR code image (data URL). */
export function QrCode({ value, size = 210 }: { value: string; size?: number }) {
  const [src, setSrc] = useState('')

  useEffect(() => {
    let alive = true
    QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      color: { dark: '#0d1117', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    })
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(''))
    return () => {
      alive = false
    }
  }, [value, size])

  if (!src) return <div className="qr-placeholder" style={{ width: size, height: size }} />
  return <img src={src} width={size} height={size} alt="QR" className="qr-img" />
}
