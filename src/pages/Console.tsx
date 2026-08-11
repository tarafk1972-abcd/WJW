import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { billingApi, type InvoiceDto } from '../lib/api'
import { apiMode } from '../lib/sync'
import {
  closeTicket,
  extendTrial,
  planState,
  replyTicket,
  setCommunityPlan,
  setRole,
  verifyPayment,
} from '../lib/db'
import { fmtDate, fmtDateTime, fmtMoney, initials, timeAgo } from '../lib/format'
import { useApp } from '../lib/store'
import { Icon } from '../ui/Icon'
import { QrisUpload } from '../ui/QrisUpload'
import { Sheet } from '../ui/Sheet'
import { useToast } from '../ui/Toast'
import { roleChip, roleKey } from '../lib/meta'
import type { Community, Ticket } from '../lib/types'

type Tab = 'overview' | 'communities' | 'payments' | 'tickets' | 'audit'

export default function Console() {
  const { db, me, t, lang, signOut, isSuperadmin } = useApp()
  const nav = useNavigate()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('overview')
  const [detail, setDetail] = useState<Community | null>(null)
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [reply, setReply] = useState('')
  const [pendingBills, setPendingBills] = useState<
    (InvoiceDto & { communityName: string; memberName: string; memberEmail: string })[]
  >([])

  const loadBills = useCallback(async () => {
    if (!apiMode()) return
    try {
      const r = await billingApi.pending()
      setPendingBills(r.invoices)
    } catch {
      setPendingBills([])
    }
  }, [])

  useEffect(() => {
    void loadBills()
  }, [loadBills])

  useEffect(() => {
    if (!me || me.role !== 'superadmin') nav('/', { replace: true })
  }, [me, nav])

  const stats = useMemo(() => {
    const states = db.communities.map((c) => planState(c).status)
    const verified = db.payments.filter((p) => p.status === 'verified')
    return {
      total: db.communities.length,
      active: states.filter((s) => s === 'active').length,
      trial: states.filter((s) => s === 'trial').length,
      expired: states.filter((s) => s === 'expired' || s === 'suspended').length,
      users: db.members.filter((m) => m.role !== 'superadmin').length,
      admins: db.members.filter((m) => m.role === 'admin').length,
      revenue: verified.reduce((s, p) => s + p.amount, 0),
      pendingPayments: db.payments.filter((p) => p.status === 'pending').length,
      openTickets: db.tickets.filter((x) => x.status !== 'closed').length,
    }
  }, [db])

  if (!me || !isSuperadmin) return null

  const liveTicket = ticket ? db.tickets.find((x) => x.id === ticket.id) ?? ticket : null
  const liveDetail = detail
    ? db.communities.find((c) => c.id === detail.id) ?? detail
    : null

  return (
    <div className="shell">
      <div className="topbar">
        <div
          className="brand-mark"
          style={{ background: 'linear-gradient(135deg,#a371f7,#7c3aed)', color: '#fff' }}
        >
          <Icon name="crown" size={18} />
        </div>
        <div className="grow">
          <h1>{t('superadminConsole')}</h1>
          <div className="sub">{me.email}</div>
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
        <div className="tabs" style={{ marginBottom: 16 }}>
          {(
            [
              ['overview', t('overview')],
              ['communities', t('communities')],
              ['payments', `${t('payments')}${stats.pendingPayments ? ` (${stats.pendingPayments})` : ''}`],
              ['tickets', `${t('tickets')}${stats.openTickets ? ` (${stats.openTickets})` : ''}`],
              ['audit', t('auditLog')],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <>
            <div className="stat-grid">
              <div className="stat">
                <div className="n">{stats.total}</div>
                <div className="l">{t('communities')}</div>
              </div>
              <div className="stat">
                <div className="n" style={{ color: 'var(--brand)' }}>
                  {stats.active}
                </div>
                <div className="l">{t('activeCommunities')}</div>
              </div>
              <div className="stat">
                <div className="n" style={{ color: 'var(--warn)' }}>
                  {stats.trial}
                </div>
                <div className="l">{t('trialCommunities')}</div>
              </div>
              <div className="stat">
                <div className="n" style={{ color: 'var(--danger)' }}>
                  {stats.expired}
                </div>
                <div className="l">{t('expiredCommunities')}</div>
              </div>
              <div className="stat">
                <div className="n">{stats.users}</div>
                <div className="l">{t('totalUsers')}</div>
              </div>
              <div className="stat">
                <div className="n" style={{ color: 'var(--purple)' }}>
                  {stats.admins}
                </div>
                <div className="l">{t('admins')}</div>
              </div>
            </div>

            <div className="card" style={{ marginTop: 12 }}>
              <div className="row-between">
                <div>
                  <div className="tiny">{t('revenueSim')}</div>
                  <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-0.5px' }}>
                    {fmtMoney(stats.revenue, lang)}
                  </div>
                </div>
                <Icon name="chart" size={30} color="var(--brand)" />
              </div>
            </div>

            <div className="section-title">{t('admins')}</div>
            {db.members
              .filter((m) => m.role === 'admin')
              .map((m) => {
                const c = db.communities.find((x) => x.id === m.communityId)
                return (
                  <div key={m.id} className="item">
                    <div className="avatar admin">{initials(m.name)}</div>
                    <div className="grow">
                      <div className="strong truncate">{m.name}</div>
                      <div className="tiny truncate">
                        {c?.name} · {m.email}
                      </div>
                    </div>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => {
                        setRole(me.id, m.id, 'warga')
                        toast(t('roleChanged', { name: m.name, role: t('roleWarga') }))
                      }}
                    >
                      {t('roleWarga')}
                    </button>
                  </div>
                )
              })}
            {db.members.filter((m) => m.role === 'admin').length === 0 && (
              <div className="empty">
                <span className="em">👑</span>
                {t('none')}
              </div>
            )}
          </>
        )}

        {tab === 'communities' &&
          (db.communities.length === 0 ? (
            <div className="empty">
              <span className="em">🏘️</span>
              {t('none')}
            </div>
          ) : (
            db.communities.map((c) => {
              const st = planState(c)
              const count = db.members.filter((m) => m.communityId === c.id).length
              return (
                <button key={c.id} className="item" onClick={() => setDetail(c)}>
                  <div
                    className="item-icon"
                    style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
                  >
                    <Icon name="building" size={19} />
                  </div>
                  <div className="grow">
                    <div className="strong truncate">{c.name}</div>
                    <div className="tiny truncate">
                      {c.city || '-'} · {count} {t('members')}
                    </div>
                  </div>
                  <span
                    className={`chip ${
                      st.status === 'active'
                        ? 'chip-brand'
                        : st.status === 'trial'
                          ? 'chip-warn'
                          : 'chip-danger'
                    }`}
                  >
                    {st.status === 'trial'
                      ? `${st.daysLeft}d`
                      : t(
                          st.status === 'active'
                            ? 'active'
                            : st.status === 'suspended'
                              ? 'suspended'
                              : 'expired',
                        )}
                  </span>
                </button>
              )
            })
          ))}

        {tab === 'payments' && apiMode() && (
          <>
            <QrisUpload />

            <div className="section-title">
              {t('verifyPayments')}
              {pendingBills.length > 0 && (
                <span className="chip chip-warn">{pendingBills.length}</span>
              )}
            </div>
            {pendingBills.length === 0 ? (
              <div className="empty">
                <span className="em">✅</span>
                {t('noPendingPayments')}
              </div>
            ) : (
              pendingBills.map((b) => (
                <div key={b.id} className="item">
                  <div
                    className="item-icon"
                    style={{ background: 'var(--info-soft)', color: 'var(--info)' }}
                  >
                    <Icon name="credit" size={18} />
                  </div>
                  <div className="grow">
                    <div className="strong truncate">
                      {fmtMoney(b.amount, lang)} · {b.communityName}
                    </div>
                    <div className="tiny truncate">
                      {b.memberName} · {b.memberEmail}
                    </div>
                    <div className="tiny">
                      {b.invoiceNo} · {t('refNumber')}: {b.reference}
                    </div>
                  </div>
                  <div className="col" style={{ gap: 5 }}>
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={async () => {
                        await billingApi.verify(b.id, true)
                        await loadBills()
                        toast(t('paymentApproved'))
                      }}
                    >
                      {t('approve')}
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={async () => {
                        const note = prompt(t('rejectReason')) ?? ''
                        await billingApi.verify(b.id, false, note)
                        await loadBills()
                        toast(t('paymentRejected'), 'err')
                      }}
                    >
                      {t('rejectClaim')}
                    </button>
                  </div>
                </div>
              ))
            )}
          </>
        )}

        {tab === 'payments' && !apiMode() &&
          (db.payments.length === 0 ? (
            <div className="empty">
              <span className="em">🧾</span>
              {t('noPayments')}
            </div>
          ) : (
            db.payments.map((p) => {
              const c = db.communities.find((x) => x.id === p.communityId)
              return (
                <div key={p.id} className="item">
                  <div
                    className="item-icon"
                    style={{
                      background:
                        p.status === 'verified'
                          ? 'var(--brand-soft)'
                          : p.status === 'rejected'
                            ? 'var(--danger-soft)'
                            : 'var(--warn-soft)',
                      color:
                        p.status === 'verified'
                          ? 'var(--brand)'
                          : p.status === 'rejected'
                            ? 'var(--danger)'
                            : 'var(--warn)',
                    }}
                  >
                    <Icon name="credit" size={18} />
                  </div>
                  <div className="grow">
                    <div className="strong truncate">
                      {fmtMoney(p.amount, lang)} · {c?.name}
                    </div>
                    <div className="tiny truncate">
                      {p.method} · {p.reference}
                    </div>
                    <div className="tiny">{fmtDateTime(p.createdAt, lang)}</div>
                  </div>
                  {p.status === 'pending' ? (
                    <div className="col" style={{ gap: 5 }}>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => {
                          verifyPayment(me.id, p.id, true)
                          toast(t('paymentVerified'))
                        }}
                      >
                        {t('verifyPayment')}
                      </button>
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => verifyPayment(me.id, p.id, false)}
                      >
                        {t('rejectPayment')}
                      </button>
                    </div>
                  ) : (
                    <span
                      className={`chip ${p.status === 'verified' ? 'chip-brand' : 'chip-danger'}`}
                    >
                      {t(p.status === 'verified' ? 'active' : 'rejected')}
                    </span>
                  )}
                </div>
              )
            })
          ))}

        {tab === 'tickets' &&
          (db.tickets.length === 0 ? (
            <div className="empty">
              <span className="em">💬</span>
              {t('noTickets')}
            </div>
          ) : (
            db.tickets.map((tk) => {
              const c = db.communities.find((x) => x.id === tk.communityId)
              const opener = db.members.find((m) => m.id === tk.openedBy)
              return (
                <button
                  key={tk.id}
                  className="item"
                  onClick={() => {
                    setTicket(tk)
                    setReply('')
                  }}
                >
                  <div
                    className="item-icon"
                    style={{
                      background: tk.status === 'open' ? 'var(--warn-soft)' : 'var(--surface-2)',
                      color: tk.status === 'open' ? 'var(--warn)' : 'var(--text-2)',
                    }}
                  >
                    <Icon name="ticket" size={18} />
                  </div>
                  <div className="grow">
                    <div className="strong truncate">{tk.subject}</div>
                    <div className="tiny truncate">
                      {opener?.name} · {c?.name}
                    </div>
                    <div className="tiny">{timeAgo(tk.updatedAt, lang)}</div>
                  </div>
                  <span
                    className={`chip ${
                      tk.status === 'open'
                        ? 'chip-warn'
                        : tk.status === 'answered'
                          ? 'chip-brand'
                          : ''
                    }`}
                  >
                    {t(
                      tk.status === 'open'
                        ? 'ticketOpen'
                        : tk.status === 'answered'
                          ? 'ticketAnswered'
                          : 'ticketClosed',
                    )}
                  </span>
                </button>
              )
            })
          ))}

        {tab === 'audit' &&
          (db.audit.length === 0 ? (
            <div className="empty">
              <span className="em">📜</span>
              {t('none')}
            </div>
          ) : (
            db.audit.slice(0, 80).map((a) => {
              const actor = db.members.find((m) => m.id === a.actorId)
              const c = db.communities.find((x) => x.id === a.communityId)
              return (
                <div key={a.id} className="item">
                  <div
                    className="item-icon"
                    style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
                  >
                    <Icon name="clock" size={17} />
                  </div>
                  <div className="grow">
                    <div className="strong truncate" style={{ fontSize: 13.5 }}>
                      {a.action}
                    </div>
                    <div className="tiny truncate">{a.detail}</div>
                    <div className="tiny truncate">
                      {actor?.name ?? a.actorId} · {c?.name ?? '-'} ·{' '}
                      {timeAgo(a.at, lang)}
                    </div>
                  </div>
                </div>
              )
            })
          ))}
      </div>

      {/* community detail */}
      <Sheet
        open={!!liveDetail}
        onClose={() => setDetail(null)}
        title={liveDetail?.name}
        subtitle={`${liveDetail?.address ?? ''} ${liveDetail?.city ?? ''}`}
      >
        {liveDetail && (
          <>
            <div className="card card-tight" style={{ marginBottom: 12 }}>
              <div className="row-between">
                <span className="muted">{t('billing')}</span>
                <span className="strong">{planState(liveDetail).status}</span>
              </div>
              <div className="divider" />
              <div className="row-between">
                <span className="muted">{t('trial')}</span>
                <span className="strong">{fmtDate(liveDetail.trialEndsAt, lang)}</span>
              </div>
              {liveDetail.paidUntil && (
                <>
                  <div className="divider" />
                  <div className="row-between">
                    <span className="muted">{t('paidUntil')}</span>
                    <span className="strong">{fmtDate(liveDetail.paidUntil, lang)}</span>
                  </div>
                </>
              )}
              <div className="divider" />
              <div className="row-between">
                <span className="muted">{t('map')}</span>
                <span className="strong">
                  {liveDetail.area.length >= 3
                    ? t('areaPoints', { n: liveDetail.area.length })
                    : t('none')}
                </span>
              </div>
            </div>

            <div className="section-title" style={{ marginTop: 4 }}>
              {t('members')}
            </div>
            {db.members
              .filter((m) => m.communityId === liveDetail.id)
              .map((m) => (
                <div key={m.id} className="item">
                  <div className={`avatar ${m.role}`}>{initials(m.name)}</div>
                  <div className="grow">
                    <div className="strong truncate">{m.name}</div>
                    <div className="tiny truncate">{m.email}</div>
                  </div>
                  <span className={`chip ${roleChip(m.role)}`}>{t(roleKey(m.role))}</span>
                </div>
              ))}

            <div className="btn-row" style={{ marginTop: 14 }}>
              <button
                className="btn btn-ghost btn-sm grow"
                onClick={() => {
                  extendTrial(me.id, liveDetail.id, 14)
                  toast(t('extendTrial'))
                }}
              >
                <Icon name="gift" size={14} /> {t('extendTrial')}
              </button>
              <button
                className="btn btn-ghost btn-sm grow"
                onClick={() =>
                  setCommunityPlan(
                    me.id,
                    liveDetail.id,
                    liveDetail.plan === 'suspended' ? 'trial' : 'suspended',
                  )
                }
              >
                <Icon name="lock" size={14} />{' '}
                {t(
                  liveDetail.plan === 'suspended'
                    ? 'activateCommunity'
                    : 'suspendCommunity',
                )}
              </button>
            </div>
          </>
        )}
      </Sheet>

      {/* ticket detail */}
      <Sheet
        open={!!liveTicket}
        onClose={() => setTicket(null)}
        title={liveTicket?.subject}
        subtitle={liveTicket ? fmtDateTime(liveTicket.createdAt, lang) : ''}
      >
        {liveTicket && (
          <>
            <div className="col" style={{ gap: 8, marginBottom: 14 }}>
              {liveTicket.messages.map((m) => {
                const from = db.members.find((x) => x.id === m.from)
                return (
                  <div
                    key={m.id}
                    className={`msg ${m.from === me.id ? 'mine' : 'theirs'}`}
                  >
                    <div className="tiny" style={{ marginBottom: 2 }}>
                      {from?.name ?? m.from} · {timeAgo(m.at, lang)}
                    </div>
                    {m.body}
                  </div>
                )
              })}
            </div>
            {liveTicket.status !== 'closed' && (
              <>
                <label className="field">
                  <span>{t('reply')}</span>
                  <textarea
                    className="textarea"
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                  />
                </label>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    if (!reply.trim()) return
                    replyTicket(liveTicket.id, me.id, reply.trim())
                    setReply('')
                    toast(t('sendMessage'))
                  }}
                >
                  <Icon name="send" size={16} /> {t('reply')}
                </button>
                <button
                  className="btn btn-ghost"
                  style={{ marginTop: 8 }}
                  onClick={() => {
                    closeTicket(liveTicket.id)
                    setTicket(null)
                  }}
                >
                  {t('closeTicket')}
                </button>
              </>
            )}
          </>
        )}
      </Sheet>
    </div>
  )
}
