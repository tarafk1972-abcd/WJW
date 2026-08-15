import { useEffect, useState } from 'react'
import { useApp } from '../lib/store'
import { apiMode } from '../lib/sync'
import { enablePush, permission, pushSupported, registerServiceWorker } from '../lib/pushClient'
import { Icon } from './Icon'

const DISMISS_KEY = 'wjw.pushPrompt.dismissed'

/**
 * Ajakan mengaktifkan notifikasi darurat, untuk warga dan pengurus.
 *
 * Hanya muncul bila memakai server, didukung perangkat, belum diizinkan,
 * dan belum pernah ditutup pengguna.
 *
 * TIDAK pernah ditampilkan kepada satpam: bagi mereka notifikasi darurat
 * bukan pilihan melainkan bagian dari tugas, dan diurus otomatis oleh
 * `DutyAndPresence` berdasarkan keberadaan mereka di area. Menawarkan
 * tombol "tutup" kepada orang yang justru ditugaskan menerima peringatan
 * adalah cara paling mudah kehilangan peringatan itu.
 */
export function PushPrompt() {
  const { t, me } = useApp()
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)

  /*
   * Jangan tampilkan sebelum peran diketahui.
   *
   * Saat halaman baru dibuka, `me` sesaat masih null — sinkronisasi
   * pertama belum selesai. Menganggapnya "bukan satpam" membuat ajakan
   * ini sempat berkedip di layar satpam, dan sekali ditekan "tutup",
   * pilihannya menetap. Menunggu sampai perannya jelas menghilangkan
   * celah itu sepenuhnya.
   */
  const roleKnown = !!me
  const isSatpam = me?.role === 'satpam'

  useEffect(() => {
    if (!roleKnown || isSatpam) return
    if (!apiMode() || !pushSupported()) return
    void registerServiceWorker()
    if (permission() === 'default' && !localStorage.getItem(DISMISS_KEY)) {
      setShow(true)
    }
  }, [roleKnown, isSatpam])

  // Satpam tidak pernah ditawari: notifikasi mereka diurus DutyAndPresence.
  if (!roleKnown || isSatpam) return null

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
