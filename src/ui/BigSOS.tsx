import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../lib/store'

/** Hold duration for the main emergency button. */
export const SOS_HOLD_MS = 1500

/**
 * The single large red button of the MVP.
 *
 * Requires a deliberate 1.5-second hold (with a progress ring) so a pocket tap
 * cannot mobilise someone's whole safety network. A released hold can never
 * fire: queued animation frames check a session token before completing.
 */
export function BigSOS({
  onTrigger,
  disabled,
}: {
  onTrigger: () => void
  disabled?: boolean
}) {
  const { t } = useApp()
  const [holding, setHolding] = useState(false)
  const [progress, setProgress] = useState(0)
  const raf = useRef<number | null>(null)
  const start = useRef(0)
  const session = useRef(0)

  const stop = useCallback(() => {
    session.current += 1
    if (raf.current !== null) cancelAnimationFrame(raf.current)
    raf.current = null
    setHolding(false)
    setProgress(0)
  }, [])

  useEffect(() => stop, [stop])

  const begin = () => {
    if (disabled) return
    const mine = session.current
    setHolding(true)
    start.current = performance.now()
    if (navigator.vibrate) navigator.vibrate(20)

    const tick = () => {
      if (session.current !== mine) return
      const p = Math.min(1, (performance.now() - start.current) / SOS_HOLD_MS)
      setProgress(p)
      if (p >= 1) {
        stop()
        if (navigator.vibrate) navigator.vibrate([100, 60, 100, 60, 200])
        onTrigger()
        return
      }
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
  }

  return (
    <button
      type="button"
      className={`big-sos ${holding ? 'holding' : ''}`}
      aria-label={t('sosBig')}
      disabled={disabled}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId)
        begin()
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span
        className="ring"
        style={{
          background: holding
            ? `conic-gradient(#fff ${progress * 360}deg, transparent 0deg)`
            : 'transparent',
          WebkitMask: 'radial-gradient(circle, transparent 61%, #000 62%)',
          mask: 'radial-gradient(circle, transparent 61%, #000 62%)',
        }}
      />
      <span style={{ textAlign: 'center' }}>
        <span className="cap">{t('sosBig')}</span>
        <span className="sub" style={{ display: 'block' }}>
          {holding ? `${Math.ceil((1 - progress) * (SOS_HOLD_MS / 1000))}…` : t('sosTapHint')}
        </span>
      </span>
    </button>
  )
}
