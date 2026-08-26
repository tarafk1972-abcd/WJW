import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { alertApi } from '../lib/api'
import { getFix, watchLocation } from '../lib/capture'
import { apiMode, mutate, syncState } from '../lib/sync'
import { alertAudience } from '../lib/db'
import { fmtDateTime, timeAgo } from '../lib/format'
import { CATEGORY_META } from '../lib/meta'
import { useApp } from '../lib/store'
import { Countdown } from '../ui/Countdown'
import { Icon, type IconName } from '../ui/Icon'
import { MapView } from '../ui/MapView'
import { PanicGrid } from '../ui/PanicGrid'
import { useToast } from '../ui/Toast'
import type { ContactKind, PanicType, Report } from '../lib/types'

/** Batas lampiran: penyimpanan browser hanya ~5 MB total. */
const MAX_MB = 2

function emergencyRequestKey(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replaceAll('-', '')
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 16)}`
}

export const KIND_META: Record<
  ContactKind,
  { key: 'family' | 'friend' | 'responder' | 'guard' | 'volunteer'; emoji: string; color: string; bg: string }
> = {
  family: { key: 'family', emoji: '👨‍👩‍👧', color: 'var(--brand)', bg: 'var(--brand-soft)' },
  friend: { key: 'friend', emoji: '🤝', color: 'var(--info)', bg: 'var(--info-soft)' },
  responder: { key: 'responder', emoji: '🛡️', color: 'var(--purple)', bg: 'rgba(163,113,247,.16)' },
  guard: { key: 'guard', emoji: '👮', color: 'var(--warn)', bg: 'var(--warn-soft)' },
  volunteer: { key: 'volunteer', emoji: '🙋', color: '#5eead4', bg: 'rgba(94,234,212,.16)' },
}

export default function Panic() {
  const { db, me, community, t, lang } = useApp()
  const nav = useNavigate()
  const toast = useToast()

  const [activeId, setActiveId] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  const [armed, setArmed] = useState<{ type: PanicType; key: string } | null>(null)
  const photoRef = useRef<HTMLInputElement>(null)
  const unwatch = useRef<(() => void) | null>(null)

  /** My own alert that is still live. */
  const active: Report | null = useMemo(() => {
    if (!me) return null
    const byId = activeId ? db.reports.find((r) => r.id === activeId) : null
    if (byId?.live && !byId.cancelledAt) return byId
    return (
      db.reports.find(
        (r) => r.authorId === me.id && r.kind === 'sos' && r.live && !r.cancelledAt,
      ) ?? null
    )
  }, [db.reports, me, activeId])

  /** Alerts from other people that I am a recipient of. */
  const incoming = useMemo(() => {
    if (!me || !community) return []
    return db.reports.filter(
      (r) =>
        r.communityId === community.id &&
        r.kind === 'sos' &&
        r.authorId !== me.id &&
        r.status !== 'resolved' &&
        r.recipients.some((x) => x.memberId === me.id),
    )
  }, [db.reports, me, community])

  const audienceCount = useMemo(
    () => (me ? alertAudience(db, me).length : 0),
    [db, me],
  )

  /* keep a live location watcher running for the duration of my alert */
  useEffect(() => {
    if (!active?.live) {
      unwatch.current?.()
      unwatch.current = null
      return
    }
    if (unwatch.current) return
    const id = active.id
    unwatch.current = watchLocation((p) => {
      // Titik baru hanya tampil setelah endpoint server menerimanya dan SSE
      // menyegarkan state. Jangan menulis jejak lokal yang bisa tampak sukses
      // walau koneksi putus di tengah perjalanan.
      if (apiMode()) void alertApi.location(id, p.lat, p.lng, p.accuracy)
    })
    return () => {
      unwatch.current?.()
      unwatch.current = null
    }
  }, [active?.live, active?.id])

  /**
   * Hanya server yang boleh menjadi sumber kebenaran untuk darurat. Mode
   * luring TIDAK membuat laporan lokal karena itu dapat memberi kesan salah
   * bahwa bantuan sudah dihubungi.
   */
  const fire = useCallback(
    async (type: PanicType, idempotencyKey: string) => {
      if (!me || !community) return
      if (!apiMode()) {
        setArmed(null)
        toast('Peringatan: koneksi ke server gagal. Darurat belum terkirim.', 'err')
        return
      }

      setLocating(true)
      try {
        // Jangan menunggu GPS lama saat seseorang membutuhkan bantuan. Alert
        // dikirim maksimal sekitar 1,5 detik kemudian; watchLocation akan
        // menambahkan titik yang lebih baik setelah insiden aktif.
        const fix = await getFix(1500)
        const at = fix ? { lat: fix.lat, lng: fix.lng } : null
        const result = await alertApi.raise(type, at, fix?.accuracy ?? null, idempotencyKey)
        const report = result.report as unknown as Report
        await syncState()
        setActiveId(report.id)
        setArmed(null)
        toast(t('sentTo', { n: report.recipients.length }), 'err')
        if (navigator.vibrate) navigator.vibrate([200, 80, 200])
      } catch {
        setArmed(null)
        // Tidak ada toast sukses atau incident lokal pada jalur ini.
        toast('Peringatan: koneksi ke server gagal. Darurat belum terkirim.', 'err')
      } finally {
        setLocating(false)
      }
    },
    [me, community, t, toast],
  )

  const attach = async (file: File | undefined) => {
    if (!file || !active) return
    if (file.size > MAX_MB * 1024 * 1024) return toast(t('fileTooBig', { n: MAX_MB }), 'err')
    const dataUrl = await new Promise<string>((res, rej) => {
      const fr = new FileReader()
      fr.onload = () => res(String(fr.result))
      fr.onerror = rej
      fr.readAsDataURL(file)
    })
    const ok = await mutate(() => alertApi.attach(active.id, dataUrl))
    if (!ok) {
      toast('Foto belum terkirim. Periksa koneksi lalu coba lagi.', 'err')
      return
    }
    toast(t('mediaAdded'))
  }

  if (!me || !community) return null

  /* ------------------------- ACTIVE ALERT VIEW ------------------------- */
  if (active) {
    const last = active.track[active.track.length - 1]
    const ackCount = active.recipients.filter((r) => r.acknowledgedAt).length

    return (
      <div className="page">
        <div className="alert-hero">
          <h2>
            <span className="rec-dot" /> {t('alertActive')}
          </h2>
          <p className="muted" style={{ marginTop: 6 }}>
            {t('sentTo', { n: active.recipients.length })} ·{' '}
            {fmtDateTime(active.createdAt, lang)}
          </p>
          {ackCount > 0 && (
            <div className="chip chip-brand" style={{ marginTop: 9 }}>
              <Icon name="route" size={12} /> {t('onTheWay', { n: ackCount })}
            </div>
          )}
        </div>

        {/* what was captured */}
        <StatusRow
          icon="pin"
          ok={!!last}
          label={
            last
              ? `${t('locationLocked')} · ${last.lat.toFixed(5)}, ${last.lng.toFixed(5)}${
                  last.accuracy ? ` · ${t('accuracyM', { n: Math.round(last.accuracy) })}` : ''
                }`
              : t('locationUnavailable')
          }
        />
        <StatusRow
          icon="broadcast"
          ok={active.live}
          label={active.live ? t('liveTracking') : t('liveStopped')}
          right={
            active.live ? (
              <span className="tiny">{active.track.length} ✓</span>
            ) : undefined
          }
        />
        <StatusRow
          icon="user"
          ok
          label={`${t('yourProfile')} · ${active.snapshot?.name ?? me.name}${
            active.snapshot?.bloodType ? ` · ${active.snapshot.bloodType}` : ''
          }`}
        />
        <StatusRow icon="clock" ok label={fmtDateTime(active.createdAt, lang)} />

        <div className="list-link" style={{ marginTop: 12 }}>
          <Icon
            name={CATEGORY_META[active.category].icon}
            size={19}
            color={CATEGORY_META[active.category].color}
          />
          <span className="grow">
            <span className="strong" style={{ display: 'block' }}>
              {t(CATEGORY_META[active.category].key)}
            </span>
            <span className="tiny">Jenis darurat tercatat saat alarm dikirim.</span>
          </span>
        </div>

        {/* media */}
        <div className="btn-row" style={{ marginTop: 10 }}>
          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              void attach(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <button className="btn btn-ghost btn-sm grow" onClick={() => photoRef.current?.click()}>
            <Icon name="camera" size={14} /> {t('attachPhoto')}
          </button>
        </div>

        {active.attachments.length > 0 && (
          <div className="thumb-grid" style={{ marginTop: 10 }}>
            {active.attachments.map((a) => (
              <img key={a.id} src={a.dataUrl} alt="Bukti insiden" className="thumb" />
            ))}
          </div>
        )}

        {/* live map */}
        {last && (
          <div style={{ marginTop: 12 }}>
            <MapView
              className="map-box short"
              center={{ lat: last.lat, lng: last.lng }}
              zoom={17}
              area={community.area}
              track={active.track.map((p) => ({ lat: p.lat, lng: p.lng }))}
              markers={[
                {
                  id: 'me',
                  pos: { lat: last.lat, lng: last.lng },
                  emoji: '🆘',
                  color: 'var(--danger)',
                },
              ]}
            />
          </div>
        )}

        {/* recipients */}
        <div className="section-title">
          {t('recipients')}
          <span className="chip">{active.recipients.length}</span>
        </div>
        {active.recipients.length === 0 ? (
          <div className="empty">
            <span className="em">👥</span>
            {t('noContacts')}
          </div>
        ) : (
          active.recipients.map((r) => {
            const km = KIND_META[r.kind]
            return (
              <div key={r.id} className="recip">
                <span className="who" style={{ background: km.bg }}>
                  {km.emoji}
                </span>
                <div className="grow">
                  <div className="strong truncate" style={{ fontSize: 13.5 }}>
                    {r.name}
                  </div>
                  <div className="tiny">{t(km.key)}</div>
                </div>
                {r.acknowledgedAt ? (
                  <span className="chip chip-brand">{t('acknowledged')}</span>
                ) : (
                  <span className="chip">{t('delivered')}</span>
                )}
              </div>
            )
          })
        )}

        <div className="btn-row" style={{ marginTop: 16 }}>
          <button
            className="btn btn-primary"
            onClick={async () => {
              const ok = await mutate(() => alertApi.close(active.id, false))
              if (!ok) {
                toast('Status belum diperbarui. Periksa koneksi lalu coba lagi.', 'err')
                return
              }
              setActiveId(null)
              toast(t('alertResolved'))
            }}
          >
            <Icon name="check" size={15} /> {t('imSafeNow')}
          </button>
        </div>
        <button
          className="btn btn-ghost"
          style={{ marginTop: 8 }}
          onClick={async () => {
            const ok = await mutate(() => alertApi.close(active.id, true))
            if (!ok) {
              toast('Alarm belum dibatalkan. Periksa koneksi lalu coba lagi.', 'err')
              return
            }
            setActiveId(null)
            toast(t('alertCancelled'))
          }}
        >
          <Icon name="x" size={15} /> {t('falseAlarm')}
        </button>
      </div>
    )
  }

  /* ------------------------- IDLE: resident emergency home ------------------------- */
  return (
    <div className="page">
      {incoming.map((r) => {
        const who = db.members.find((m) => m.id === r.authorId)
        const mine = r.recipients.find((x) => x.memberId === me.id)
        return (
          <div key={r.id} className="live-bar" style={{ display: 'block' }}>
            <div className="row" style={{ gap: 10 }}>
              <span className="live-dot" />
              <div className="grow">
                <div className="strong" style={{ fontSize: 13.5 }}>
                  🔴 DARURAT AKTIF · {t(CATEGORY_META[r.category].key)}
                </div>
                <div className="tiny">
                  {who?.name} {r.address ? `· ${r.address} ` : ''}· {timeAgo(r.createdAt, lang)}
                </div>
              </div>
            </div>
            <div className="btn-row" style={{ marginTop: 9 }}>
              <button
                className="btn btn-sm btn-ghost grow"
                onClick={() => nav(`/app/reports?id=${r.id}`)}
              >
                Lihat detail
              </button>
              {!mine?.acknowledgedAt && (
                <button
                  className="btn btn-sm btn-danger grow"
                  onClick={async () => {
                    const ok = await mutate(() => alertApi.respond(r.id))
                    if (!ok) {
                      toast('Respons belum terkirim. Periksa koneksi lalu coba lagi.', 'err')
                      return
                    }
                    toast(t('acknowledged'))
                  }}
                >
                  <Icon name="route" size={13} /> {t('ackAlert')}
                </button>
              )}
            </div>
          </div>
        )
      })}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row-between">
          <div>
            <div className="tiny strong">WARGA JAGA WARGA</div>
            <h2 style={{ marginTop: 3, fontSize: 21, fontWeight: 900 }}>Butuh bantuan sekarang?</h2>
          </div>
          <span className="chip chip-danger">SOS</span>
        </div>
        <p className="muted" style={{ marginTop: 7 }}>
          Pilih jenis darurat, lalu tekan dan tahan selama 1,5 detik.
        </p>
      </div>

      <PanicGrid
        disabled={locating || !!armed}
        onTrigger={(type) => setArmed({ type, key: emergencyRequestKey() })}
        onCancel={() => toast(t('alertCancelled'))}
      />

      <p className="sos-ready-note" style={{ marginTop: 14 }}>
        {locating
          ? t('gettingLocation')
          : 'Alarm hanya terkirim setelah hitung mundur selesai dan server mengonfirmasi penerimaan.'}
      </p>
      <button className="chip" onClick={() => nav('/app/network')}>
        <Icon name="users" size={13} /> {t('willReceive')}:{' '}
        <b style={{ color: 'var(--text)' }}>{audienceCount}</b>
      </button>

      {audienceCount === 0 && (
        <div className="banner banner-warn" style={{ marginTop: 14 }}>
          <Icon name="info" size={17} />
          <span>
            {t('emptyNetworkWarn')}{' '}
            <a onClick={() => nav('/app/network')}>{t('addContact')}</a>
          </span>
        </div>
      )}

      <div className="disclaimer" style={{ marginTop: 14 }}>
        <Icon name="info" size={15} />
        <span>{t('noPolice')}</span>
      </div>

      {armed && (
        <Countdown
          label={t(CATEGORY_META[armed.type].key)}
          sending={locating}
          onDone={() => void fire(armed.type, armed.key)}
          onCancel={() => {
            if (locating) return
            setArmed(null)
            toast(t('alertCancelled'))
          }}
        />
      )}
    </div>
  )
}

function StatusRow({
  icon,
  label,
  ok,
  pending,
  right,
}: {
  icon: IconName
  label: string
  ok?: boolean
  pending?: boolean
  right?: React.ReactNode
}) {
  return (
    <div className={`status-row ${pending ? 'pending' : ok ? 'ok' : ''}`}>
      <span
        className="ic"
        style={{
          background: pending ? 'var(--warn-soft)' : ok ? 'var(--brand-soft)' : 'var(--surface-2)',
          color: pending ? 'var(--warn)' : ok ? 'var(--brand)' : 'var(--text-3)',
        }}
      >
        <Icon name={icon} size={15} />
      </span>
      <span className="grow">{label}</span>
      {right}
      {!right && ok && <Icon name="check" size={15} color="var(--brand)" />}
    </div>
  )
}
