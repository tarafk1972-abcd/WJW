import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  createInvite,
  decideMember,
  setMemberStatus,
  setRole,
} from '../lib/db'
import { fmtDate, initials, timeAgo } from '../lib/format'
import { useApp } from '../lib/store'
import { Icon } from '../ui/Icon'
import { Sheet } from '../ui/Sheet'
import { useToast } from '../ui/Toast'
import { ASSIGNABLE_ROLES, roleChip, roleKey } from '../lib/meta'
import type { Member, Role } from '../lib/types'

export default function Admin() {
  const { db, me, community, t, lang, isAdmin, plan } = useApp()
  const nav = useNavigate()
  const toast = useToast()
  const [tab, setTab] = useState<'pending' | 'members' | 'invites'>('pending')
  const [target, setTarget] = useState<Member | null>(null)
  const [pickRole, setPickRole] = useState<Exclude<Role, 'superadmin'>>('warga')
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteRole, setInviteRole] = useState<Exclude<Role, 'superadmin'>>('admin')
  const [lastCode, setLastCode] = useState('')

  const members = useMemo(
    () => (community ? db.members.filter((m) => m.communityId === community.id) : []),
    [db.members, community],
  )
  const pending = members.filter((m) => m.status === 'pending')
  const active = members.filter((m) => m.status === 'active')
  const invites = useMemo(
    () => (community ? db.invites.filter((i) => i.communityId === community.id) : []),
    [db.invites, community],
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

  const accept = () => {
    if (!target) return
    decideMember(me.id, target.id, 'accept', pickRole)
    toast(t('memberAccepted', { name: target.name, role: t(roleKey(pickRole)) }))
    setTarget(null)
  }

  const reject = () => {
    if (!target) return
    decideMember(me.id, target.id, 'reject', 'warga', reason.trim())
    toast(t('memberRejected', { name: target.name }), 'err')
    setTarget(null)
    setRejecting(false)
    setReason('')
  }

  const makeInvite = () => {
    const inv = createInvite(me.id, community.id, inviteRole)
    setLastCode(inv.code)
    toast(t('inviteCreated'))
  }

  return (
    <div className="page">
      <div className="row-between" style={{ marginBottom: 14 }}>
        <div className="grow">
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>{t('navAdmin')}</h2>
          <div className="tiny">{community.name}</div>
        </div>
        <span className={`chip ${plan?.status === 'active' ? 'chip-brand' : 'chip-warn'}`}>
          <Icon name="gift" size={12} />{' '}
          {plan?.status === 'trial'
            ? t('daysLeft', { n: plan.daysLeft })
            : t(plan?.status === 'active' ? 'active' : 'expired')}
        </span>
      </div>

      <div className="stat-grid" style={{ marginBottom: 8 }}>
        <div className="stat">
          <div className="n">{active.length}</div>
          <div className="l">{t('totalMembers')}</div>
        </div>
        <div className="stat">
          <div className="n" style={{ color: pending.length ? 'var(--warn)' : undefined }}>
            {pending.length}
          </div>
          <div className="l">{t('pendingApprovals')}</div>
        </div>
      </div>

      <div className="btn-row" style={{ margin: '10px 0 4px' }}>
        <button className="btn btn-sm btn-ghost grow" onClick={() => nav('/app/map')}>
          <Icon name="map" size={14} /> {t('areaEditor')}
        </button>
        <button className="btn btn-sm btn-ghost grow" onClick={() => nav('/app/billing')}>
          <Icon name="credit" size={14} /> {t('billing')}
        </button>
      </div>
      <div className="btn-row" style={{ marginBottom: 14 }}>
        <button className="btn btn-sm btn-ghost grow" onClick={() => nav('/app/patrol')}>
          <Icon name="route" size={14} /> {t('patrol')}
        </button>
        <button className="btn btn-sm btn-ghost grow" onClick={() => nav('/app/support')}>
          <Icon name="headset" size={14} /> {t('contactCS')}
        </button>
      </div>

      <div className="tabs" style={{ marginBottom: 14 }}>
        <button className={tab === 'pending' ? 'on' : ''} onClick={() => setTab('pending')}>
          {t('pendingApprovals')} {pending.length > 0 && `(${pending.length})`}
        </button>
        <button className={tab === 'members' ? 'on' : ''} onClick={() => setTab('members')}>
          {t('members')}
        </button>
        <button className={tab === 'invites' ? 'on' : ''} onClick={() => setTab('invites')}>
          {t('invites')}
        </button>
      </div>

      {tab === 'pending' &&
        (pending.length === 0 ? (
          <div className="empty">
            <span className="em">✅</span>
            {t('noPending')}
          </div>
        ) : (
          pending.map((m) => (
            <div key={m.id} className="item">
              <div className="avatar">{initials(m.name)}</div>
              <div className="grow">
                <div className="strong truncate">{m.name}</div>
                <div className="tiny truncate">
                  {m.house} · {m.phone}
                </div>
                <div className="tiny truncate">
                  {m.email} · {timeAgo(m.createdAt, lang)}
                </div>
              </div>
              <button
                className="btn btn-sm btn-primary"
                onClick={() => {
                  setTarget(m)
                  setPickRole('warga')
                  setRejecting(false)
                }}
              >
                {t('confirm')}
              </button>
            </div>
          ))
        ))}

      {tab === 'members' &&
        active.map((m) => (
          <button
            key={m.id}
            className="item"
            onClick={() => {
              setTarget(m)
              setPickRole(m.role === 'superadmin' ? 'admin' : m.role)
              setRejecting(false)
            }}
          >
            <div className={`avatar ${m.role}`}>{initials(m.name)}</div>
            <div className="grow">
              <div className="row" style={{ gap: 6 }}>
                <span className="strong truncate">{m.name}</span>
                {m.id === me.id && <span className="chip">{t('you')}</span>}
              </div>
              <div className="tiny truncate">
                {m.house} · {m.phone}
              </div>
            </div>
            <span className={`chip ${roleChip(m.role)}`}>{t(roleKey(m.role))}</span>
          </button>
        ))}

      {tab === 'invites' && (
        <>
          <button
            className="btn btn-primary"
            style={{ marginBottom: 14 }}
            onClick={() => {
              setLastCode('')
              setInviteOpen(true)
            }}
          >
            <Icon name="crown" size={16} /> {t('inviteAdmin')}
          </button>
          {invites.length === 0 ? (
            <div className="empty">
              <span className="em">✉️</span>
              {t('noInvites')}
            </div>
          ) : (
            invites.map((i) => {
              const usedBy = db.members.find((m) => m.id === i.usedBy)
              const expired = i.expiresAt < Date.now()
              return (
                <div key={i.id} className="item">
                  <div
                    className="item-icon"
                    style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
                  >
                    <Icon name="key" size={18} />
                  </div>
                  <div className="grow">
                    <div className="strong" style={{ letterSpacing: 2 }}>
                      {i.code}
                    </div>
                    <div className="tiny">
                      {t(roleKey(i.role))} · {fmtDate(i.createdAt, lang)}
                    </div>
                  </div>
                  <span
                    className={`chip ${
                      i.usedBy ? 'chip-brand' : expired ? 'chip-danger' : 'chip-warn'
                    }`}
                  >
                    {i.usedBy ? `${t('used')}: ${usedBy?.name ?? ''}` : expired ? t('expired') : t('active')}
                  </span>
                </div>
              )
            })
          )}
        </>
      )}

      {/* member decision sheet */}
      <Sheet
        open={!!target}
        onClose={() => {
          setTarget(null)
          setRejecting(false)
        }}
        title={target?.name}
        subtitle={`${target?.house ?? ''} · ${target?.phone ?? ''}`}
      >
        {target && (
          <>
            {rejecting ? (
              <>
                <label className="field">
                  <span>{t('rejectReason')}</span>
                  <textarea
                    className="textarea"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <button className="btn btn-danger" onClick={reject}>
                  <Icon name="x" size={16} /> {t('reject')}
                </button>
                <button
                  className="btn btn-ghost"
                  style={{ marginTop: 8 }}
                  onClick={() => setRejecting(false)}
                >
                  {t('cancel')}
                </button>
              </>
            ) : (
              <>
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
                    {target.status === 'pending' ? t('acceptAs') : t('changeRole')}
                  </span>
                  <div className="btn-row">
                    {ASSIGNABLE_ROLES.map((r) => (
                      <button
                        key={r}
                        className={`btn btn-sm grow ${pickRole === r ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setPickRole(r)}
                      >
                        {t(roleKey(r))}
                      </button>
                    ))}
                  </div>
                </div>

                {target.status === 'pending' ? (
                  <>
                    <button className="btn btn-primary" onClick={accept}>
                      <Icon name="check" size={16} /> {t('accept')} · {t(roleKey(pickRole))}
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{ marginTop: 8 }}
                      onClick={() => setRejecting(true)}
                    >
                      <Icon name="x" size={16} /> {t('reject')}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="btn btn-primary"
                      disabled={pickRole === target.role}
                      onClick={() => {
                        setRole(me.id, target.id, pickRole)
                        toast(
                          t('roleChanged', {
                            name: target.name,
                            role: t(roleKey(pickRole)),
                          }),
                        )
                        setTarget(null)
                      }}
                    >
                      <Icon name="check" size={16} /> {t('save')}
                    </button>
                    {target.id !== me.id && (
                      <button
                        className="btn btn-ghost"
                        style={{ marginTop: 8 }}
                        onClick={() => {
                          setMemberStatus(
                            me.id,
                            target.id,
                            target.status === 'suspended' ? 'active' : 'suspended',
                          )
                          setTarget(null)
                        }}
                      >
                        <Icon name="lock" size={15} />{' '}
                        {t(target.status === 'suspended' ? 'activateMember' : 'suspendMember')}
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}
      </Sheet>

      {/* invite sheet */}
      <Sheet
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title={t('inviteMember')}
        subtitle={t('inviteAdmin')}
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
            {t('role')}
          </span>
          <div className="btn-row">
            {ASSIGNABLE_ROLES.map((r) => (
              <button
                key={r}
                className={`btn btn-sm grow ${inviteRole === r ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setInviteRole(r)}
              >
                {t(roleKey(r))}
              </button>
            ))}
          </div>
        </div>

        {lastCode ? (
          <>
            <div
              className="card center"
              style={{ padding: 20, marginBottom: 12, background: 'var(--brand-soft)', borderColor: 'transparent' }}
            >
              <div className="tiny">{t('inviteCreated')}</div>
              <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: 6, marginTop: 4 }}>
                {lastCode}
              </div>
            </div>
            <button
              className="btn btn-ghost"
              onClick={() => {
                navigator.clipboard?.writeText(lastCode)
                toast(t('copied'))
              }}
            >
              <Icon name="copy" size={15} /> {t('inviteCopy')}
            </button>
            <button
              className="btn btn-primary"
              style={{ marginTop: 8 }}
              onClick={() => setInviteOpen(false)}
            >
              {t('close')}
            </button>
          </>
        ) : (
          <button className="btn btn-primary" onClick={makeInvite}>
            <Icon name="key" size={16} /> {t('inviteCreated')}
          </button>
        )}
      </Sheet>
    </div>
  )
}
