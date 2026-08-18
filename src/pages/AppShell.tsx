import { NavLink, Outlet, useNavigate } from 'react-router'
import { useApp } from '../lib/store'
import { Icon, type IconName } from '../ui/Icon'
import { DutyAndPresence } from '../ui/DutyAndPresence'
import { PushPrompt } from '../ui/PushPrompt'
import { useEffect } from 'react'

export default function AppShell() {
  const { me, community, t, isAdmin, isSatpam, db, plan, signOut, online, syncError } =
    useApp()
  const nav = useNavigate()

  useEffect(() => {
    if (!me) nav('/', { replace: true })
    else if (me.role === 'superadmin') nav('/console', { replace: true })
    else if (me.status !== 'active') nav('/pending', { replace: true })
  }, [me, nav])

  if (!me || !community || me.status !== 'active') return null

  const pendingCount = isAdmin
    ? db.members.filter(
        (m) => m.communityId === community.id && m.status === 'pending',
      ).length
    : 0

  const openReports = db.reports.filter(
    (r) => r.communityId === community.id && r.status !== 'resolved',
  ).length

  const tabs: { to: string; icon: IconName; label: string; badge?: number }[] = [
    { to: '/app', icon: 'siren', label: t('sosBig') },
    { to: '/app/feed', icon: 'home', label: t('navHome') },
    { to: '/app/reports', icon: 'alert', label: t('navReports'), badge: openReports },
    { to: '/app/map', icon: 'map', label: t('navMap') },
    ...(isSatpam
      ? [{ to: '/app/patrol-check', icon: 'shield' as IconName, label: t('patrol') }]
      : []),
    ...(isAdmin || isSatpam
      ? [{ to: '/app/guests', icon: 'door' as IconName, label: t('navGuests') }]
      : []),
    ...(isAdmin
      ? [
          {
            to: '/app/admin',
            icon: 'crown' as IconName,
            label: t('navAdmin'),
            badge: pendingCount,
          },
        ]
      : [{ to: '/app/settings', icon: 'settings' as IconName, label: t('navSettings') }]),
  ]

  return (
    <div className="shell">
      <div className="topbar">
        <div className="brand-mark">WJW</div>
        <div className="grow">
          <h1>{community.name}</h1>
          <div className="sub">
            {t(
              me.role === 'admin'
                ? 'roleAdmin'
                : me.role === 'satpam'
                  ? 'roleSatpam'
                  : 'roleWarga',
            )}{' '}
            · {me.name}
          </div>
        </div>
        {plan && plan.status === 'trial' && (
          <span className="chip chip-warn">
            <Icon name="gift" size={12} /> {plan.daysLeft}
          </span>
        )}
        <button className="icon-btn" onClick={() => nav('/app/settings')}>
          <Icon name="settings" size={17} />
        </button>
        {!isAdmin && (
          <button
            className="icon-btn"
            onClick={() => {
              signOut()
              nav('/')
            }}
          >
            <Icon name="logout" size={17} />
          </button>
        )}
      </div>

      {online && syncError && (
        <div className="offline-strip">
          <Icon name="info" size={13} /> {t('offlineBanner')}
        </div>
      )}

      {/* Satpam: otomatis. Peran lain: ajakan biasa. */}
      <DutyAndPresence />
      <PushPrompt />

      <Outlet />

      <nav className="bottom-nav">
        {tabs.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.to === '/app'}>
            {({ isActive }) => (
              <>
                <Icon name={tab.icon} size={20} stroke={isActive ? 2.2 : 1.8} />
                <span>{tab.label}</span>
                {!!tab.badge && <span className="nav-badge">{tab.badge}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
