import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { ApiError, patrolApi } from '../lib/api'
import { getFix } from '../lib/capture'
import { apiMode, syncState } from '../lib/sync'
import {
  activeSchedule,
  checkpointsOf,
  distanceMeters,
  logsForDay,
  patrolAllowedRadius,
  recordPatrol,
} from '../lib/db'
import { fmtTime } from '../lib/format'
import { useApp } from '../lib/store'
import { Icon } from '../ui/Icon'
import { MapView } from '../ui/MapView'
import { useToast } from '../ui/Toast'
import type { Checkpoint, LatLng } from '../lib/types'

function hhmm(min: number) {
  return `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Layar ronda satpam: satu tombol besar untuk merekam kehadiran di titik
 * ronda. Aplikasi memeriksa GPS (harus di dalam radius titik) dan mencocokkan
 * dengan jadwal yang sedang berlaku.
 */
export default function PatrolCheck() {
  const { db, me, community, t, lang, isAdmin, isSatpam } = useApp()
  const nav = useNavigate()
  const toast = useToast()

  const [pos, setPos] = useState<LatLng | null>(null)
  /** Ketidakpastian GPS terakhir, meter. Dikirim agar radius diberi kelonggaran. */
  const [acc, setAcc] = useState<number | null>(null)
  const [locating, setLocating] = useState(true)
  const [saving, setSaving] = useState(false)
  const [tooFar, setTooFar] = useState<{ dist: number; cp: Checkpoint } | null>(null)

  const checkpoints = useMemo(
    () => (community ? checkpointsOf(db, community.id) : []),
    [db, community],
  )

  const todayLogs = useMemo(
    () => (community ? logsForDay(db, community.id, startOfToday()) : []),
    [db, community],
  )

  const sched = useMemo(
    () => (community ? activeSchedule(db, community.id) : null),
    [db, community],
  )

  /** Titik terdekat dari posisi satpam sekarang. */
  const nearest = useMemo(() => {
    if (!pos || !checkpoints.length) return null
    let best: { cp: Checkpoint; dist: number } | null = null
    for (const cp of checkpoints) {
      const d = distanceMeters(pos, { lat: cp.lat, lng: cp.lng })
      if (!best || d < best.dist) best = { cp, dist: d }
    }
    return best
  }, [pos, checkpoints])

  const locate = useCallback(async () => {
    setLocating(true)
    const fix = await getFix()
    if (fix) {
      setPos({ lat: fix.lat, lng: fix.lng })
      setAcc(fix.accuracy)
    }
    setLocating(false)
  }, [])

  useEffect(() => {
    void locate()
  }, [locate])

  if (!me || !community) return null

  if (!isSatpam && !isAdmin) {
    return (
      <div className="page">
        <div className="empty">
          <span className="em">🛡️</span>
          {t('patrolOnlySatpam')}
        </div>
      </div>
    )
  }

  const doneIds = new Set(todayLogs.map((l) => l.checkpointId))
  const done = checkpoints.filter((c) => doneIds.has(c.id)).length

  const submit = async (force = false) => {
    if (!pos) {
      toast(t('gpsNeeded'), 'err')
      void locate()
      return
    }
    setSaving(true)

    if (apiMode()) {
      try {
        const r = await patrolApi.log(pos.lat, pos.lng, { force, accuracy: acc })
        await syncState()
        setSaving(false)
        setTooFar(null)
        const name = (r.log as { checkpointName: string }).checkpointName
        toast(t('patrolRecorded', { name }))
        if (navigator.vibrate) navigator.vibrate([90, 50, 90])
        return
      } catch (e) {
        setSaving(false)
        if (e instanceof ApiError) {
          if (e.code === 'errTooFar') {
            const d = Math.round(
              ((e.data as { distanceM?: number })?.distanceM ?? 0) as number,
            )
            const near = nearest?.cp
            if (near) setTooFar({ dist: d, cp: near })
            toast(t('errTooFar', { n: d }), 'err')
            return
          }
          if (e.status !== 0) {
            toast(t(e.code as Parameters<typeof t>[0]), 'err')
            return
          }
        }
        // luring: lanjut ke pencatatan lokal di bawah
        setSaving(true)
      }
    }

    const res = recordPatrol({
      communityId: community.id,
      satpamId: me.id,
      at: pos,
      force,
      accuracy: acc,
    })
    setSaving(false)

    if (res.ok && res.log) {
      setTooFar(null)
      toast(t('patrolRecorded', { name: res.log.checkpointName }))
      if (navigator.vibrate) navigator.vibrate([90, 50, 90])
      return
    }
    if (res.error === 'errTooFar' && res.checkpoint) {
      setTooFar({ dist: Math.round(res.distanceM ?? 0), cp: res.checkpoint })
      toast(t('errTooFar', { n: Math.round(res.distanceM ?? 0) }), 'err')
      return
    }
    toast(t(res.error ?? 'errNoCheckpoint'), 'err')
  }

  /*
   * Pakai radius yang sudah dilonggarkan, sama seperti yang dipakai
   * server saat menyimpan. Sebelumnya layar membandingkan jarak mentah,
   * sehingga satpam yang berdiri di titik ronda melihat "di luar
   * jangkauan" padahal servernya akan menerima catatannya.
   */
  const inRange =
    !!nearest && nearest.dist <= patrolAllowedRadius(nearest.cp.radiusM, acc)

  return (
    <div className="page">
      <div className="row-between" style={{ marginBottom: 12 }}>
        <div className="grow">
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>{t('patrolCheck')}</h2>
          <div className="tiny">{t('patrolCheckSub')}</div>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={() => nav('/app/patrol')}>
          <Icon name="clock" size={13} /> {t('patrolHistory')}
        </button>
      </div>

      {/* jadwal berjalan */}
      <div
        className={`banner ${sched ? (sched.late ? 'banner-warn' : 'banner-brand') : 'banner-info'}`}
      >
        <Icon name={sched ? 'clock' : 'info'} size={17} />
        <span>
          {sched ? (
            <>
              <b>{sched.schedule.label}</b> ·{' '}
              {hhmm(sched.schedule.startMinute)}–{hhmm(sched.schedule.endMinute)}
              {sched.late && ` · ${t('patrolLate')}`}
            </>
          ) : (
            t('noSchedule')
          )}
        </span>
      </div>

      {checkpoints.length === 0 ? (
        <>
          <div className="empty">
            <span className="em">📍</span>
            {t('noCheckpoints')}
          </div>
          {isAdmin && (
            <button className="btn btn-primary" onClick={() => nav('/app/checkpoints')}>
              <Icon name="pin" size={16} /> {t('addCheckpointAdmin')}
            </button>
          )}
        </>
      ) : (
        <>
          {/* progres hari ini */}
          <div className="card card-tight" style={{ marginBottom: 12 }}>
            <div className="row-between" style={{ marginBottom: 8 }}>
              <span className="strong" style={{ fontSize: 13.5 }}>
                {t('todayProgress')}
              </span>
              <span className={`chip ${done === checkpoints.length ? 'chip-brand' : ''}`}>
                {t('doneOf', { done, total: checkpoints.length })}
              </span>
            </div>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${(done / checkpoints.length) * 100}%` }}
              />
            </div>
          </div>

          {/* tombol utama */}
          <div className="patrol-stage">
            <button
              className={`patrol-btn ${inRange ? 'ready' : ''}`}
              disabled={saving || locating}
              onClick={() => void submit(false)}
            >
              <span>
                <Icon name="shield" size={30} />
                <span className="cap">
                  {saving ? t('recording') : locating ? t('gettingLocation') : t('recordPatrol')}
                </span>
              </span>
            </button>

            <div className="tiny center" style={{ marginTop: 12 }}>
              {locating ? (
                t('gettingLocation')
              ) : nearest ? (
                <>
                  <b style={{ color: inRange ? 'var(--brand)' : 'var(--warn)' }}>
                    {nearest.cp.name}
                  </b>{' '}
                  · {t('distanceAway', { n: Math.round(nearest.dist) })}
                </>
              ) : (
                t('locationUnavailable')
              )}
            </div>
          </div>

          {tooFar && (
            <div className="banner banner-warn" style={{ marginTop: 12 }}>
              <Icon name="pin" size={17} />
              <span>
                {t('errTooFar', { n: tooFar.dist })}
                <br />
                <a onClick={() => void submit(true)}>{t('recordAnyway')}</a>
              </span>
            </div>
          )}

          <button
            className="btn btn-ghost btn-sm"
            style={{ marginTop: 10 }}
            onClick={() => void locate()}
          >
            <Icon name="crosshair" size={14} /> {t('useMyLocation')}
          </button>

          {/* peta titik ronda */}
          {(pos || checkpoints.length > 0) && (
            <div style={{ marginTop: 12 }}>
              <MapView
                className="map-box short"
                center={pos ?? { lat: checkpoints[0].lat, lng: checkpoints[0].lng }}
                zoom={17}
                area={community.area}
                markers={[
                  ...checkpoints.map((c) => ({
                    id: c.id,
                    pos: { lat: c.lat, lng: c.lng },
                    emoji: doneIds.has(c.id) ? '✅' : '📍',
                    color: doneIds.has(c.id) ? 'var(--brand)' : 'var(--warn)',
                    popup: (
                      <div>
                        <b>{c.name}</b>
                        <br />
                        {doneIds.has(c.id) ? t('visitedAt', { time: '' }) : t('notYetVisited')}
                      </div>
                    ),
                  })),
                  ...(pos
                    ? [
                        {
                          id: 'me',
                          pos,
                          emoji: '🧍',
                          color: 'var(--info)',
                          popup: <div>{t('youAreHere')}</div>,
                        },
                      ]
                    : []),
                ]}
              />
            </div>
          )}

          {/* daftar titik */}
          <div className="section-title">{t('checkpointsAdmin')}</div>
          {checkpoints.map((c) => {
            const log = todayLogs.find((l) => l.checkpointId === c.id)
            const dist = pos ? distanceMeters(pos, { lat: c.lat, lng: c.lng }) : null
            return (
              <div key={c.id} className="item">
                <div
                  className="item-icon"
                  style={{
                    background: log ? 'var(--brand-soft)' : 'var(--surface-2)',
                    color: log ? 'var(--brand)' : 'var(--text-3)',
                  }}
                >
                  <Icon name={log ? 'check' : 'pin'} size={18} />
                </div>
                <div className="grow">
                  <div className="strong truncate">{c.name}</div>
                  <div className="tiny">
                    {log
                      ? `${t('visitedAt', { time: fmtTime(log.at, lang) })} · ${t(
                          log.status === 'ontime'
                            ? 'patrolOntime'
                            : log.status === 'late'
                              ? 'patrolLate'
                              : 'patrolOffschedule',
                        )}`
                      : dist !== null
                        ? t('distanceAway', { n: Math.round(dist) })
                        : t('notYetVisited')}
                  </div>
                </div>
                {log && (
                  <span
                    className={`chip ${
                      log.status === 'ontime'
                        ? 'chip-brand'
                        : log.status === 'late'
                          ? 'chip-warn'
                          : ''
                    }`}
                  >
                    {fmtTime(log.at, lang)}
                  </span>
                )}
              </div>
            )
          })}

          {done === checkpoints.length && checkpoints.length > 0 && (
            <div className="banner banner-brand" style={{ marginTop: 12 }}>
              <Icon name="check" size={17} />
              <span>{t('allDone')}</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
