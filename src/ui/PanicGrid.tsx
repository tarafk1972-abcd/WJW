import { useCallback, useEffect, useRef, useState } from 'react'
import { CATEGORY_META, PANIC_TYPES } from '../lib/meta'
import { useApp } from '../lib/store'
import { Icon } from './Icon'
import type { PanicType } from '../lib/types'

/** How long the user must hold a tile before the alert fires. */
export const HOLD_MS = 1500

/**
 * SaferWatch-style panic tiles: a grid of large emergency types that each
 * require a deliberate press-and-hold, so an accidental tap never fires an
 * alert. Progress is shown as a ring filling around the icon.
 */
export function PanicGrid({
  onTrigger,
  disabled,
}: {
  onTrigger: (type: PanicType) => void
  disabled?: boolean
}) {
  const { t } = useApp()
  const [holding, setHolding] = useState<PanicType | null>(null)
  const [progress, setProgress] = useState(0)
  const raf = useRef<number | null>(null)
  const start = useRef(0)
  /**
   * Incremented on every stop. A queued frame from an aborted hold compares
   * this against its captured value and bails out, so a cancelled press can
   * never fire the alert even if cancelAnimationFrame misses it.
   */
  const session = useRef(0)

  const stop = useCallback(() => {
    session.current += 1
    if (raf.current !== null) cancelAnimationFrame(raf.current)
    raf.current = null
    setHolding(null)
    setProgress(0)
  }, [])

  useEffect(() => stop, [stop])

  const begin = (type: PanicType) => {
    if (disabled) return
    const mine = session.current
    setHolding(type)
    start.current = performance.now()
    if (navigator.vibrate) navigator.vibrate(18)

    const tick = () => {
      // the hold was released/cancelled — ignore this stale frame
      if (session.current !== mine) return
      const p = Math.min(1, (performance.now() - start.current) / HOLD_MS)
      setProgress(p)
      if (p >= 1) {
        stop()
        if (navigator.vibrate) navigator.vibrate([90, 50, 90])
        onTrigger(type)
        return
      }
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
  }

  return (
    <div>
      <p className="panic-hint">
        <Icon name="siren" size={14} /> {t('holdToReport')}
      </p>

      <div className="panic-grid">
        {PANIC_TYPES.map((type) => {
          const meta = CATEGORY_META[type]
          const on = holding === type
          const pct = on ? progress : 0
          return (
            <button
              key={type}
              type="button"
              className={`panic-tile ${on ? 'holding' : ''}`}
              aria-label={t(meta.key)}
              disabled={disabled}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture?.(e.pointerId)
                begin(type)
              }}
              onPointerUp={stop}
              onPointerLeave={stop}
              onPointerCancel={stop}
              onContextMenu={(e) => e.preventDefault()}
            >
              <span
                className="panic-ring"
                style={{
                  background: `conic-gradient(${meta.color} ${pct * 360}deg, transparent 0deg)`,
                }}
              >
                <span className="panic-ico" style={{ color: meta.color }}>
                  <Icon name={meta.icon} size={30} stroke={1.7} />
                </span>
              </span>
              <span className="panic-label">{t(meta.key)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
