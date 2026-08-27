import { useMemo, useState } from 'react'
import { adminApi } from '../lib/api'
import { polygonCenter, saveArea } from '../lib/db'
import { apiMode, mutate } from '../lib/sync'
import { timeAgo } from '../lib/format'
import { useApp } from '../lib/store'
import { Icon } from '../ui/Icon'
import { MapView, type MapMarker } from '../ui/MapView'
import { useToast } from '../ui/Toast'
import { CATEGORY_META } from '../lib/meta'
import type { LatLng } from '../lib/types'

export default function MapPage() {
  const { db, me, community, t, lang, isAdmin, canManageScope } = useApp()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<LatLng[]>([])
  const [showReports, setShowReports] = useState(true)
  const [showPatrol, setShowPatrol] = useState(false)
  const [recenter, setRecenter] = useState(0)
  const canManageMap = canManageScope('map_patrol')

  const reports = useMemo(
    () =>
      community
        ? db.reports.filter((r) => r.communityId === community.id && r.at)
        : [],
    [db.reports, community],
  )

  const patrols = useMemo(
    () =>
      community
        ? db.patrols.filter((p) => p.communityId === community.id).slice(0, 3)
        : [],
    [db.patrols, community],
  )
  const checkpoints = useMemo(
    () =>
      community
        ? db.checkpoints
            .filter((checkpoint) => checkpoint.communityId === community.id && checkpoint.active)
            .sort((a, b) => a.order - b.order)
        : [],
    [db.checkpoints, community],
  )
  const mapOwner = useMemo(() => {
    if (!community) return null
    const responsibility = db.managementResponsibilities.find(
      (item) => item.communityId === community.id && item.scope === 'map_patrol',
    )
    const memberId = responsibility?.memberId ?? community.createdBy
    return db.members.find((member) => member.id === memberId) ?? null
  }, [db.managementResponsibilities, db.members, community])

  if (!me || !community) return null

  const markers: MapMarker[] = [
    ...(showReports
      ? reports.slice(0, 40).map((r) => {
          const meta = CATEGORY_META[r.kind === 'sos' ? 'sos' : r.category]
          const author = db.members.find((m) => m.id === r.authorId)
          return {
            id: r.id,
            pos: r.at!,
            emoji: meta.emoji,
            color:
              r.status === 'resolved'
                ? '#2f5d47'
                : r.kind === 'sos'
                  ? 'var(--danger)'
                  : 'var(--warn)',
            popup: (
              <div>
                <b>{r.kind === 'sos' ? `🚨 ${t('sos')}` : t(meta.key)}</b>
                <br />
                {r.note && (
                  <>
                    {r.note}
                    <br />
                  </>
                )}
                <span style={{ opacity: 0.7 }}>
                  {author?.name} · {timeAgo(r.createdAt, lang)}
                </span>
              </div>
            ),
          }
        })
      : []),
    ...checkpoints.map((checkpoint, index) => ({
      id: `checkpoint-${checkpoint.id}`,
      pos: { lat: checkpoint.lat, lng: checkpoint.lng },
      emoji: String(index + 1),
      color: 'var(--brand)',
      popup: (
        <div>
          <b>Titik pantau #{index + 1}</b>
          <br />
          {checkpoint.name} · radius {checkpoint.radiusM} m
        </div>
      ),
    })),
  ]

  const track = showPatrol && patrols[0] ? patrols[0].points.map((p) => ({ lat: p.lat, lng: p.lng })) : []

  const startEdit = () => {
    if (!canManageMap) {
      toast('Peta lingkungan dikelola oleh Admin 1 yang ditugaskan.', 'err')
      return
    }
    setDraft(community.area)
    setEditing(true)
  }

  const commit = async () => {
    if (draft.length < 3) return toast(t('areaSizeWarn'), 'err')
    if (apiMode()) {
      const ok = await mutate(() => adminApi.saveArea(draft))
      if (!ok) return toast('Peta belum tersimpan. Periksa penugasan Admin 1 atau koneksi.', 'err')
    } else {
      saveArea(me.id, community.id, draft)
    }
    setEditing(false)
    toast(t('areaSaved'))
  }

  const center =
    (editing ? polygonCenter(draft) : polygonCenter(community.area)) ??
    community.center

  return (
    <div className="page">
      <div className="row-between" style={{ marginBottom: 12 }}>
        <div className="grow">
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>
            {editing ? t('areaEditor') : t('map')}
          </h2>
          <div className="tiny">
            {community.area.length >= 3
              ? `${t('areaPoints', { n: community.area.length })}${
                  community.areaUpdatedAt
                    ? ` · ${timeAgo(community.areaUpdatedAt, lang)}`
                    : ''
                }`
              : t('noArea')}
          </div>
        </div>
        {isAdmin && canManageMap && !editing && (
          <button className="btn btn-sm btn-ghost" onClick={startEdit}>
            <Icon name="edit" size={14} /> {t('drawArea')}
          </button>
        )}
      </div>

      <div className="banner banner-info" style={{ marginBottom: 12 }}>
        <Icon name="shield" size={17} />
        <span>
          <b>Admin 1 — Peta & titik pantau patroli</b>
          {mapOwner ? `: ${mapOwner.name}` : ''} · {checkpoints.length} titik aktif
        </span>
      </div>

      {editing && (
        <div className="banner banner-warn">
          <Icon name="info" size={17} />
          <span>{t('areaEditorHint')}</span>
        </div>
      )}

      <MapView
        className="map-box tall"
        center={center}
        zoom={16}
        area={editing ? [] : community.area}
        draftPoints={editing ? draft : undefined}
        markers={editing ? [] : markers}
        track={track}
        onMapClick={editing ? (p) => setDraft((d) => [...d, p]) : undefined}
        fitArea={!editing && community.area.length >= 2}
        recenterKey={recenter}
        showMyLocation
        language={lang}
      />

      {editing ? (
        <>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button
              className="btn btn-ghost btn-sm grow"
              onClick={() => setDraft((d) => d.slice(0, -1))}
              disabled={!draft.length}
            >
              <Icon name="chevronLeft" size={14} /> {t('undoPoint')}
            </button>
            <button
              className="btn btn-ghost btn-sm grow"
              onClick={() => setDraft([])}
              disabled={!draft.length}
            >
              <Icon name="trash" size={14} /> {t('clearArea')}
            </button>
          </div>
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button className="btn btn-ghost" onClick={() => setEditing(false)}>
              {t('cancel')}
            </button>
            <button className="btn btn-primary" onClick={() => void commit()}>
              <Icon name="check" size={16} /> {t('saveArea')} ({draft.length})
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="btn-row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
            <button
              className={`chip ${showReports ? 'chip-brand' : ''}`}
              onClick={() => setShowReports((v) => !v)}
              style={{ padding: '7px 12px' }}
            >
              <Icon name="alert" size={12} /> {t('showReports')}
            </button>
            <button
              className={`chip ${showPatrol ? 'chip-info' : ''}`}
              onClick={() => setShowPatrol((v) => !v)}
              style={{ padding: '7px 12px' }}
            >
              <Icon name="route" size={12} /> {t('showPatrol')}
            </button>
            <button
              className="chip"
              onClick={() => setRecenter((r) => r + 1)}
              style={{ padding: '7px 12px' }}
            >
              <Icon name="crosshair" size={12} /> {t('centerMap')}
            </button>
          </div>

          {community.area.length < 3 && (
            <div className="banner banner-info" style={{ marginTop: 12 }}>
              <Icon name="info" size={17} />
              <span>
                {t('noArea')}
                {isAdmin && canManageMap && (
                  <>
                    {' '}
                    <a onClick={startEdit}>{t('drawArea')}</a>
                  </>
                )}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
