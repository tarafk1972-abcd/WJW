import { useNavigate } from 'react-router'
import { deviceId, memberById, getSessionId } from '../lib/db'
import { useApp } from '../lib/store'
import { Icon } from '../ui/Icon'
import { fmtDateTime } from '../lib/format'

export default function Pending() {
  const { db, t, lang, signOut } = useApp()
  const nav = useNavigate()
  const dev = deviceId()
  const me =
    memberById(db, getSessionId()) ??
    db.members.find((m) => m.deviceId === dev) ??
    null

  if (!me) {
    nav('/')
    return null
  }

  const rejected = me.status === 'rejected'
  const community = db.communities.find((c) => c.id === me.communityId)

  return (
    <div className="shell">
      <div className="topbar">
        <div className="brand-mark">WJW</div>
        <div className="grow">
          <h1>{t('appName')}</h1>
          <div className="sub">{community?.name}</div>
        </div>
        <button
          className="icon-btn"
          onClick={() => {
            signOut()
            nav('/')
          }}
        >
          <Icon name="logout" size={17} />
        </button>
      </div>

      <div className="page no-nav">
        <div
          className="center"
          style={{ padding: '46px 8px 30px' }}
        >
          <div
            style={{
              width: 86,
              height: 86,
              borderRadius: 28,
              margin: '0 auto 20px',
              display: 'grid',
              placeItems: 'center',
              background: rejected ? 'var(--danger-soft)' : 'var(--warn-soft)',
              color: rejected ? 'var(--danger)' : 'var(--warn)',
            }}
          >
            <Icon name={rejected ? 'x' : 'clock'} size={40} />
          </div>
          <h2 style={{ fontSize: 21, fontWeight: 800, marginBottom: 8 }}>
            {rejected ? t('rejected') : t('waitingApproval')}
          </h2>
          <p className="muted" style={{ lineHeight: 1.6 }}>
            {rejected ? t('rejectedBody') : t('waitingApprovalBody')}
          </p>
          {rejected && me.rejectedReason && (
            <div className="banner banner-danger" style={{ marginTop: 16, textAlign: 'left' }}>
              <Icon name="info" size={16} />
              <span>{me.rejectedReason}</span>
            </div>
          )}
        </div>

        <div className="card">
          <div className="row-between">
            <span className="muted">{t('name')}</span>
            <span className="strong">{me.name}</span>
          </div>
          <div className="divider" />
          <div className="row-between">
            <span className="muted">{t('phone')}</span>
            <span className="strong">{me.phone}</span>
          </div>
          <div className="divider" />
          <div className="row-between">
            <span className="muted">{t('house')}</span>
            <span className="strong">{me.house}</span>
          </div>
          <div className="divider" />
          <div className="row-between">
            <span className="muted">{t('community')}</span>
            <span className="strong">{community?.name ?? '-'}</span>
          </div>
          <div className="divider" />
          <div className="row-between">
            <span className="muted">{t('checkIn')}</span>
            <span className="strong">{fmtDateTime(me.createdAt, lang)}</span>
          </div>
        </div>

        <button
          className="btn btn-ghost"
          style={{ marginTop: 16 }}
          onClick={() => window.location.reload()}
        >
          <Icon name="crosshair" size={16} /> {t('loading')}
        </button>
      </div>
    </div>
  )
}
