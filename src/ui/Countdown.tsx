import { useEffect, useRef, useState } from 'react'
import { useApp } from '../lib/store'
import { Icon } from './Icon'

/**
 * Jendela pembatalan lima detik setelah tahan-panik selesai.
 *
 * Tidak ada tombol "kirim sekarang": alur sengaja konsisten agar warga
 * mendapat kesempatan yang jelas untuk membatalkan alarm palsu. doneRef
 * mencegah render ulang pada angka nol memanggil API lebih dari sekali.
 */
export function Countdown({
  seconds = 5,
  label,
  sending = false,
  onDone,
  onCancel,
}: {
  seconds?: number
  label: string
  sending?: boolean
  onDone: () => void
  onCancel: () => void
}) {
  const { t } = useApp()
  const [left, setLeft] = useState(seconds)
  const completed = useRef(false)
  const onDoneRef = useRef(onDone)

  useEffect(() => {
    onDoneRef.current = onDone
  }, [onDone])

  useEffect(() => {
    if (left <= 0) {
      if (!completed.current) {
        completed.current = true
        onDoneRef.current()
      }
      return
    }
    const id = window.setTimeout(() => setLeft((value) => value - 1), 1000)
    return () => window.clearTimeout(id)
  }, [left])

  return (
    <div className="countdown" role="alertdialog" aria-live="assertive" aria-modal="true">
      <div className="chip chip-danger">
        <Icon name="siren" size={13} /> {label}
      </div>
      <div className="num">{sending ? '…' : left}</div>
      <div>
        <h2>{sending ? t('gettingLocation') : 'DARURAT AKAN DIKIRIM'}</h2>
        <p className="muted" style={{ marginTop: 6, maxWidth: 300 }}>
          {sending
            ? 'Menghubungi server. Jangan tutup aplikasi hingga ada konfirmasi.'
            : 'Batalkan dalam hitungan mundur ini bila tombol tertekan tidak sengaja.'}
        </p>
      </div>
      <div style={{ width: '100%', maxWidth: 320 }}>
        <button
          className="btn btn-ghost"
          disabled={sending}
          onClick={() => {
            // Lindungi juga ketika induk membutuhkan satu render untuk menutup modal.
            completed.current = true
            onCancel()
          }}
        >
          <Icon name="x" size={16} /> {t('cancelAlert')}
        </button>
      </div>
    </div>
  )
}
