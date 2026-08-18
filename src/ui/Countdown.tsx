import { useEffect, useState } from 'react'
import { useApp } from '../lib/store'
import { Icon } from './Icon'

/**
 * Grace period shown after a panic tile is held. Gives the user a few seconds
 * to cancel a false alarm before the alert is broadcast.
 */
export function Countdown({
  seconds = 5,
  label,
  onDone,
  onCancel,
}: {
  seconds?: number
  label: string
  onDone: () => void
  onCancel: () => void
}) {
  const { t } = useApp()
  const [left, setLeft] = useState(seconds)

  useEffect(() => {
    if (left <= 0) {
      onDone()
      return
    }
    const id = setTimeout(() => setLeft((v) => v - 1), 1000)
    return () => clearTimeout(id)
  }, [left, onDone])

  return (
    <div className="countdown" role="alertdialog" aria-live="assertive">
      <div className="chip chip-danger">
        <Icon name="siren" size={13} /> {label}
      </div>
      <div className="num">{left}</div>
      <div>
        <h2>{t('panicSending')}</h2>
        <p className="muted" style={{ marginTop: 6, maxWidth: 300 }}>
          {t('sosConfirmBody')}
        </p>
      </div>
      <div style={{ width: '100%', maxWidth: 320 }}>
        <button className="btn btn-ghost" onClick={onCancel}>
          <Icon name="x" size={16} /> {t('cancelAlert')}
        </button>
        <button
          className="btn btn-danger"
          style={{ marginTop: 8 }}
          onClick={onDone}
        >
          <Icon name="siren" size={16} /> {t('sendUpdate')}
        </button>
      </div>
    </div>
  )
}
