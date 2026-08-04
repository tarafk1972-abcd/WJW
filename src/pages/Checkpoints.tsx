import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  addCheckpoint,
  addSchedule,
  checkpointsOf,
  logsForDay,
  removeCheckpoint,
  removeSchedule,
} from '../lib/db'
import { fmtTime } from '../lib/format'
import { useApp } from '../lib/store'
import { Icon } from '../ui/Icon'
import { MapView } from '../ui/MapView'
import { Sheet } from '../ui/Sheet'
import { useToast } from '../ui/Toast'
import type { LatLng } from '../lib/types'

const DAY_LABELS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function fromMinutes(min: number): string {
  return `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Admin: menentukan titik ronda di peta dan mengatur jadwal ronda. */
export default function Checkpoints() {
  const { db, me, community, t, lang, isAdmin } = useApp()
  const nav = useNavigate()
  const toast = useToast()

  const [tab, setTab] = useState<'points' | 'schedule' | 'report'>('points')
  const [draft, setDraft] = useState<LatLng | null>(null)
  const [name, setName] = useState('')
  const [radius, setRadius] = useState(50)

  const [schOpen, setSchOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [start, setStart] = useState('22:00')
  const [end, setEnd] = useState('23:00')
  const [grace, setGrace] = useState(15)
  const [days, setDays] = useState<number[]>([])

  const checkpoints = useMemo(
    () => (community ? checkpointsOf(db, community.id) : []),
    [db, community],
  )
  const schedules = useMemo(
    () => (community ? db.schedules.filter((s) => s.communityId === community.id) : []),
    [db.schedules, community],
  )
  const todayLogs = useMemo(
    () => (community ? logsForDay(db, community.id, startOfToday()) : []),
    [db, community],
  )

  if (!me || !community) return null
  if (!isAdmin) {
    return (
      <div className="page">
        <div className="empty">
          <span className="em">🔒</span>
          {t('adminOnly')}
        </div>
      </div>
    )
  }

  const saveCheckpoint = () => {
    if (!draft || !name.trim()) return toast(t('errRequired'), 'err')
    addCheckpoint(me.id, {
      communityId: community.id,
      name: name.trim(),
      lat: draft.lat,
      lng: draft.lng,
      radiusM: radius,
    })
    setDraft(null)
    setName('')
    toast(t('checkpointSaved'))
  }

  const saveSchedule = () => {
    if (!label.trim()) return toast(t('errRequired'), 'err')
    addSchedule(me.id, {
      communityId: community.id,
      label: label.trim(),
      startMinute: toMinutes(start),
      endMinute: toMinutes(end),
      days,
      graceMin: grace,
    })
    setLabel('')
    setDays([])
    setSchOpen(false)
    toast(t('scheduleSaved'))
  }

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="icon-btn" onClick={() => nav(-1)}>
          <Icon name="chevronLeft" size={18} />
        </button>
        <div className="grow">
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>{t('patrol')}</h2>
          <div className="tiny">{community.name}</div>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: 14 }}>
        <button className={tab === 'points' ? 'on' : ''} onClick={() => setTab('points')}>
          {t('checkpointsAdmin')}
        </button>
        <button className={tab === 'schedule' ? 'on' : ''} onClick={() => setTab('schedule')}>
          {t('scheduleAdmin')}
        </button>
        <button className={tab === 'report' ? 'on' : ''} onClick={() => setTab('report')}>
          {t('patrolReport')}
        </button>
      </div>

      {/* ---------------- titik ronda ---------------- */}
      {tab === 'points' && (
        <>
          <div className="banner banner-info">
            <Icon name="info" size={17} />
            <span>{t('tapMapToPlace')}</span>
          </div>

          <MapView
            className="map-box"
            center={
              draft ??
              (checkpoints[0]
                ? { lat: checkpoints[0].lat, lng: checkpoints[0].lng }
                : community.center)
            }
            zoom={17}
            area={community.area}
            onMapClick={(p) => setDraft(p)}
            markers={[
              ...checkpoints.map((c, i) => ({
                id: c.id,
                pos: { lat: c.lat, lng: c.lng },
                emoji: String(i + 1),
                color: 'var(--brand)',
                popup: (
                  <div>
                    <b>{c.name}</b>
                    <br />
                    {c.radiusM} m
                  </div>
                ),
              })),
              ...(draft
                ? [{ id: 'draft', pos: draft, emoji: '➕', color: 'var(--warn)' }]
                : []),
            ]}
          />

          {draft && (
            <div className="card" style={{ marginTop: 12 }}>
              <label className="field">
                <span>{t('checkpointName')} *</span>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Pos 1 — Gerbang Depan"
                />
              </label>
              <label className="field">
                <span>
                  {t('checkpointRadius')}: <b>{radius} m</b>
                </span>
                <input
                  type="range"
                  min={15}
                  max={150}
                  step={5}
                  value={radius}
                  onChange={(e) => setRadius(Number(e.target.value))}
                  style={{ width: '100%' }}
                />
              </label>
              <div className="btn-row">
                <button className="btn btn-ghost" onClick={() => setDraft(null)}>
                  {t('cancel')}
                </button>
                <button className="btn btn-primary" onClick={saveCheckpoint}>
                  <Icon name="check" size={16} /> {t('save')}
                </button>
              </div>
            </div>
          )}

          <div className="section-title">
            {t('checkpointsAdmin')}
            <span className="chip">{checkpoints.length}</span>
          </div>
          {checkpoints.length === 0 ? (
            <div className="empty">
              <span className="em">📍</span>
              {t('noCheckpoints')}
            </div>
          ) : (
            checkpoints.map((c, i) => (
              <div key={c.id} className="item">
                <div
                  className="item-icon"
                  style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
                >
                  <b>{i + 1}</b>
                </div>
                <div className="grow">
                  <div className="strong truncate">{c.name}</div>
                  <div className="tiny">
                    {c.radiusM} m · {c.lat.toFixed(5)}, {c.lng.toFixed(5)}
                  </div>
                </div>
                <button
                  className="icon-btn"
                  style={{ width: 32, height: 32 }}
                  onClick={() => {
                    removeCheckpoint(me.id, c.id)
                    toast(t('checkpointRemoved'))
                  }}
                >
                  <Icon name="trash" size={15} />
                </button>
              </div>
            ))
          )}
        </>
      )}

      {/* ---------------- jadwal ---------------- */}
      {tab === 'schedule' && (
        <>
          <button className="btn btn-primary" onClick={() => setSchOpen(true)}>
            <Icon name="plus" size={16} /> {t('addSchedule')}
          </button>

          <div className="section-title">{t('scheduleAdmin')}</div>
          {schedules.length === 0 ? (
            <div className="empty">
              <span className="em">🕙</span>
              {t('noSchedules')}
            </div>
          ) : (
            schedules.map((s) => (
              <div key={s.id} className="item">
                <div
                  className="item-icon"
                  style={{ background: 'var(--info-soft)', color: 'var(--info)' }}
                >
                  <Icon name="clock" size={18} />
                </div>
                <div className="grow">
                  <div className="strong truncate">{s.label}</div>
                  <div className="tiny">
                    {fromMinutes(s.startMinute)}–{fromMinutes(s.endMinute)} ·{' '}
                    {s.days.length
                      ? s.days.map((d) => DAY_LABELS[d]).join(', ')
                      : t('everyDay')}
                  </div>
                  <div className="tiny">
                    {t('graceMinutes')}: {s.graceMin}
                  </div>
                </div>
                <button
                  className="icon-btn"
                  style={{ width: 32, height: 32 }}
                  onClick={() => removeSchedule(me.id, s.id)}
                >
                  <Icon name="trash" size={15} />
                </button>
              </div>
            ))
          )}
        </>
      )}

      {/* ---------------- rekap ---------------- */}
      {tab === 'report' && (
        <>
          <div className="stat-grid" style={{ marginBottom: 12 }}>
            <div className="stat">
              <div className="n">{todayLogs.length}</div>
              <div className="l">{t('today')}</div>
            </div>
            <div className="stat">
              <div className="n" style={{ color: 'var(--brand)' }}>
                {todayLogs.filter((l) => l.status === 'ontime').length}
              </div>
              <div className="l">{t('patrolOntime')}</div>
            </div>
          </div>

          <div className="section-title">{t('patrolHistory')}</div>
          {db.patrolLogs.filter((l) => l.communityId === community.id).length === 0 ? (
            <div className="empty">
              <span className="em">🚶</span>
              {t('noPatrolLogs')}
            </div>
          ) : (
            db.patrolLogs
              .filter((l) => l.communityId === community.id)
              .slice(0, 40)
              .map((l) => {
                const guard = db.members.find((m) => m.id === l.satpamId)
                return (
                  <div key={l.id} className="item">
                    <div
                      className="item-icon"
                      style={{
                        background:
                          l.status === 'ontime'
                            ? 'var(--brand-soft)'
                            : l.status === 'late'
                              ? 'var(--warn-soft)'
                              : 'var(--surface-2)',
                        color:
                          l.status === 'ontime'
                            ? 'var(--brand)'
                            : l.status === 'late'
                              ? 'var(--warn)'
                              : 'var(--text-3)',
                      }}
                    >
                      <Icon name="shield" size={18} />
                    </div>
                    <div className="grow">
                      <div className="strong truncate">{l.checkpointName}</div>
                      <div className="tiny truncate">
                        {guard?.name} · {l.scheduleLabel || t('noSchedule')}
                      </div>
                      <div className="tiny">
                        {fmtTime(l.at, lang)} · {l.distanceM} m
                        {!l.insideRadius && ` · ${t('outsideRadius')}`}
                      </div>
                    </div>
                    <span
                      className={`chip ${
                        l.status === 'ontime'
                          ? 'chip-brand'
                          : l.status === 'late'
                            ? 'chip-warn'
                            : ''
                      }`}
                    >
                      {t(
                        l.status === 'ontime'
                          ? 'patrolOntime'
                          : l.status === 'late'
                            ? 'patrolLate'
                            : 'patrolOffschedule',
                      )}
                    </span>
                  </div>
                )
              })
          )}
        </>
      )}

      {/* sheet jadwal */}
      <Sheet open={schOpen} onClose={() => setSchOpen(false)} title={t('addSchedule')}>
        <label className="field">
          <span>{t('scheduleLabel')} *</span>
          <input
            className="input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ronda Malam"
          />
        </label>
        <div className="btn-row" style={{ marginBottom: 13 }}>
          <label className="field grow" style={{ marginBottom: 0 }}>
            <span>{t('startTime')}</span>
            <input
              className="input"
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label className="field grow" style={{ marginBottom: 0 }}>
            <span>{t('endTime')}</span>
            <input
              className="input"
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
        <label className="field">
          <span>
            {t('graceMinutes')}: <b>{grace}</b>
          </span>
          <input
            type="range"
            min={0}
            max={60}
            step={5}
            value={grace}
            onChange={(e) => setGrace(Number(e.target.value))}
            style={{ width: '100%' }}
          />
        </label>
        <div className="field">
          <span
            style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--text-2)',
              marginBottom: 6,
            }}
          >
            {days.length ? days.map((d) => DAY_LABELS[d]).join(', ') : t('everyDay')}
          </span>
          <div className="btn-row">
            {DAY_LABELS.map((d, i) => (
              <button
                key={d}
                className={`btn btn-sm grow ${days.includes(i) ? 'btn-primary' : 'btn-ghost'}`}
                style={{ padding: '8px 2px' }}
                onClick={() =>
                  setDays((v) => (v.includes(i) ? v.filter((x) => x !== i) : [...v, i].sort()))
                }
              >
                {d}
              </button>
            ))}
          </div>
        </div>
        <button className="btn btn-primary" onClick={saveSchedule}>
          <Icon name="check" size={16} /> {t('save')}
        </button>
      </Sheet>
    </div>
  )
}
