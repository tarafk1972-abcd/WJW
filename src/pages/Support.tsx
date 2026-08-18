import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { SUPERADMIN_EMAIL, closeTicket, openTicket, replyTicket } from '../lib/db'
import { fmtDateTime, timeAgo } from '../lib/format'
import { useApp } from '../lib/store'
import { Icon } from '../ui/Icon'
import { Sheet } from '../ui/Sheet'
import { useToast } from '../ui/Toast'

export default function Support() {
  const { db, me, community, t, lang } = useApp()
  const nav = useNavigate()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [reply, setReply] = useState('')

  const tickets = useMemo(
    () =>
      community
        ? db.tickets.filter(
            (x) => x.communityId === community.id && x.openedBy === me?.id,
          )
        : [],
    [db.tickets, community, me],
  )
  const active = tickets.find((x) => x.id === activeId) ?? null

  if (!me || !community) return null

  const create = () => {
    if (!subject.trim() || !body.trim()) return toast(t('errRequired'), 'err')
    const tk = openTicket(community.id, me.id, subject.trim(), body.trim())
    setSubject('')
    setBody('')
    setOpen(false)
    setActiveId(tk.id)
    toast(t('sendMessage'))
  }

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 6 }}>
        <button className="icon-btn" onClick={() => nav(-1)}>
          <Icon name="chevronLeft" size={18} />
        </button>
        <div className="grow">
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>{t('helpSupport')}</h2>
          <div className="tiny">{SUPERADMIN_EMAIL}</div>
        </div>
      </div>

      <div className="banner banner-info" style={{ marginTop: 12 }}>
        <Icon name="headset" size={17} />
        <span>{t('csHint')}</span>
      </div>

      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        <Icon name="plus" size={16} /> {t('newTicket')}
      </button>

      <div className="section-title">{t('tickets')}</div>
      {tickets.length === 0 ? (
        <div className="empty">
          <span className="em">💬</span>
          {t('noTickets')}
        </div>
      ) : (
        tickets.map((tk) => (
          <button key={tk.id} className="item" onClick={() => setActiveId(tk.id)}>
            <div
              className="item-icon"
              style={{
                background:
                  tk.status === 'answered' ? 'var(--brand-soft)' : 'var(--surface-2)',
                color: tk.status === 'answered' ? 'var(--brand)' : 'var(--text-2)',
              }}
            >
              <Icon name="ticket" size={18} />
            </div>
            <div className="grow">
              <div className="strong truncate">{tk.subject}</div>
              <div className="tiny truncate">
                {tk.messages.length} · {timeAgo(tk.updatedAt, lang)}
              </div>
            </div>
            <span
              className={`chip ${
                tk.status === 'answered'
                  ? 'chip-brand'
                  : tk.status === 'closed'
                    ? ''
                    : 'chip-warn'
              }`}
            >
              {t(
                tk.status === 'answered'
                  ? 'ticketAnswered'
                  : tk.status === 'closed'
                    ? 'ticketClosed'
                    : 'ticketOpen',
              )}
            </span>
          </button>
        ))
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title={t('newTicket')}>
        <label className="field">
          <span>{t('subject')}</span>
          <input
            className="input"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </label>
        <label className="field">
          <span>{t('message')}</span>
          <textarea
            className="textarea"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <button className="btn btn-primary" onClick={create}>
          <Icon name="send" size={16} /> {t('sendMessage')}
        </button>
      </Sheet>

      <Sheet
        open={!!active}
        onClose={() => setActiveId(null)}
        title={active?.subject}
        subtitle={active ? fmtDateTime(active.createdAt, lang) : ''}
      >
        {active && (
          <>
            <div className="col" style={{ gap: 8, marginBottom: 14 }}>
              {active.messages.map((m) => (
                <div
                  key={m.id}
                  className={`msg ${m.from === me.id ? 'mine' : 'theirs'}`}
                >
                  <div className="tiny" style={{ marginBottom: 2 }}>
                    {m.from === me.id ? t('you') : t('roleSuperadmin')} ·{' '}
                    {timeAgo(m.at, lang)}
                  </div>
                  {m.body}
                </div>
              ))}
            </div>
            {active.status !== 'closed' && (
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
                    replyTicket(active.id, me.id, reply.trim())
                    setReply('')
                  }}
                >
                  <Icon name="send" size={16} /> {t('sendMessage')}
                </button>
                <button
                  className="btn btn-ghost"
                  style={{ marginTop: 8 }}
                  onClick={() => {
                    closeTicket(active.id)
                    setActiveId(null)
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
