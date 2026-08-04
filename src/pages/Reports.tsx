import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { addReport, updateReport } from '../lib/db'
import { fmtDateTime, timeAgo } from '../lib/format'
import { useApp } from '../lib/store'
import { Icon } from '../ui/Icon'
import { MapView } from '../ui/MapView'
import { Sheet } from '../ui/Sheet'
import { useToast } from '../ui/Toast'
import {
  CATEGORY_META,
  REPORT_CATEGORIES,
  statusChip,
  statusKey,
} from '../lib/meta'
import type { LatLng, Report, ReportCategory } from '../lib/types'

export default function Reports() {
  const { db, me, community, t, lang, isAdmin, isSatpam } = useApp()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('all')
  const [newOpen, setNewOpen] = useState(false)
  const [detail, setDetail] = useState<Report | null>(null)

  const [cat, setCat] = useState<ReportCategory>('suspicious')
  const [note, setNote] = useState('')
  const [addr, setAddr] = useState('')
  const [pos, setPos] = useState<LatLng | null>(null)
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    if (params.get('new')) {
      setNewOpen(true)
      params.delete('new')
      setParams(params, { replace: true })
    }
    const id = params.get('id')
    if (id) {
      const r = db.reports.find((x) => x.id === id)
      if (r) setDetail(r)
      params.delete('id')
      setParams(params, { replace: true })
    }
  }, [params, setParams, db.reports])

  const list = useMemo(() => {
    if (!community) return []
    return db.reports
      .filter((r) => r.communityId === community.id)
      .filter((r) =>
        filter === 'all'
          ? true
          : filter === 'open'
            ? r.status !== 'resolved'
            : r.status === 'resolved',
      )
  }, [db.reports, community, filter])

  if (!me || !community) return null

  const canHandle = isAdmin || isSatpam

  const useMyLocation = async () => {
    try {
      const p = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 6000 }),
      )
      setPos({ lat: p.coords.latitude, lng: p.coords.longitude })
      toast(t('locationSet'))
    } catch {
      toast(t('errGeo'), 'err')
      setPicking(true)
    }
  }

  const submit = () => {
    addReport({
      communityId: community.id,
      authorId: me.id,
      kind: 'incident',
      category: cat,
      note: note.trim(),
      at: pos,
      address: addr.trim() || me.house,
    })
    setNote('')
    setAddr('')
    setPos(null)
    setPicking(false)
    setNewOpen(false)
    toast(t('reportSent'))
  }

  return (
    <div className="page">
      <div className="row-between" style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800 }}>{t('reports')}</h2>
        <button className="btn btn-sm btn-primary" onClick={() => setNewOpen(true)}>
          <Icon name="plus" size={14} /> {t('newReport')}
        </button>
      </div>

      <div className="tabs" style={{ marginBottom: 14 }}>
        {(['all', 'open', 'resolved'] as const).map((f) => (
          <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
            {t(f === 'all' ? 'all' : f === 'open' ? 'statusOpen' : 'statusResolved')}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="empty">
          <span className="em">🕊️</span>
          {t('noReports')}
        </div>
      ) : (
        list.map((r) => {
          const meta = CATEGORY_META[r.kind === 'sos' ? 'sos' : r.category]
          const author = db.members.find((m) => m.id === r.authorId)
          return (
            <button key={r.id} className="item" onClick={() => setDetail(r)}>
              <div className="item-icon" style={{ background: meta.bg, color: meta.color }}>
                <Icon name={meta.icon} size={19} />
              </div>
              <div className="grow">
                <div className="row" style={{ gap: 6 }}>
                  <span className="strong truncate">
                    {r.kind === 'sos' ? `🚨 ${t('sos')}` : t(meta.key)}
                  </span>
                  <span className={`chip ${statusChip(r.status)}`}>
                    {t(statusKey(r.status))}
                  </span>
                </div>
                {r.note && (
                  <div className="muted truncate" style={{ fontSize: 13 }}>
                    {r.note}
                  </div>
                )}
                <div className="tiny truncate">
                  {author?.name} · {r.address} · {timeAgo(r.createdAt, lang)}
                </div>
              </div>
            </button>
          )
        })
      )}

      {/* new report sheet */}
      <Sheet open={newOpen} onClose={() => setNewOpen(false)} title={t('newReport')}>
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
            {t('category')}
          </span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
            {REPORT_CATEGORIES.map((c) => {
              const m = CATEGORY_META[c]
              return (
                <button
                  key={c}
                  className="quick"
                  onClick={() => setCat(c)}
                  style={
                    cat === c
                      ? { borderColor: m.color, background: m.bg, color: m.color }
                      : undefined
                  }
                >
                  <div className="ic" style={{ background: m.bg, color: m.color }}>
                    <Icon name={m.icon} size={17} />
                  </div>
                  {t(m.key)}
                </button>
              )
            })}
          </div>
        </div>

        <label className="field">
          <span>{t('note')}</span>
          <textarea
            className="textarea"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="…"
          />
        </label>
        <label className="field">
          <span>{t('address')}</span>
          <input
            className="input"
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            placeholder={me.house}
          />
        </label>

        <div className="btn-row" style={{ marginBottom: 10 }}>
          <button className="btn btn-ghost btn-sm grow" onClick={useMyLocation}>
            <Icon name="crosshair" size={14} /> {t('useMyLocation')}
          </button>
          <button
            className="btn btn-ghost btn-sm grow"
            onClick={() => setPicking((v) => !v)}
          >
            <Icon name="pin" size={14} /> {t('pickOnMap')}
          </button>
        </div>

        {(picking || pos) && (
          <div style={{ marginBottom: 12 }}>
            <MapView
              className="map-box short"
              center={pos ?? community.center}
              area={community.area}
              zoom={16}
              onMapClick={picking ? (p) => setPos(p) : undefined}
              markers={
                pos
                  ? [{ id: 'pick', pos, emoji: CATEGORY_META[cat].emoji, color: 'var(--danger)' }]
                  : []
              }
            />
            {pos && (
              <div className="tiny" style={{ marginTop: 6 }}>
                <Icon name="pin" size={11} /> {pos.lat.toFixed(5)}, {pos.lng.toFixed(5)}
              </div>
            )}
          </div>
        )}

        <button className="btn btn-primary" onClick={submit}>
          <Icon name="send" size={16} /> {t('submit')}
        </button>
      </Sheet>

      {/* detail sheet */}
      <Sheet
        open={!!detail}
        onClose={() => setDetail(null)}
        title={
          detail
            ? detail.kind === 'sos'
              ? `🚨 ${t('sos')}`
              : t(CATEGORY_META[detail.category].key)
            : ''
        }
      >
        {detail && (
          <ReportDetail
            report={db.reports.find((r) => r.id === detail.id) ?? detail}
            canHandle={canHandle}
            onAction={(status) => {
              updateReport(me.id, detail.id, { status })
              toast(t(status === 'ack' ? 'statusAck' : 'statusResolved'))
              if (status === 'resolved') setDetail(null)
            }}
          />
        )}
      </Sheet>
    </div>
  )
}

function ReportDetail({
  report,
  canHandle,
  onAction,
}: {
  report: Report
  canHandle: boolean
  onAction: (s: 'ack' | 'resolved') => void
}) {
  const { db, t, lang, community } = useApp()
  const author = db.members.find((m) => m.id === report.authorId)
  const handler = db.members.find((m) => m.id === report.handledBy)
  const meta = CATEGORY_META[report.kind === 'sos' ? 'sos' : report.category]

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className={`chip ${statusChip(report.status)}`}>
          {t(statusKey(report.status))}
        </span>
        {report.insideArea === false && (
          <span className="chip chip-warn">{t('outsideArea')}</span>
        )}
        {report.insideArea === true && (
          <span className="chip chip-brand">{t('insideArea')}</span>
        )}
      </div>

      {report.note && <p style={{ marginBottom: 12 }}>{report.note}</p>}

      {report.at && community && (
        <div style={{ marginBottom: 12 }}>
          <MapView
            className="map-box short"
            center={report.at}
            zoom={17}
            area={community.area}
            markers={[
              { id: report.id, pos: report.at, emoji: meta.emoji, color: 'var(--danger)' },
            ]}
          />
        </div>
      )}

      <div className="card card-tight">
        <div className="row-between">
          <span className="muted">{t('by')}</span>
          <span className="strong">{author?.name ?? '-'}</span>
        </div>
        <div className="divider" />
        <div className="row-between">
          <span className="muted">{t('address')}</span>
          <span className="strong">{report.address || '-'}</span>
        </div>
        <div className="divider" />
        <div className="row-between">
          <span className="muted">{t('checkIn')}</span>
          <span className="strong">{fmtDateTime(report.createdAt, lang)}</span>
        </div>
        {handler && (
          <>
            <div className="divider" />
            <div className="row-between">
              <span className="muted">{t('handledBy')}</span>
              <span className="strong">{handler.name}</span>
            </div>
          </>
        )}
      </div>

      {canHandle && report.status !== 'resolved' && (
        <div className="btn-row" style={{ marginTop: 14 }}>
          {report.status === 'open' && (
            <button className="btn btn-ghost" onClick={() => onAction('ack')}>
              <Icon name="eye" size={15} /> {t('ackReport')}
            </button>
          )}
          <button className="btn btn-primary" onClick={() => onAction('resolved')}>
            <Icon name="check" size={15} /> {t('resolveReport')}
          </button>
        </div>
      )}
    </>
  )
}
