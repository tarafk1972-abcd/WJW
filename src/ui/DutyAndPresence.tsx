/**
 * Dua hal yang berjalan diam-diam di latar:
 *
 *   1. Notifikasi darurat otomatis bagi satpam yang sedang bertugas.
 *   2. Pelaporan posisi terakhir bagi SEMUA peran, agar peringatan
 *      darurat bisa memanggil warga terdekat — yang belum tentu satpam.
 *
 * Menggantikan `PushPrompt` untuk peran satpam. Tidak ada ajakan dan
 * tidak ada tombol tutup: selama satpam berada di dalam area lingkungan,
 * langganan push dipasang sendiri.
 *
 * Yang ditampilkan hanyalah keadaannya, dan hanya bila ada yang perlu
 * dilakukan pengguna — yaitu ketika browser masih menahan izin.
 */
import { useEffect, useState } from 'react'
import { watchLocation } from '../lib/capture'
import {
  ensureDutyPush,
  onDutyInArea,
  resumeDutyPush,
  silencedFor,
} from '../lib/dutyPush'
import { reportLocation } from '../lib/presence'
import { useApp } from '../lib/store'
import { apiMode } from '../lib/sync'
import { enablePush, pushSupported, registerServiceWorker } from '../lib/pushClient'
import { Icon } from './Icon'

type State = 'off' | 'on' | 'needsPermission' | 'blocked'

export function DutyAndPresence() {
  const { t, me, community } = useApp()
  const [state, setState] = useState<State>('off')
  const [onDuty, setOnDuty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [silenced, setSilenced] = useState(0)

  const isSatpam = me?.role === 'satpam'

  /*
   * Pantau posisi untuk dua hal:
   *   1. mengetahui satpam sedang di dalam area atau tidak;
   *   2. melaporkan posisi terakhir, agar warga yang menekan tombol
   *      darurat bisa memanggil orang-orang terdekatnya.
   * Berlaku untuk semua peran — tetangga terdekat belum tentu satpam.
   */
  useEffect(() => {
    if (!apiMode() || !me) return
    if (isSatpam) void registerServiceWorker()

    const stop = watchLocation((pos) => {
      if (isSatpam) setOnDuty(onDutyInArea(me, community, pos))
      void reportLocation(pos)
    })
    return stop
  }, [isSatpam, me, community])

  // Nyalakan sendiri begitu masuk area.
  useEffect(() => {
    if (!isSatpam) return
    let alive = true
    void ensureDutyPush(onDuty).then((s) => {
      if (alive) setState(s)
    })
    return () => {
      alive = false
    }
  }, [isSatpam, onDuty, silenced])

  // Peredaman berakhir sendiri; periksa berkala agar kembali menyala.
  useEffect(() => {
    if (!isSatpam) return
    const tick = () => setSilenced(silencedFor())
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [isSatpam])

  if (!isSatpam || !pushSupported() || !onDuty) return null

  // Sedang diredam karena satpam merespons sebuah peringatan.
  if (silenced > 0) {
    return (
      <div className="push-prompt">
        <Icon name="bell" size={17} color="var(--text-3)" />
        <div className="grow">
          <div className="strong" style={{ fontSize: 13.5 }}>
            {t('dutyPushSilenced', { n: Math.ceil(silenced / 60000) })}
          </div>
          <div className="tiny">{t('dutyPushSilencedHint')}</div>
        </div>
        <button
          className="btn btn-sm btn-ghost"
          onClick={() => {
            resumeDutyPush()
            setSilenced(0)
          }}
        >
          {t('dutyPushResume')}
        </button>
      </div>
    )
  }

  // Browser menahan izin: satu sentuhan tetap diperlukan, tetapi
  // disampaikan sebagai kewajiban tugas, bukan tawaran.
  if (state === 'needsPermission') {
    return (
      <div className="push-prompt">
        <Icon name="bell" size={17} color="var(--danger)" />
        <div className="grow">
          <div className="strong" style={{ fontSize: 13.5 }}>
            {t('dutyPushRequired')}
          </div>
          <div className="tiny">{t('dutyPushRequiredHint')}</div>
        </div>
        <button
          className="btn btn-sm btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            const ok = await enablePush()
            setBusy(false)
            setState(ok ? 'on' : 'blocked')
          }}
        >
          {busy ? '…' : t('dutyPushActivate')}
        </button>
      </div>
    )
  }

  // Izin ditolak permanen — hanya bisa dipulihkan lewat setelan browser.
  if (state === 'blocked') {
    return (
      <div className="push-prompt">
        <Icon name="alert" size={17} color="var(--danger)" />
        <div className="grow">
          <div className="strong" style={{ fontSize: 13.5 }}>
            {t('dutyPushBlocked')}
          </div>
          <div className="tiny">{t('dutyPushBlockedHint')}</div>
        </div>
      </div>
    )
  }

  // Aktif: tampilkan sebagai penanda tenang, tanpa tombol apa pun.
  return (
    <div className="push-prompt duty-on">
      <Icon name="shield" size={17} color="var(--brand)" />
      <div className="grow">
        <div className="strong" style={{ fontSize: 13.5 }}>
          {t('dutyPushOn')}
        </div>
        <div className="tiny">{t('dutyPushOnHint')}</div>
      </div>
    </div>
  )
}
