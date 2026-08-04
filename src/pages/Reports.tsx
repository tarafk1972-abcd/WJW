import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  addAttachment,
  addIncidentMessage,
  addReport,
  respondToReport,
  updateReport,
} from '../lib/db'
import { fmtDateTime, timeAgo } from '../lib/format'
import {
  CATEGORY_META,
  REPORT_CATEGORIES,
  TIP_CATEGORIES,
  statusChip,
  statusKey,
} from '../lib/meta'
import { useApp } from '../lib/store'
import { Icon } from '../ui/Icon'
import { MapView } from '../ui/MapView'
import { Sheet } from '../ui/Sheet'
import { useToast } from '../ui/Toast'
import type { LatLng, Report, ReportCategory } from '../lib/types'

type Filter = 'all' | 'open' | 'tips' | 'resolved'

/** Downscale a picked image so localStorage stays small. */
async function toThumbnail(file: File, max = 720): Promise<string> {
  const dataUrl = await new Promise<string>((res, rej) => {
    const fr = new FileReader()
    fr.onload = () => res(String(fr.result))
    fr.onerror = rej
    fr.readAsDataURL(file)
  })
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = rej
      i.src = dataUrl
    })
    const scale = Math.min(1, max / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale)
    canvas.height = Math.round(img.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return dataUrl
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.7)
  } catch {
    return dataUrl
  }
}

export default function Reports() {
  const { db, me, community, t, lang, isAdmin, isSatpam } = useApp()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState<Filter>('all')
  const [newOpen, setNewOpen] = useState(false)
  const [isTip, setIsTip] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

  const [cat, setCat] = useState<ReportCategory>('suspicious')
  const [note, setNote] = useState('')
  const [addr, setAddr] = useState('')
  const [pos, setPos] = useState<LatLng | null>(null)
  const [picking, setPicking] = useState(false)
  const [anon, setAnon] = useState(false)
  const [photos, setPhotos] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let changed = false
    if (params.get('new')) {
      setIsTip(false)
      setCat('suspicious')
      setNewOpen(true)
      params.delete('new')
      changed = true
    }
    if (params.get('tip')) {
      setIsTip(true)
      setCat('suspicious')
      setAnon(true)
      setNewOpen(true)
      params.delete('tip')
      changed = true
    }
    const id = params.get('id')
    if (id) {
      setDetailId(id)
      params.delete('id')
      changed = true
    }
    if (changed) setParams(params, { replace: true })
  }, [params, setParams])

  const list = useMemo(() => {
    if (!community) return []
    return db.reports
      .filter((r) => r.communityId === community.id)
      .filter((r) =>
        filter === 'all'
          ? true
          : filter === 'open'
            ? r.status !== 'resolved'
            : filter === 'tips'
              ? r.kind === 'tip'
              : r.status === 'resolved',
      )
  }, [db.reports, community, filter])

  const detail = detailId ? (db.reports.find((r) => r.id === detailId) ?? null) : null

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

  const pickPhotos = async (files: FileList | null) => {
    if (!files?.length) return
    const next: string[] = []
    for (const f of Array.from(files).slice(0, 3)) next.push(await toThumbnail(f))
    setPhotos((p) => [...p, ...next].slice(0, 3))
    toast(t('photoAdded'))
  }

  const resetForm = () => {
    setNote('')
    setAddr('')
    setPos(null)
    setPicking(false)
    setAnon(false)
    setPhotos([])
  }

  const submit = () => {
    const rep = addReport({
      communityId: community.id,
      authorId: me.id,
      kind: isTip ? 'tip' : 'incident',
      category: cat,
      note: note.trim(),
      at: pos,
      address: addr.trim() || (isTip ? '' : me.house),
      anonymous: isTip ? anon : false,
    })
    photos.forEach((p) => addAttachment(rep.id, p))
    resetForm()
    setNewOpen(false)
    toast(t(isTip ? 'tipSent' : 'reportSent'))
  }

  const categories = isTip ? TIP_CATEGORIES : REPORT_CATEGORIES

  return (
    <div className="page">
      <div className="row-between" style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800 }}>{t('reports')}</h2>
        <div className="btn-row">
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setIsTip(true)
              setAnon(true)
              setCat('suspicious')
              setNewOpen(true)
            }}
          >
            <Icon name="incognito" size={14} /> {t('tip')}
          </button>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => {
              setIsTip(false)
              setAnon(false)
              setNewOpen(true)
            }}
          >
            <Icon name="plus" size={14} /> {t('newReport')}
          </button>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: 14 }}>
        {(['all', 'open', 'tips', 'resolved'] as Filter[]).map((f) => (
          <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
            {t(
              f === 'all'
                ? 'all'
                : f === 'open'
                  ? 'statusOpen'
                  : f === 'tips'
                    ? 'tips'
                    : 'statusResolved',
            )}
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
            <button key={r.id} className="item" onClick={() => setDetailId(r.id)}>
              <div className="item-icon" style={{ background: meta.bg, color: meta.color }}>
                <Icon name={r.kind === 'tip' ? 'incognito' : meta.icon} size={19} />
              </div>
              <div className="grow">
                <div className="row" style={{ gap: 6 }}>
                  <span className="strong truncate">
                    {r.kind === 'sos'
                      ? `🚨 ${t(CATEGORY_META[r.category].key)}`
                      : t(meta.key)}
                  </span>
                  <span className={`chip ${statusChip(r.status)}`}>{t(statusKey(r.status))}</span>
                </div>
                {r.note && (
                  <div className="muted truncate" style={{ fontSize: 13 }}>
                    {r.note}
                  </div>
                )}
                <div className="tiny truncate">
                  {r.anonymous ? `🕶️ ${t('anonymousBadge')}` : author?.name}
                  {r.address ? ` · ${r.address}` : ''} · {timeAgo(r.createdAt, lang)}
                  {r.attachments.length > 0 && ` · 📷 ${r.attachments.length}`}
                </div>
              </div>
            </button>
          )
        })
      )}

      {/* ---- new report / tip ---- */}
      <Sheet
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title={isTip ? t('newTip') : t('newReport')}
        subtitle={isTip ? t('tipHint') : undefined}
      >
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
            {categories.map((c) => {
              const m = CATEGORY_META[c]
              return (
                <button
                  key={c}
                  className="quick"
                  onClick={() => setCat(c)}
                  style={
                    cat === c ? { borderColor: m.color, background: m.bg, color: m.color } : undefined
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
          />
        </label>
        <label className="field">
          <span>{t('address')}</span>
          <input
            className="input"
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            placeholder={isTip ? '' : me.house}
          />
        </label>

        {isTip && (
          <label
            className="row"
            style={{
              marginBottom: 13,
              padding: '11px 13px',
              background: anon ? 'rgba(163,113,247,.14)' : 'var(--bg-2)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <input
              type="checkbox"
              checked={anon}
              onChange={(e) => setAnon(e.target.checked)}
            />
            <div className="grow">
              <div className="strong" style={{ fontSize: 13.5 }}>
                <Icon name="incognito" size={13} /> {t('anonymous')}
              </div>
              <div className="tiny">{t('anonymousNote')}</div>
            </div>
          </label>
        )}

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
            {t('photos')}
          </span>
          {photos.length > 0 && (
            <div className="thumb-grid" style={{ marginBottom: 8 }}>
              {photos.map((p, i) => (
                <img key={i} src={p} alt="" className="thumb" />
              ))}
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => void pickPhotos(e.target.files)}
          />
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => fileRef.current?.click()}
            disabled={photos.length >= 3}
          >
            <Icon name="camera" size={14} /> {t('addPhoto')}
          </button>
        </div>

        <div className="btn-row" style={{ marginBottom: 10 }}>
          <button className="btn btn-ghost btn-sm grow" onClick={useMyLocation}>
            <Icon name="crosshair" size={14} /> {t('useMyLocation')}
          </button>
          <button className="btn btn-ghost btn-sm grow" onClick={() => setPicking((v) => !v)}>
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
          </div>
        )}

        <button className="btn btn-primary" onClick={submit}>
          <Icon name="send" size={16} /> {t('submit')}
        </button>
      </Sheet>

      {/* ---- detail ---- */}
      <Sheet
        open={!!detail}
        onClose={() => setDetailId(null)}
        title={
          detail
            ? detail.kind === 'sos'
              ? `🚨 ${t(CATEGORY_META[detail.category].key)}`
              : t(CATEGORY_META[detail.category].key)
            : ''
        }
      >
        {detail && (
          <ReportDetail
            report={detail}
            canHandle={canHandle}
            onClose={() => setDetailId(null)}
          />
        )}
      </Sheet>
    </div>
  )
}

function ReportDetail({
  report,
  canHandle,
  onClose,
}: {
  report: Report
  canHandle: boolean
  onClose: () => void
}) {
  const { db, me, t, lang, community } = useApp()
  const toast = useToast()
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  if (!me) return null
  const author = db.members.find((m) => m.id === report.authorId)
  const meta = CATEGORY_META[report.kind === 'sos' ? 'sos' : report.category]
  const iAmResponding = report.responders.includes(me.id)
  const isMine = report.authorId === me.id
  const showAuthor = !report.anonymous || isMine || canHandle

  return (
    <>
      <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 6 }}>
        <span className={`chip ${statusChip(report.status)}`}>{t(statusKey(report.status))}</span>
        {report.kind === 'sos' && (
          <span className="chip chip-danger">
            <Icon name="siren" size={11} /> {t('sos')}
          </span>
        )}
        {report.kind === 'tip' && (
          <span className="chip chip-purple">
            <Icon name="incognito" size={11} /> {t('tip')}
          </span>
        )}
        {report.anonymous && <span className="chip chip-purple">{t('anonymousBadge')}</span>}
        {report.insideArea === false && <span className="chip chip-warn">{t('outsideArea')}</span>}
        {report.insideArea === true && <span className="chip chip-brand">{t('insideArea')}</span>}
      </div>

      {report.note && <p style={{ marginBottom: 12 }}>{report.note}</p>}

      {report.attachments.length > 0 && (
        <div className="thumb-grid" style={{ marginBottom: 12 }}>
          {report.attachments.map((a) => (
            <img key={a.id} src={a.dataUrl} alt="" className="thumb" />
          ))}
        </div>
      )}

      {report.at && community && (
        <div style={{ marginBottom: 12 }}>
          <MapView
            className="map-box short"
            center={report.at}
            zoom={17}
            area={community.area}
            markers={[{ id: report.id, pos: report.at, emoji: meta.emoji, color: 'var(--danger)' }]}
          />
        </div>
      )}

      <div className="card card-tight">
        <div className="row-between">
          <span className="muted">{t('by')}</span>
          <span className="strong">
            {showAuthor ? (author?.name ?? '-') : t('anonymousBadge')}
          </span>
        </div>
        {report.address && (
          <>
            <div className="divider" />
            <div className="row-between">
              <span className="muted">{t('address')}</span>
              <span className="strong">{report.address}</span>
            </div>
          </>
        )}
        <div className="divider" />
        <div className="row-between">
          <span className="muted">{t('checkIn')}</span>
          <span className="strong">{fmtDateTime(report.createdAt, lang)}</span>
        </div>
        {report.responders.length > 0 && (
          <>
            <div className="divider" />
            <div className="row-between">
              <span className="muted">{t('responders')}</span>
              <span className="strong">
                {report.responders
                  .map((id) => db.members.find((m) => m.id === id)?.name ?? '')
                  .filter(Boolean)
                  .join(', ')}
              </span>
            </div>
          </>
        )}
      </div>

      {/* emergency profile is surfaced to responders on panic alerts */}
      {report.kind === 'sos' && canHandle && author?.emergency && (
        <div className="card card-tight" style={{ marginTop: 10 }}>
          <div className="tiny strong" style={{ marginBottom: 6 }}>
            <Icon name="heart" size={12} /> {t('emergencyProfile')}
          </div>
          {author.emergency.bloodType && (
            <div className="row-between">
              <span className="muted">{t('bloodType')}</span>
              <span className="strong">{author.emergency.bloodType}</span>
            </div>
          )}
          {author.emergency.allergies && (
            <div className="row-between">
              <span className="muted">{t('allergies')}</span>
              <span className="strong">{author.emergency.allergies}</span>
            </div>
          )}
          {author.emergency.conditions && (
            <div className="row-between">
              <span className="muted">{t('conditions')}</span>
              <span className="strong">{author.emergency.conditions}</span>
            </div>
          )}
          {author.emergency.contactPhone && (
            <a className="btn btn-sm btn-ghost" style={{ marginTop: 8 }} href={`tel:${author.emergency.contactPhone}`}>
              <Icon name="phone" size={13} /> {author.emergency.contactName || t('contactName')}
            </a>
          )}
        </div>
      )}

      {/* two-way updates */}
      <div className="section-title" style={{ marginTop: 16 }}>
        {t('updates')}
      </div>
      <div className="col" style={{ gap: 8, marginBottom: 12 }}>
        {report.messages.length === 0 && <p className="tiny">{t('noActivity')}</p>}
        {report.messages.map((m) => {
          const from = db.members.find((x) => x.id === m.from)
          if (m.system) {
            return (
              <div key={m.id} className="tiny center">
                <Icon name="route" size={11} />{' '}
                {t('systemResponding', { name: from?.name ?? '' })} · {timeAgo(m.at, lang)}
              </div>
            )
          }
          return (
            <div key={m.id} className={`msg ${m.from === me.id ? 'mine' : 'theirs'}`}>
              <div className="tiny" style={{ marginBottom: 2 }}>
                {m.from === me.id ? t('you') : (from?.name ?? '')} · {timeAgo(m.at, lang)}
              </div>
              {m.body}
            </div>
          )
        })}
      </div>

      {report.status !== 'resolved' && (
        <div className="row" style={{ gap: 8, marginBottom: 12 }}>
          <input
            className="input grow"
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            placeholder={t('writeUpdate')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && msg.trim()) {
                addIncidentMessage(report.id, me.id, msg.trim())
                setMsg('')
              }
            }}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              addAttachment(report.id, await toThumbnail(f))
              toast(t('photoAdded'))
            }}
          />
          <button className="icon-btn" onClick={() => fileRef.current?.click()}>
            <Icon name="camera" size={17} />
          </button>
          <button
            className="icon-btn"
            style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
            onClick={() => {
              if (!msg.trim()) return
              addIncidentMessage(report.id, me.id, msg.trim())
              setMsg('')
            }}
          >
            <Icon name="send" size={17} />
          </button>
        </div>
      )}

      {canHandle && report.status !== 'resolved' && (
        <div className="btn-row">
          {!iAmResponding && (
            <button
              className="btn btn-ghost"
              onClick={() => {
                respondToReport(me.id, report.id)
                toast(t('responding'))
              }}
            >
              <Icon name="route" size={15} /> {t('iAmResponding')}
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={() => {
              updateReport(me.id, report.id, { status: 'resolved' })
              toast(t('statusResolved'))
              onClose()
            }}
          >
            <Icon name="check" size={15} /> {t('resolveReport')}
          </button>
        </div>
      )}

    </>
  )
}
