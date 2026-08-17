import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { ApiError, adminApi, communityApi } from '../lib/api'
import { apiMode, mutate } from '../lib/sync'
import {
  createInvite,
  decideMember,
  renameCommunity,
  inviteLink,
  revokeInvite,
  setMemberStatus,
  setRole,
} from '../lib/db'
import { fmtDate, initials, timeAgo } from '../lib/format'
import { useApp } from '../lib/store'
import { Icon } from '../ui/Icon'
import { QrCode } from '../ui/QrCode'
import { Sheet } from '../ui/Sheet'
import { useToast } from '../ui/Toast'
import { ASSIGNABLE_ROLES, roleChip, roleKey } from '../lib/meta'
import type { Invite, Member, Role } from '../lib/types'

export default function Admin() {
  const { db, me, community, t, lang, isAdmin, plan, reload } = useApp()
  const nav = useNavigate()
  const toast = useToast()
  const [tab, setTab] = useState<'pending' | 'members' | 'invites'>('pending')
  const [target, setTarget] = useState<Member | null>(null)
  const [pickRole, setPickRole] = useState<Exclude<Role, 'superadmin'>>('warga')
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  // ganti nama lingkungan
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteRole, setInviteRole] = useState<Exclude<Role, 'superadmin'>>('admin')
  const [lastCode, setLastCode] = useState('')
  const [shareInvite, setShareInvite] = useState<Invite | null>(null)
  const [inviteDays, setInviteDays] = useState(7)
  const [inviteMax, setInviteMax] = useState<number | null>(null)

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

  const accept = async () => {
    if (!target) return
    const name = target.name
    if (apiMode()) {
      const ok = await mutate(() => adminApi.decide(target.id, 'accept', pickRole))
      if (!ok) return toast(t('errOffline'), 'err')
    } else {
      decideMember(me.id, target.id, 'accept', pickRole)
    }
    toast(t('memberAccepted', { name, role: t(roleKey(pickRole)) }))
    setTarget(null)
  }

  const reject = async () => {
    if (!target) return
    if (apiMode()) {
      await mutate(() => adminApi.decide(target.id, 'reject', 'warga', reason.trim()))
    } else {
      decideMember(me.id, target.id, 'reject', 'warga', reason.trim())
    }
    toast(t('memberRejected', { name: target.name }), 'err')
    setTarget(null)
    setRejecting(false)
    setReason('')
  }

  const makeInvite = async () => {
    if (apiMode()) {
      try {
        const r = await adminApi.createInvite(inviteRole, inviteDays, inviteMax)
        await mutate(async () => r)
        setLastCode(r.invite.code)

        /*
         * Pakai jawaban server apa adanya, jangan mencarinya di cache.
         *
         * `db` pada penutupan ini adalah snapshot dari render sebelum
         * sinkronisasi, jadi undangan yang baru dibuat belum ada di
         * dalamnya. Pencarian itu selalu gagal, panel QR tidak pernah
         * tampil, dan admin hanya melihat kodenya tanpa tanggal berlaku —
         * yang membuat undangan seolah tidak punya masa berlaku sama
         * sekali.
         */
        setShareInvite({
          id: r.invite.id,
          communityId: community.id,
          code: r.invite.code,
          role: r.invite.role as Exclude<Role, 'superadmin'>,
          createdBy: me.id,
          createdAt: Date.now(),
          expiresAt: r.invite.expiresAt,
          usedBy: [],
          maxUses: inviteMax,
          revokedAt: null,
        })
        toast(t('inviteCreated'))
        return
      } catch {
        toast(t('errOffline'), 'err')
        return
      }
    }
    const inv = createInvite(me.id, community.id, inviteRole, {
      days: inviteDays,
      maxUses: inviteMax,
    })
    setLastCode(inv.code)
    setShareInvite(inv)
    toast(t('inviteCreated'))
  }

  return (
    <div className="page">
      <div className="row-between" style={{ marginBottom: 14 }}>
        <div className="grow">
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>{t('navAdmin')}</h2>
          <button
            className="link-btn tiny"
            title={t('renameCommunity')}
            onClick={() => {
              setNewName(community.name)
              setRenaming(true)
            }}
          >
            {community.name} <Icon name="edit" size={11} />
          </button>
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
        <button className="btn btn-sm btn-ghost grow" onClick={() => nav('/app/broadcast')}>
          <Icon name="broadcast" size={14} /> {t('broadcast')}
        </button>
      </div>
      <div className="btn-row" style={{ marginBottom: 14 }}>
        <button className="btn btn-sm btn-ghost grow" onClick={() => nav('/app/cluster-qr')}>
          <Icon name="key" size={14} /> {t('clusterQr')}
        </button>
        <button className="btn btn-sm btn-ghost grow" onClick={() => nav('/app/checkpoints')}>
          <Icon name="shield" size={14} /> {t('checkpointsAdmin')}
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
                <div className="row" style={{ gap: 5, marginTop: 4, flexWrap: 'wrap' }}>
                  <span
                    className={`chip ${m.joinMethod === 'invite' ? 'chip-brand' : 'chip-info'}`}
                  >
                    <Icon
                      name={m.joinMethod === 'invite' ? 'key' : 'search'}
                      size={10}
                    />
                    {t(m.joinMethod === 'invite' ? 'viaInvite' : 'viaSearch')}
                  </span>
                  {m.joinCode && <span className="chip">{m.joinCode}</span>}
                </div>
                {m.joinNote && (
                  <div className="tiny" style={{ marginTop: 4, fontStyle: 'italic' }}>
                    “{m.joinNote}”
                  </div>
                )}
              </div>
              <button
                className="btn btn-sm btn-primary"
                onClick={() => {
                  setTarget(m)
                  // pre-select the role proposed by the invite, if any
                  const inv = m.joinCode
                    ? db.invites.find((i) => i.code === m.joinCode)
                    : undefined
                  setPickRole(inv?.role ?? 'warga')
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
              const expired = i.expiresAt < Date.now()
              const full = i.maxUses !== null && i.usedBy.length >= i.maxUses
              const dead = !!i.revokedAt || expired || full
              return (
                <div key={i.id} className="item">
                  <div
                    className="item-icon"
                    style={{
                      background: dead ? 'var(--surface-2)' : 'var(--brand-soft)',
                      color: dead ? 'var(--text-3)' : 'var(--brand)',
                    }}
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
                    <div className="tiny">
                      {t('inviteUses', { n: i.usedBy.length })}
                      {i.maxUses === null ? ` · ${t('inviteUnlimited')}` : ` / ${i.maxUses}`}
                    </div>
                  </div>
                  <div className="col" style={{ gap: 5 }}>
                    <span
                      className={`chip ${
                        i.revokedAt
                          ? 'chip-danger'
                          : expired || full
                            ? 'chip-warn'
                            : 'chip-brand'
                      }`}
                    >
                      {i.revokedAt
                        ? t('revoked')
                        : expired
                          ? t('expired')
                          : full
                            ? t('used')
                            : t('active')}
                    </span>
                    {!dead && (
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => setShareInvite(i)}
                      >
                        <Icon name="broadcast" size={12} /> {t('shareInvite')}
                      </button>
                    )}
                  </div>
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
        subtitle={
          target
            ? `${target.house} · ${target.phone}${
                target.status === 'pending'
                  ? ` · ${t(
                      target.joinMethod === 'invite' ? 'viaInvite' : 'viaSearch',
                    )}`
                  : ''
              }`
            : ''
        }
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
                <button className="btn btn-danger" onClick={() => void reject()}>
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
                    <button className="btn btn-primary" onClick={() => void accept()}>
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
                        if (apiMode())
                          void mutate(() => adminApi.setRole(target.id, pickRole))
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

      {/* ganti nama lingkungan */}
      <Sheet
        open={renaming}
        onClose={() => setRenaming(false)}
        title={t('renameCommunity')}
      >
        <label className="field">
          <span>{t('communityName')}</span>
          <input
            className="input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="RW 05 Griya Soreang"
          />
          <span className="tiny pw-hint">{t('communityNameHint')}</span>
        </label>
        <button
          className="btn btn-primary"
          onClick={async () => {
            const nama = newName.trim()
            if (!nama) return toast(t('errCommunityName'), 'err')

            if (apiMode()) {
              try {
                await communityApi.rename(nama)
              } catch (e) {
                return toast(
                  t((e instanceof ApiError ? e.code : 'errUnknown') as never),
                  'err',
                )
              }
              await reload()
            } else {
              const r = renameCommunity(me.id, community.id, nama)
              if (!r.ok) return toast(t(r.error as never), 'err')
            }
            setRenaming(false)
            toast(t('communityRenamed'))
          }}
        >
          <Icon name="check" size={16} /> {t('save')}
        </button>
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

        <div className="btn-row" style={{ marginBottom: 13 }}>
          <label className="field grow" style={{ marginBottom: 0 }}>
            <span>{t('validDays')}</span>
            <select
              className="select"
              value={inviteDays}
              onChange={(e) => setInviteDays(Number(e.target.value))}
            >
              {[1, 3, 7, 30].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="field grow" style={{ marginBottom: 0 }}>
            <span>{t('maxUses')}</span>
            <select
              className="select"
              value={inviteMax ?? 0}
              onChange={(e) =>
                setInviteMax(Number(e.target.value) === 0 ? null : Number(e.target.value))
              }
            >
              <option value={0}>{t('inviteUnlimited')}</option>
              {[1, 5, 10, 25].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
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
          <button className="btn btn-primary" onClick={() => void makeInvite()}>
            {/* Tombol ini MEMBUAT undangan; dulu berlabel "Kode undangan
                dibuat", yang berbunyi seperti pemberitahuan. */}
            <Icon name="key" size={16} /> {t('makeInvite')}
          </button>
        )}
      </Sheet>

      {/* share invite: QR + code + link */}
      <Sheet
        open={!!shareInvite}
        onClose={() => setShareInvite(null)}
        title={t('inviteQr')}
        subtitle={shareInvite ? t(roleKey(shareInvite.role)) : ''}
      >
        {shareInvite && (
          <>
            <div
              className="card"
              style={{ padding: 18, textAlign: 'center', marginBottom: 12 }}
            >
              <QrCode value={inviteLink(shareInvite.code)} size={200} />
              <div className="code-display" style={{ marginTop: 14 }}>
                {shareInvite.code}
              </div>
              <div className="tiny" style={{ marginTop: 6 }}>
                {t('inviteValidUntil')} {fmtDate(shareInvite.expiresAt, lang)} ·{' '}
                {t('inviteUses', { n: shareInvite.usedBy.length })}
              </div>
            </div>

            <div className="disclaimer" style={{ marginBottom: 12 }}>
              <Icon name="info" size={15} />
              <span>{t('approvalRequiredInvite')}</span>
            </div>

            <div className="btn-row">
              <button
                className="btn btn-ghost grow"
                onClick={() => {
                  navigator.clipboard?.writeText(shareInvite.code)
                  toast(t('copied'))
                }}
              >
                <Icon name="copy" size={15} /> {t('inviteCopy')}
              </button>
              <button
                className="btn btn-ghost grow"
                onClick={() => {
                  navigator.clipboard?.writeText(inviteLink(shareInvite.code))
                  toast(t('copied'))
                }}
              >
                <Icon name="copy" size={15} /> {t('copyLink')}
              </button>
            </div>
            <button
              className="btn btn-primary"
              style={{ marginTop: 8 }}
              onClick={async () => {
                const text = `${t('appName')} · ${community.name}\n${t('enterCode')}: ${shareInvite.code}\n${inviteLink(shareInvite.code)}`
                if (navigator.share) {
                  try {
                    await navigator.share({ title: community.name, text })
                    return
                  } catch {
                    /* user dismissed */
                  }
                }
                navigator.clipboard?.writeText(text)
                toast(t('copied'))
              }}
            >
              <Icon name="send" size={16} /> {t('shareVia')}
            </button>
            <button
              className="btn btn-ghost"
              style={{ marginTop: 8 }}
              onClick={() => {
                revokeInvite(me.id, shareInvite.id)
                if (apiMode()) void mutate(() => adminApi.revokeInvite(shareInvite.id))
                setShareInvite(null)
                toast(t('revoked'))
              }}
            >
              <Icon name="trash" size={15} /> {t('revoke')}
            </button>
          </>
        )}
      </Sheet>
    </div>
  )
}
