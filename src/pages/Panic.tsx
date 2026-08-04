import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { getFix, recordVoice, VOICE_SECONDS, watchLocation } from '../lib/capture'
import {
  acknowledgeAlert,
  addAttachment,
  alertAudience,
  attachAudio,
  cancelAlert,
  pushLocation,
  raiseAlert,
  stopLive,
  updateReport,
} from '../lib/db'
import { fmtDateTime, timeAgo } from '../lib/format'
import { CATEGORY_META, PANIC_TYPES } from '../lib/meta'
import { useApp } from '../lib/store'
import { BigSOS } from '../ui/BigSOS'
import { Icon, type IconName } from '../ui/Icon'
import { MapView } from '../ui/MapView'
import { Sheet } from '../ui/Sheet'
import { useToast } from '../ui/Toast'
import type { ContactKind, PanicType, Report } from '../lib/types'

/** Batas lampiran: penyimpanan browser hanya ~5 MB total. */
const MAX_MB = 2

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
  const [recording, setRecording] = useState(false)
  const [micFailed, setMicFailed] = useState(false)
  const [typeOpen, setTypeOpen] = useState(false)
  const photoRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLInputElement>(null)
  const unwatch = useRef<(() => void) | null>(null)

  /** My own alert that is still live. */
  const active: Report | null = useMemo(() => {
    if (!me) return null
    const byId = activeId ? db.reports.find((r) => r.id === activeId) : null
    if (byId) return byId
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
    unwatch.current = watchLocation((p) =>
      pushLocation(id, { ...p, at: Date.now() }),
    )
    return () => {
      unwatch.current?.()
      unwatch.current = null
    }
  }, [active?.live, active?.id])

  const fire = useCallback(async () => {
    if (!me || !community) return
    setLocating(true)
    setMicFailed(false)

    const fix = await getFix()
    const report = raiseAlert({
      member: me,
      category: 'other',
      at: fix ? { lat: fix.lat, lng: fix.lng } : null,
      accuracy: fix?.accuracy ?? null,
    })
    setActiveId(report.id)
    setLocating(false)
    toast(t('sentTo', { n: report.recipients.length }), 'err')
    if (navigator.vibrate) navigator.vibrate([200, 80, 200])

    // 15s voice memo runs after the alert is already out
    setRecording(true)
    const cap = recordVoice(VOICE_SECONDS)
    const res = await cap.done
    setRecording(false)
    if (res) {
      try {
        attachAudio(report.id, res.dataUrl, res.seconds)
      } catch {
        setMicFailed(true)
      }
    } else setMicFailed(true)
  }, [me, community, t, toast])

  const attach = async (file: File | undefined, kind: 'photo' | 'video') => {
    if (!file || !active) return
    if (file.size > MAX_MB * 1024 * 1024) return toast(t('fileTooBig', { n: MAX_MB }), 'err')
    const dataUrl = await new Promise<string>((res, rej) => {
      const fr = new FileReader()
      fr.onload = () => res(String(fr.result))
      fr.onerror = rej
      fr.readAsDataURL(file)
    })
    try {
      addAttachment(active.id, dataUrl, kind)
      toast(t('mediaAdded'))
    } catch {
      // penyimpanan penuh — peringatan tetap aman, hanya lampiran yang gagal
      toast(t('storageFull'), 'err')
    }
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
          icon="phone"
          ok={!!active.audio}
          pending={recording}
          label={
            recording
              ? t('recordingVoice', { n: VOICE_SECONDS })
              : active.audio
                ? t('voiceRecorded', { n: active.audioSeconds })
                : micFailed
                  ? t('micDenied')
                  : t('voiceSkipped')
          }
          right={recording ? <Waves /> : undefined}
        />
        <StatusRow
          icon="user"
          ok
          label={`${t('yourProfile')} · ${active.snapshot?.name ?? me.name}${
            active.snapshot?.bloodType ? ` · ${active.snapshot.bloodType}` : ''
          }`}
        />
        <StatusRow icon="clock" ok label={fmtDateTime(active.createdAt, lang)} />

        {active.audio && (
          <audio
            controls
            src={active.audio}
            style={{ width: '100%', marginTop: 10 }}
          />
        )}

        {/* emergency type — optional, chosen after the alert is out */}
        <button
          className="list-link"
          style={{ marginTop: 12 }}
          onClick={() => setTypeOpen(true)}
        >
          <Icon
            name={CATEGORY_META[active.category].icon}
            size={19}
            color={CATEGORY_META[active.category].color}
          />
          <span className="grow">
            <span className="strong" style={{ display: 'block' }}>
              {t(CATEGORY_META[active.category].key)}
            </span>
            <span className="tiny">{t('chooseType')}</span>
          </span>
          <Icon name="chevronRight" size={16} color="var(--text-3)" />
        </button>

        {/* media */}
        <div className="btn-row" style={{ marginTop: 10 }}>
          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => void attach(e.target.files?.[0], 'photo')}
          />
          <input
            ref={videoRef}
            type="file"
            accept="video/*"
            capture="environment"
            hidden
            onChange={(e) => void attach(e.target.files?.[0], 'video')}
          />
          <button className="btn btn-ghost btn-sm grow" onClick={() => photoRef.current?.click()}>
            <Icon name="camera" size={14} /> {t('attachPhoto')}
          </button>
          <button className="btn btn-ghost btn-sm grow" onClick={() => videoRef.current?.click()}>
            <Icon name="play" size={14} /> {t('attachVideo')}
          </button>
        </div>

        {active.attachments.length > 0 && (
          <div className="thumb-grid" style={{ marginTop: 10 }}>
            {active.attachments.map((a) =>
              a.kind === 'video' ? (
                <video key={a.id} src={a.dataUrl} className="thumb" controls />
              ) : (
                <img key={a.id} src={a.dataUrl} alt="" className="thumb" />
              ),
            )}
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
          {active.live && (
            <button
              className="btn btn-ghost"
              onClick={() => {
                stopLive(active.id)
                toast(t('liveStopped'))
              }}
            >
              <Icon name="stop" size={15} /> {t('stopSharing')}
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={() => {
              updateReport(me.id, active.id, { status: 'resolved' })
              stopLive(active.id)
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
          onClick={() => {
            cancelAlert(active.id, me.id)
            setActiveId(null)
            toast(t('alertCancelled'))
          }}
        >
          <Icon name="x" size={15} /> {t('falseAlarm')}
        </button>

        <Sheet open={typeOpen} onClose={() => setTypeOpen(false)} title={t('whatHappened')}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 9 }}>
            {PANIC_TYPES.map((p: PanicType) => {
              const m = CATEGORY_META[p]
              return (
                <button
                  key={p}
                  className="quick"
                  onClick={() => {
                    updateReport(me.id, active.id, { category: p, note: t(m.key) })
                    setTypeOpen(false)
                  }}
                  style={
                    active.category === p
                      ? { borderColor: m.color, background: m.bg, color: m.color }
                      : undefined
                  }
                >
                  <div className="ic" style={{ background: m.bg, color: m.color }}>
                    <Icon name={m.icon} size={18} />
                  </div>
                  {t(m.key)}
                </button>
              )
            })}
          </div>
        </Sheet>
      </div>
    )
  }

  /* ------------------------- IDLE (ONE SCREEN) ------------------------- */
  return (
    <div className="sos-screen">
      {incoming.map((r) => {
        const who = db.members.find((m) => m.id === r.authorId)
        const mine = r.recipients.find((x) => x.memberId === me.id)
        return (
          <div key={r.id} className="live-bar" style={{ display: 'block' }}>
            <div className="row" style={{ gap: 10 }}>
              <span className="live-dot" />
              <div className="grow">
                <div className="strong" style={{ fontSize: 13.5 }}>
                  🆘 {who?.name} · {t(CATEGORY_META[r.category].key)}
                </div>
                <div className="tiny">
                  {r.address} · {timeAgo(r.createdAt, lang)}
                </div>
              </div>
            </div>
            <div className="btn-row" style={{ marginTop: 9 }}>
              <button
                className="btn btn-sm btn-ghost grow"
                onClick={() => nav(`/app/reports?id=${r.id}`)}
              >
                {t('viewProfile')}
              </button>
              {!mine?.acknowledgedAt && (
                <button
                  className="btn btn-sm btn-danger grow"
                  onClick={() => {
                    acknowledgeAlert(r.id, me.id)
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

      <div className="sos-stage">
        <BigSOS onTrigger={() => void fire()} disabled={locating} />
        <p className="sos-ready-note">
          {locating ? t('gettingLocation') : t('networkHint')}
        </p>
        <button className="chip" onClick={() => nav('/app/network')}>
          <Icon name="users" size={13} /> {t('willReceive')}:{' '}
          <b style={{ color: 'var(--text)' }}>{audienceCount}</b>
        </button>
      </div>

      {audienceCount === 0 && (
        <div className="banner banner-warn">
          <Icon name="info" size={17} />
          <span>
            {t('emptyNetworkWarn')}{' '}
            <a onClick={() => nav('/app/network')}>{t('addContact')}</a>
          </span>
        </div>
      )}

      <div className="disclaimer">
        <Icon name="info" size={15} />
        <span>{t('noPolice')}</span>
      </div>
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

function Waves() {
  return (
    <span className="wave">
      {[0, 1, 2, 3].map((i) => (
        <i key={i} style={{ animationDelay: `${i * 0.12}s` }} />
      ))}
    </span>
  )
}
