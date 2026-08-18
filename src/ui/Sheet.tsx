import { useEffect, type ReactNode } from 'react'

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean
  onClose: () => void
  title?: string
  subtitle?: string
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="sheet-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="sheet" role="dialog" aria-modal="true">
        <div className="sheet-handle" />
        {title && <h3>{title}</h3>}
        {subtitle && (
          <p className="muted" style={{ marginBottom: 14 }}>
            {subtitle}
          </p>
        )}
        {!subtitle && title && <div style={{ height: 12 }} />}
        {children}
      </div>
    </div>
  )
}
