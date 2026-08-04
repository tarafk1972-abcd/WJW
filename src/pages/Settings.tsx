import { useNavigate } from 'react-router-dom'
import { resetDB, setMemberLanguage } from '../lib/db'
import { fmtDate, initials } from '../lib/format'
import { LANGS } from '../lib/i18n'
import { useApp } from '../lib/store'
import { Icon } from '../ui/Icon'
import { roleChip, roleKey } from '../lib/meta'

export default function Settings() {
  const { me, community, t, lang, plan, signOut, isAdmin, refresh } = useApp()
  const nav = useNavigate()

  if (!me || !community) return null

  return (
    <div className="page">
      <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 14 }}>{t('settings')}</h2>

      <div className="card">
        <div className="row">
          <div className={`avatar ${me.role}`} style={{ width: 52, height: 52, fontSize: 17 }}>
            {initials(me.name)}
          </div>
          <div className="grow">
            <div className="strong" style={{ fontSize: 16 }}>
              {me.name}
            </div>
            <div className="tiny">
              {me.house} · {me.phone}
            </div>
            <div className="tiny">{me.email}</div>
          </div>
          <span className={`chip ${roleChip(me.role)}`}>{t(roleKey(me.role))}</span>
        </div>
      </div>

      <div className="section-title">{t('language')}</div>
      <div className="col" style={{ gap: 8 }}>
        {LANGS.map((l) => (
          <button
            key={l.code}
            className="list-link"
            onClick={() => {
              setMemberLanguage(me.id, l.code)
              refresh()
            }}
            style={
              lang === l.code
                ? { borderColor: 'var(--brand)', background: 'var(--brand-soft)' }
                : undefined
            }
          >
            <span style={{ fontSize: 20 }}>{l.flag}</span>
            <span className="grow strong">{l.label}</span>
            {lang === l.code && <Icon name="check" size={17} color="var(--brand)" />}
          </button>
        ))}
      </div>

      <div className="section-title">{t('emergencyProfile')}</div>
      <button className="list-link" onClick={() => nav('/app/emergency-profile')}>
        <Icon name="heart" size={19} color="var(--danger)" />
        <span className="grow">
          <span className="strong" style={{ display: 'block' }}>
            {t('emergencyProfile')}
          </span>
          <span className="tiny">{t('emergencyProfileHint')}</span>
        </span>
        <Icon name="chevronRight" size={16} color="var(--text-3)" />
      </button>

      <div className="section-title" id="emergency">
        {t('myNetwork')}
      </div>
      <button className="list-link" onClick={() => nav('/app/network')}>
        <Icon name="users" size={19} color="var(--brand)" />
        <span className="grow">
          <span className="strong" style={{ display: 'block' }}>
            {t('myNetwork')}
          </span>
          <span className="tiny">{t('networkHint')}</span>
        </span>
        <Icon name="chevronRight" size={16} color="var(--text-3)" />
      </button>
      <div className="disclaimer" style={{ marginTop: 10 }}>
        <Icon name="info" size={15} />
        <span>{t('noPolice')}</span>
      </div>

      <div className="section-title">{t('community')}</div>
      <div className="card">
        <div className="row-between">
          <span className="muted">{t('communityName')}</span>
          <span className="strong">{community.name}</span>
        </div>
        <div className="divider" />
        <div className="row-between">
          <span className="muted">{t('city')}</span>
          <span className="strong">{community.city || '-'}</span>
        </div>
        <div className="divider" />
        <div className="row-between">
          <span className="muted">{t('map')}</span>
          <span className="strong">
            {community.area.length >= 3
              ? t('areaPoints', { n: community.area.length })
              : t('none')}
          </span>
        </div>
        <div className="divider" />
        <div className="row-between">
          <span className="muted">{t('billing')}</span>
          <span className="strong">
            {plan?.status === 'trial'
              ? `${t('trial')} · ${t('daysLeft', { n: plan.daysLeft })}`
              : plan?.status === 'active'
                ? `${t('paidUntil')} ${community.paidUntil ? fmtDate(community.paidUntil, lang) : '-'}`
                : t('expired')}
          </span>
        </div>
      </div>

      <div className="section-title">{t('helpSupport')}</div>
      <button className="list-link" onClick={() => nav('/app/support')}>
        <Icon name="headset" size={19} color="var(--info)" />
        <span className="grow strong">{t('contactCS')}</span>
        <Icon name="chevronRight" size={16} color="var(--text-3)" />
      </button>
      {isAdmin && (
        <button className="list-link" onClick={() => nav('/app/billing')}>
          <Icon name="credit" size={19} color="var(--brand)" />
          <span className="grow strong">{t('billing')}</span>
          <Icon name="chevronRight" size={16} color="var(--text-3)" />
        </button>
      )}

      <div className="section-title">{t('account')}</div>
      <button
        className="list-link"
        onClick={() => {
          signOut()
          nav('/')
        }}
      >
        <Icon name="logout" size={19} color="var(--warn)" />
        <span className="grow strong">{t('logout')}</span>
      </button>
      <button
        className="list-link"
        onClick={() => {
          if (confirm(t('resetDemoConfirm'))) {
            resetDB()
            nav('/')
          }
        }}
      >
        <Icon name="trash" size={19} color="var(--danger)" />
        <span className="grow strong">{t('resetDemo')}</span>
      </button>

      <p className="tiny center" style={{ marginTop: 20 }}>
        {t('appName')} · v1.0 · {t('appTagline')}
      </p>
    </div>
  )
}
