import { useEffect, useState } from 'react'
import { useApp } from '../lib/store'
import { apiMode } from '../lib/sync'
import { enablePush, permission, pushSupported, registerServiceWorker } from '../lib/pushClient'
import { Icon } from './Icon'

const DISMISS_KEY = 'wjw.pushPrompt.dismissed'

/**
 * Ajakan mengaktifkan notifikasi darurat.
 * Hanya muncul bila memakai server, didukung perangkat, belum diizinkan,
 * dan belum pernah ditutup pengguna.
 */
export function PushPrompt() {
  const { t } = useApp()
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!apiMode() || !pushSupported()) return
    void registerServiceWorker()
    if (permission() === 'default' && !localStorage.getItem(DISMISS_KEY)) {
      setShow(true)
    }
  }, [])

  if (!show) return null

  return (
    <div className="push-prompt">
      <Icon name="bell" size={17} color="var(--warn)" />
      <div className="grow">
        <div className="strong" style={{ fontSize: 13.5 }}>
          {t('pushEnable')}
        </div>
        <div className="tiny">{t('pushHint')}</div>
      </div>
      <button
        className="btn btn-sm btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          const ok = await enablePush()
          setBusy(false)
          setShow(false)
          if (!ok) localStorage.setItem(DISMISS_KEY, '1')
        }}
      >
        {busy ? '…' : t('yes')}
      </button>
      <button
        className="icon-btn"
        style={{ width: 30, height: 30 }}
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, '1')
          setShow(false)
        }}
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  )
}
