import { useState } from 'react'
import { useNavigate } from 'react-router'
import { deleteAnnouncement } from '../lib/db'
import { alertApi, announcementApi } from '../lib/api'
import { getFix } from '../lib/capture'
import { apiMode, syncState } from '../lib/sync'
import { timeAgo } from '../lib/format'
import { CATEGORY_META, statusChip, statusKey } from '../lib/meta'
import { useApp } from '../lib/store'
import { Countdown } from '../ui/Countdown'
import { Icon, type IconName } from '../ui/Icon'
import { PanicGrid } from '../ui/PanicGrid'
import { SafetyCheck } from '../ui/SafetyCheck'
import { useToast } from '../ui/Toast'
import type { PanicType } from '../lib/types'

function emergencyRequestKey(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replaceAll('-', '')
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 16)}`
}

export default function Home() {
  const { db, me, community, t, lang, isAdmin, isSatpam, plan } = useApp()
  const nav = useNavigate()
  const toast = useToast()
  const [armed, setArmed] = useState<{ type: PanicType; key: string } | null>(null)
  const [sendingPanic, setSendingPanic] = useState(false)

  if (!me || !community) return null

  const reports = db.reports.filter((r) => r.communityId === community.id)
  const alerts = reports.filter((r) => r.status !== 'resolved' && r.kind !== 'tip')
  const liveSos = alerts.filter((r) => r.kind === 'sos')
  const anns = db.announcements
    .filter((a) => a.communityId === community.id)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt)
  const broadcasts = db.broadcasts
    .filter((b) => b.communityId === community.id)
    .slice(0, 3)

  /** Fires after countdown; only server confirmation may create an SOS. */
  const sendPanic = async (type: PanicType, idempotencyKey: string) => {
    if (!apiMode()) {
      setArmed(null)
      toast('Peringatan: koneksi ke server gagal. Darurat belum terkirim.', 'err')
      return
    }
    setSendingPanic(true)
    try {
      const fix = await getFix(1500)
      const result = await alertApi.raise(
        type,
        fix ? { lat: fix.lat, lng: fix.lng } : null,
        fix?.accuracy ?? null,
        idempotencyKey,
      )
      await syncState()
      setArmed(null)
      toast(t('panicSent'), 'err')
      if (navigator.vibrate) navigator.vibrate([120, 60, 120])
      nav(`/app/reports?id=${result.report.id}`)
    } catch {
      setArmed(null)
      toast('Peringatan: koneksi ke server gagal. Darurat belum terkirim.', 'err')
    } finally {
      setSendingPanic(false)
    }
  }

  const quick: { icon: IconName; label: string; color: string; bg: string; go: () => void }[] = [
    {
      icon: 'incognito',
      label: t('tip'),
      color: 'var(--purple)',
      bg: 'rgba(163,113,247,.16)',
      go: () => nav('/app/reports?tip=1'),
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
      color: 'var(--brand)',
      bg: 'var(--brand-soft)',
      go: () => nav('/app/patrol'),
    },
    {
      icon: 'users',
      label: t('myNetwork'),
      color: 'var(--warn)',
      bg: 'var(--warn-soft)',
      go: () => nav('/app/network'),
    },
    {
      icon: 'credit',
      label: 'Iuran',
      color: 'var(--brand)',
      bg: 'var(--brand-soft)',
      go: () => nav('/app/dues'),
    },
    {
      icon: 'users',
      label: 'Kelola warga',
      color: 'var(--purple)',
      bg: 'rgba(163,113,247,.14)',
      go: () => nav('/app/community'),
    },
    {
      icon: 'heart',
      label: 'Gotong royong',
      color: 'var(--danger)',
      bg: 'var(--danger-soft)',
      go: () => nav('/app/engagement'),
    },
    {
      icon: 'headset',
      label: 'WJW Assistant',
      color: 'var(--info)',
      bg: 'var(--info-soft)',
      go: () => nav('/app/assistant'),
    },
  ]

  return (
    <div className="page">
      {plan?.status === 'trial' && plan.daysLeft <= 3 && (
        <div className="banner banner-warn">
          <Icon name="gift" size={17} />
          <span>
            {plan.daysLeft <= 1 ? t('trialLastDay') : t('trialBanner', { n: plan.daysLeft })}
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

      {/* live panic alerts float to the very top */}
      {liveSos.map((r) => {
        const author = db.members.find((m) => m.id === r.authorId)
        return (
          <button
            key={r.id}
            className="live-bar"
            onClick={() => nav(`/app/reports?id=${r.id}`)}
          >
            <span className="live-dot" />
            <div className="grow">
              <div className="strong" style={{ fontSize: 13.5 }}>
                🚨 {t(CATEGORY_META[r.category].key)} · {author?.name}
              </div>
              <div className="tiny">
                {r.address} · {timeAgo(r.createdAt, lang)} ·{' '}
                {r.responders.length
                  ? `${r.responders.length} ${t('responders')}`
                  : t('noResponders')}
              </div>
            </div>
            <Icon name="chevronRight" size={17} />
          </button>
        )
      })}

      {broadcasts.map((b) => (
        <SafetyCheck key={b.id} broadcast={b} />
      ))}

      <div className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.3px' }}>
          {t('greeting', { name: me.name.split(' ')[0] })}
        </h2>
        <p className="muted" style={{ marginTop: 4 }}>
          {t('greetingSub')}
        </p>
      </div>

      <PanicGrid
        disabled={sendingPanic || !!armed}
        onTrigger={(type) => setArmed({ type, key: emergencyRequestKey() })}
        onCancel={() => toast(t('alertCancelled'))}
      />

      <div className="btn-row" style={{ marginTop: 12 }}>
        <button className="btn btn-danger grow" onClick={() => nav('/app')}>
          <Icon name="siren" size={16} /> {t('sosBig')}
        </button>
        {isAdmin && (
          <button className="btn btn-ghost grow" onClick={() => nav('/app/broadcast')}>
            <Icon name="broadcast" size={16} /> {t('broadcast')}
          </button>
        )}
      </div>

      <div className="section-title">{t('seeSomething')}</div>
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
                <div className="item-icon" style={{ background: meta.bg, color: meta.color }}>
                  <Icon name={meta.icon} size={19} />
                </div>
                <div className="grow">
                  <div className="strong truncate">
                    {r.kind === 'sos' ? `🚨 ${t(CATEGORY_META[r.category].key)}` : t(meta.key)}
                  </div>
                  <div className="tiny truncate">
                    {r.anonymous ? t('anonymousBadge') : author?.name} · {r.address || '-'}
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
          <button className="btn btn-sm btn-ghost" onClick={() => nav('/app/community')}>
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
                  onClick={() => {
                    if (!apiMode()) {
                      deleteAnnouncement(a.id)
                      return
                    }
                    void announcementApi
                      .remove(a.id)
                      .then(() => syncState())
                      .catch(() => toast('Pengumuman belum dapat dihapus dari server.', 'err'))
                  }}
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
                  {r.anonymous ? t('anonymousBadge') : author?.name} ·{' '}
                  {timeAgo(r.createdAt, lang)}
                </div>
              </div>
              <span className={`chip ${statusChip(r.status)}`}>{t(statusKey(r.status))}</span>
            </button>
          )
        })
      )}

      {armed && (
        <Countdown
          label={t(CATEGORY_META[armed.type].key)}
          sending={sendingPanic}
          onDone={() => void sendPanic(armed.type, armed.key)}
          onCancel={() => {
            if (sendingPanic) return
            setArmed(null)
            toast(t('alertCancelled'))
          }}
        />
      )}
    </div>
  )
}
