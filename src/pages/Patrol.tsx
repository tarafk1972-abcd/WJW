import { useMemo, useState } from 'react'
import { addPatrolPoint, endPatrol, startPatrol } from '../lib/db'
import { fmtDateTime, fmtDuration, fmtTime } from '../lib/format'
import { useApp } from '../lib/store'
import { Icon } from '../ui/Icon'
import { MapView } from '../ui/MapView'
import { Sheet } from '../ui/Sheet'
import { useToast } from '../ui/Toast'

export default function Patrol() {
  const { db, me, community, t, lang, isAdmin, isSatpam } = useApp()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')

  const patrols = useMemo(
    () => (community ? db.patrols.filter((p) => p.communityId === community.id) : []),
    [db.patrols, community],
  )

  const active = patrols.find((p) => !p.endedAt && p.satpamId === me?.id)

  if (!me || !community) return null

  if (!isAdmin && !isSatpam) {
    return (
      <div className="page">
        <div className="empty">
          <span className="em">🛡️</span>
          {t('patrolOnlySatpam')}
        </div>
      </div>
    )
  }

  const begin = () => {
    startPatrol(community.id, me.id)
    toast(t('startPatrol'))
  }

  const addPoint = async () => {
    if (!active) return
    let lat = community.center.lat
    let lng = community.center.lng
    try {
      const p = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 6000 }),
      )
      lat = p.coords.latitude
      lng = p.coords.longitude
    } catch {
      // fall back to community centre with a small jitter so the track is visible
      lat += (Math.random() - 0.5) * 0.002
      lng += (Math.random() - 0.5) * 0.002
    }
    addPatrolPoint(active.id, { lat, lng, note: note.trim() })
    setNote('')
    setOpen(false)
    toast(t('addCheckpoint'))
  }

  return (
    <div className="page">
      <div className="row-between" style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800 }}>{t('patrol')}</h2>
        {active ? (
          <span className="chip chip-info">
            <Icon name="route" size={12} /> {t('patrolRunning')}
          </span>
        ) : null}
      </div>

      {active ? (
        <div className="card">
          <div className="row-between" style={{ marginBottom: 12 }}>
            <div>
              <div className="strong">{t('patrolRunning')}</div>
              <div className="tiny">
                {t('patrolDuration')}: {fmtDuration(Date.now() - active.startedAt, lang)} ·{' '}
                {active.points.length} {t('checkpoints')}
              </div>
            </div>
          </div>
          <MapView
            className="map-box short"
            center={
              active.points.length
                ? {
                    lat: active.points[active.points.length - 1].lat,
                    lng: active.points[active.points.length - 1].lng,
                  }
                : community.center
            }
            area={community.area}
            track={active.points.map((p) => ({ lat: p.lat, lng: p.lng }))}
            markers={active.points.map((p, i) => ({
              id: String(i),
              pos: { lat: p.lat, lng: p.lng },
              emoji: '📍',
              color: 'var(--info)',
              popup: (
                <div>
                  <b>#{i + 1}</b> {fmtTime(p.at, lang)}
                  {p.note && (
                    <>
                      <br />
                      {p.note}
                    </>
                  )}
                </div>
              ),
            }))}
          />
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn btn-ghost" onClick={() => setOpen(true)}>
              <Icon name="pin" size={15} /> {t('addCheckpoint')}
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                endPatrol(active.id)
                toast(t('endPatrol'))
              }}
            >
              <Icon name="stop" size={15} /> {t('endPatrol')}
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn-primary" onClick={begin}>
          <Icon name="play" size={16} /> {t('startPatrol')}
        </button>
      )}

      <div className="section-title">{t('patrol')}</div>
      {patrols.filter((p) => p.endedAt).length === 0 ? (
        <div className="empty">
          <span className="em">🚶</span>
          {t('noPatrol')}
        </div>
      ) : (
        patrols
          .filter((p) => p.endedAt)
          .map((p) => {
            const guard = db.members.find((m) => m.id === p.satpamId)
            return (
              <div key={p.id} className="item">
                <div
                  className="item-icon"
                  style={{ background: 'rgba(163,113,247,.16)', color: 'var(--purple)' }}
                >
                  <Icon name="route" size={19} />
                </div>
                <div className="grow">
                  <div className="strong truncate">{guard?.name ?? '-'}</div>
                  <div className="tiny">
                    {fmtDateTime(p.startedAt, lang)} ·{' '}
                    {fmtDuration((p.endedAt ?? 0) - p.startedAt, lang)}
                  </div>
                </div>
                <span className="chip">
                  {p.points.length} <Icon name="pin" size={11} />
                </span>
              </div>
            )
          })
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title={t('addCheckpoint')}>
        <label className="field">
          <span>{t('checkpointNote')}</span>
          <input
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Pos 1 aman"
          />
        </label>
        <button className="btn btn-primary" onClick={addPoint}>
          <Icon name="pin" size={16} /> {t('addCheckpoint')}
        </button>
      </Sheet>
    </div>
  )
}
