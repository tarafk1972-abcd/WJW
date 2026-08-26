import { useCallback, useEffect, useRef, useState } from 'react'
import { CATEGORY_META, PANIC_TYPES } from '../lib/meta'
import { useApp } from '../lib/store'
import { Icon } from './Icon'
import type { PanicType } from '../lib/types'

/** Durasi wajib tahan sesuai flow darurat WJW. */
export const HOLD_MS = 1500

/**
 * Enam jenis darurat dengan pengaman false-alarm.
 *
 * Pointer yang dilepas sebelum HOLD_MS tidak pernah memanggil onTrigger,
 * bahkan jika sebuah animation frame lama tiba terlambat. Callback onCancel
 * memberi layar kesempatan menjelaskan bahwa alarm dibatalkan.
 */
export function PanicGrid({
  onTrigger,
  onCancel,
  disabled,
}: {
  onTrigger: (type: PanicType) => void
  onCancel?: (type: PanicType) => void
  disabled?: boolean
}) {
  const { t } = useApp()
  const [holding, setHolding] = useState<PanicType | null>(null)
  const [progress, setProgress] = useState(0)
  const raf = useRef<number | null>(null)
  const start = useRef(0)
  const session = useRef(0)
  const holdingRef = useRef<PanicType | null>(null)
  const onTriggerRef = useRef(onTrigger)
  const onCancelRef = useRef(onCancel)

  useEffect(() => {
    onTriggerRef.current = onTrigger
    onCancelRef.current = onCancel
  }, [onTrigger, onCancel])

  const stop = useCallback((notifyCancel = false) => {
    const held = holdingRef.current
    session.current += 1
    if (raf.current !== null) cancelAnimationFrame(raf.current)
    raf.current = null
    holdingRef.current = null
    setHolding(null)
    setProgress(0)
    if (notifyCancel && held) onCancelRef.current?.(held)
  }, [])

  // Membersihkan frame saat halaman berpindah, tetapi jangan menampilkan toast
  // "dibatalkan" hanya karena komponen sedang dilepas dari React.
  useEffect(() => () => stop(false), [stop])

  const begin = (type: PanicType) => {
    if (disabled || holdingRef.current) return
    const mine = session.current
    holdingRef.current = type
    setHolding(type)
    start.current = performance.now()
    if (navigator.vibrate) navigator.vibrate(18)

    const tick = () => {
      // Frame dari sesi yang dilepas/cancel tidak boleh memicu alarm.
      if (session.current !== mine || holdingRef.current !== type) return
      const p = Math.min(1, (performance.now() - start.current) / HOLD_MS)
      setProgress(p)
      if (p >= 1) {
        stop(false)
        if (navigator.vibrate) navigator.vibrate([90, 50, 90])
        onTriggerRef.current(type)
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
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture?.(event.pointerId)
                begin(type)
              }}
              onPointerUp={() => stop(true)}
              onPointerLeave={() => stop(true)}
              onPointerCancel={() => stop(true)}
              onContextMenu={(event) => event.preventDefault()}
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
