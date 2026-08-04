import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { addAnnouncement, addReport, deleteAnnouncement } from '../lib/db'
import { timeAgo } from '../lib/format'
import { useApp } from '../lib/store'
import { Icon, type IconName } from '../ui/Icon'
import { Sheet } from '../ui/Sheet'
import { useToast } from '../ui/Toast'
import { CATEGORY_META, statusChip, statusKey } from '../lib/meta'
import type { LatLng } from '../lib/types'

export default function Home() {
  const { db, me, community, t, lang, isAdmin, isSatpam, plan } = useApp()
  const nav = useNavigate()
  const toast = useToast()
  const [sosOpen, setSosOpen] = useState(false)
  const [annOpen, setAnnOpen] = useState(false)
  const [aTitle, setATitle] = useState('')
  const [aBody, setABody] = useState('')
  const [aPin, setAPin] = useState(false)

  if (!me || !community) return null

  const reports = db.reports.filter((r) => r.communityId === community.id)
  const alerts = reports.filter((r) => r.status !== 'resolved')
  const anns = db.announcements
    .filter((a) => a.communityId === community.id)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt)

  const sendSos = async () => {
    let at: LatLng | null = null
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 }),
      )
      at = { lat: pos.coords.latitude, lng: pos.coords.longitude }
    } catch {
      at = community.center
    }
    addReport({
      communityId: community.id,
      authorId: me.id,
      kind: 'sos',
      category: 'other',
      note: t('sos'),
      at,
      address: me.house,
    })
    setSosOpen(false)
    toast(t('sosSent'), 'err')
    if (navigator.vibrate) navigator.vibrate([120, 60, 120])
  }

  const postAnn = () => {
    if (!aTitle.trim()) return
    addAnnouncement({
      communityId: community.id,
      authorId: me.id,
      title: aTitle.trim(),
      body: aBody.trim(),
      pinned: aPin,
    })
    setATitle('')
    setABody('')
    setAPin(false)
    setAnnOpen(false)
    toast(t('post'))
  }

  const quick: { icon: IconName; label: string; color: string; bg: string; go: () => void }[] = [
    {
      icon: 'alert',
      label: t('quickReport'),
      color: 'var(--warn)',
      bg: 'var(--warn-soft)',
      go: () => nav('/app/reports?new=1'),
    },
    {
      icon: 'door',
      label: t('quickGuest'),
      color: 'var(--info)',
      bg: 'var(--info-soft)',
      go: () => nav(isAdmin || isSatpam ? '/app/guests?new=1' : '/app/guests'),
    },
    {
      icon: 'route',
      label: t('quickPatrol'),
      color: 'var(--purple)',
      bg: 'rgba(163,113,247,.16)',
      go: () => nav('/app/patrol'),
    },
    {
      icon: 'phone',
      label: t('quickCall'),
      color: 'var(--brand)',
      bg: 'var(--brand-soft)',
      go: () => nav('/app/settings#emergency'),
    },
  ]

  return (
    <div className="page">
      {plan?.status === 'trial' && plan.daysLeft <= 3 && (
        <div className="banner banner-warn">
          <Icon name="gift" size={17} />
          <span>
            {plan.daysLeft <= 1
              ? t('trialLastDay')
              : t('trialBanner', { n: plan.daysLeft })}
            {isAdmin && (
              <>
                {' '}
                <a onClick={() => nav('/app/billing')}>{t('subscribe')}</a>
              </>
            )}
          </span>
        </div>
      )}
      {plan?.status === 'expired' && (
        <div className="banner banner-danger">
          <Icon name="lock" size={17} />
          <span>
            {t('trialEnded')} {t('trialEndedBody')}
            {isAdmin && (
              <>
                {' '}
                <a onClick={() => nav('/app/billing')}>{t('subscribe')}</a>
              </>
            )}
          </span>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.3px' }}>
          {t('greeting', { name: me.name.split(' ')[0] })}
        </h2>
        <p className="muted" style={{ marginTop: 4 }}>
          {t('greetingSub')}
        </p>
      </div>

      <div className="sos-wrap">
        <button className="sos-btn" onClick={() => setSosOpen(true)}>
          <div>
            {t('sos')}
            <small>SOS</small>
          </div>
        </button>
      </div>
      <p className="tiny center" style={{ margin: '12px 0 20px' }}>
        {t('sosHold')}
      </p>

      <div className="quick-grid">
        {quick.map((q) => (
          <button key={q.label} className="quick" onClick={q.go}>
            <div className="ic" style={{ background: q.bg, color: q.color }}>
              <Icon name={q.icon} size={18} />
            </div>
            {q.label}
          </button>
        ))}
      </div>

      {alerts.length > 0 && (
        <>
          <div className="section-title">
            {t('activeAlerts')}
            <span className="chip chip-danger">{alerts.length}</span>
          </div>
          {alerts.slice(0, 3).map((r) => {
            const meta = CATEGORY_META[r.kind === 'sos' ? 'sos' : r.category]
            const author = db.members.find((m) => m.id === r.authorId)
            return (
              <button
                key={r.id}
                className="item"
                onClick={() => nav(`/app/reports?id=${r.id}`)}
              >
                <div
                  className="item-icon"
                  style={{ background: meta.bg, color: meta.color }}
                >
                  <Icon name={meta.icon} size={19} />
                </div>
                <div className="grow">
                  <div className="strong truncate">
                    {r.kind === 'sos' ? `🚨 ${t('sos')}` : t(meta.key)}
                  </div>
                  <div className="tiny truncate">
                    {author?.name} · {r.address || '-'}
                  </div>
                </div>
                <div className="tiny" style={{ flex: 'none' }}>
                  {timeAgo(r.createdAt, lang)}
                </div>
              </button>
            )
          })}
        </>
      )}

      <div className="section-title">
        {t('announcements')}
        {isAdmin && (
          <button className="btn btn-sm btn-ghost" onClick={() => setAnnOpen(true)}>
            <Icon name="plus" size={13} /> {t('newAnnouncement')}
          </button>
        )}
      </div>
      {anns.length === 0 ? (
        <div className="empty">
          <span className="em">📢</span>
          {t('noAnnouncements')}
        </div>
      ) : (
        anns.slice(0, 5).map((a) => {
          const author = db.members.find((m) => m.id === a.authorId)
          return (
            <div key={a.id} className="item">
              <div
                className="item-icon"
                style={{ background: 'var(--info-soft)', color: 'var(--info)' }}
              >
                <Icon name="megaphone" size={19} />
              </div>
              <div className="grow">
                <div className="row" style={{ gap: 6 }}>
                  <span className="strong">{a.title}</span>
                  {a.pinned && <span className="chip chip-info">📌</span>}
                </div>
                {a.body && (
                  <p className="muted" style={{ marginTop: 3, fontSize: 13 }}>
                    {a.body}
                  </p>
                )}
                <div className="tiny" style={{ marginTop: 4 }}>
                  {author?.name} · {timeAgo(a.createdAt, lang)}
                </div>
              </div>
              {isAdmin && (
                <button
                  className="icon-btn"
                  style={{ width: 30, height: 30 }}
                  onClick={() => deleteAnnouncement(a.id)}
                >
                  <Icon name="trash" size={14} />
                </button>
              )}
            </div>
          )
        })
      )}

      <div className="section-title">{t('latestActivity')}</div>
      {reports.length === 0 ? (
        <div className="empty">
          <span className="em">🌿</span>
          {t('noActivity')}
        </div>
      ) : (
        reports.slice(0, 5).map((r) => {
          const meta = CATEGORY_META[r.kind === 'sos' ? 'sos' : r.category]
          const author = db.members.find((m) => m.id === r.authorId)
          return (
            <button
              key={r.id}
              className="item"
              onClick={() => nav(`/app/reports?id=${r.id}`)}
            >
              <div className="item-icon" style={{ background: meta.bg, color: meta.color }}>
                <Icon name={meta.icon} size={19} />
              </div>
              <div className="grow">
                <div className="strong truncate">{t(meta.key)}</div>
                <div className="tiny truncate">
                  {author?.name} · {timeAgo(r.createdAt, lang)}
                </div>
              </div>
              <span className={`chip ${statusChip(r.status)}`}>
                {t(statusKey(r.status))}
              </span>
            </button>
          )
        })
      )}

      <Sheet
        open={sosOpen}
        onClose={() => setSosOpen(false)}
        title={t('sosConfirmTitle')}
        subtitle={t('sosConfirmBody')}
      >
        <button className="btn btn-danger" onClick={sendSos}>
          <Icon name="alert" size={17} /> {t('sos')}
        </button>
        <button
          className="btn btn-ghost"
          style={{ marginTop: 8 }}
          onClick={() => setSosOpen(false)}
        >
          {t('cancel')}
        </button>
      </Sheet>

      <Sheet
        open={annOpen}
        onClose={() => setAnnOpen(false)}
        title={t('newAnnouncement')}
      >
        <label className="field">
          <span>{t('title')}</span>
          <input
            className="input"
            value={aTitle}
            onChange={(e) => setATitle(e.target.value)}
          />
        </label>
        <label className="field">
          <span>{t('body')}</span>
          <textarea
            className="textarea"
            value={aBody}
            onChange={(e) => setABody(e.target.value)}
          />
        </label>
        <label className="row" style={{ marginBottom: 14 }}>
          <input
            type="checkbox"
            checked={aPin}
            onChange={(e) => setAPin(e.target.checked)}
          />
          <span className="muted">{t('pin')}</span>
        </label>
        <button className="btn btn-primary" onClick={postAnn}>
          <Icon name="send" size={16} /> {t('post')}
        </button>
      </Sheet>
    </div>
  )
}
