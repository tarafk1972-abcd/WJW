import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { deleteBroadcast, sendBroadcast } from '../lib/db'
import { fmtDateTime } from '../lib/format'
import { SEVERITY_META } from '../lib/meta'
import { useApp } from '../lib/store'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import type { Severity } from '../lib/types'

const SEVERITIES: Severity[] = ['info', 'warning', 'critical']

/** Admin-only mass notification composer + history with safety-check tallies. */
export default function BroadcastPage() {
  const { db, me, community, t, lang, isAdmin } = useApp()
  const nav = useNavigate()
  const toast = useToast()
  const [severity, setSeverity] = useState<Severity>('warning')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [instruction, setInstruction] = useState('')
  const [check, setCheck] = useState(true)

  const list = useMemo(
    () => (community ? db.broadcasts.filter((b) => b.communityId === community.id) : []),
    [db.broadcasts, community],
  )

  const activeMembers = useMemo(
    () =>
      community
        ? db.members.filter((m) => m.communityId === community.id && m.status === 'active')
            .length
        : 0,
    [db.members, community],
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

  const send = () => {
    if (!title.trim()) return toast(t('errRequired'), 'err')
    sendBroadcast({
      communityId: community.id,
      authorId: me.id,
      severity,
      title: title.trim(),
      body: body.trim(),
      instruction: instruction.trim(),
      requireSafetyCheck: check,
    })
    setTitle('')
    setBody('')
    setInstruction('')
    toast(t('broadcastSent'))
  }

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="icon-btn" onClick={() => nav(-1)}>
          <Icon name="chevronLeft" size={18} />
        </button>
        <div className="grow">
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>{t('broadcast')}</h2>
          <div className="tiny">
            {activeMembers} {t('members')}
          </div>
        </div>
      </div>

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
          {t('severity')}
        </span>
        <div className="severity-bar">
          {SEVERITIES.map((s) => {
            const m = SEVERITY_META[s]
            const on = severity === s
            return (
              <button
                key={s}
                onClick={() => setSeverity(s)}
                style={
                  on
                    ? { borderColor: m.color, background: m.bg, color: m.color }
                    : undefined
                }
              >
                <Icon name={m.icon} size={17} />
                {t(m.key)}
              </button>
            )
          })}
        </div>
      </div>

      <label className="field">
        <span>{t('title')} *</span>
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Kebakaran di Blok C"
        />
      </label>
      <label className="field">
        <span>{t('body')}</span>
        <textarea
          className="textarea"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <label className="field">
        <span>{t('instruction')}</span>
        <input
          className="input"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder={t('instructionHint')}
        />
      </label>

      <label
        className="row"
        style={{
          marginBottom: 14,
          padding: '11px 13px',
          background: check ? 'var(--brand-soft)' : 'var(--bg-2)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        <input type="checkbox" checked={check} onChange={(e) => setCheck(e.target.checked)} />
        <div className="grow">
          <div className="strong" style={{ fontSize: 13.5 }}>
            <Icon name="handRaised" size={13} /> {t('requireSafetyCheck')}
          </div>
          <div className="tiny">{t('areYouSafe')}</div>
        </div>
      </label>

      <button className="btn btn-primary" onClick={send}>
        <Icon name="broadcast" size={16} /> {t('newBroadcast')}
      </button>

      <div className="section-title">{t('broadcasts')}</div>
      {list.length === 0 ? (
        <div className="empty">
          <span className="em">📡</span>
          {t('noBroadcasts')}
        </div>
      ) : (
        list.map((b) => {
          const m = SEVERITY_META[b.severity]
          const safe = b.responses.filter((r) => r.status === 'safe').length
          const help = b.responses.filter((r) => r.status === 'need_help').length
          return (
            <div key={b.id} className="item">
              <div className="item-icon" style={{ background: m.bg, color: m.color }}>
                <Icon name={m.icon} size={19} />
              </div>
              <div className="grow">
                <div className="strong truncate">{b.title}</div>
                {b.instruction && (
                  <div className="muted truncate" style={{ fontSize: 13 }}>
                    {b.instruction}
                  </div>
                )}
                <div className="tiny">{fmtDateTime(b.createdAt, lang)}</div>
                {b.requireSafetyCheck && (
                  <div className="row" style={{ gap: 6, marginTop: 5 }}>
                    <span className="chip chip-brand">
                      <Icon name="check" size={11} /> {safe}
                    </span>
                    {help > 0 && (
                      <span className="chip chip-danger">
                        <Icon name="handRaised" size={11} /> {help}
                      </span>
                    )}
                    <span className="chip">
                      {Math.max(0, activeMembers - safe - help)} {t('notYetResponded')}
                    </span>
                  </div>
                )}
                {help > 0 && (
                  <div className="tiny" style={{ marginTop: 4, color: 'var(--danger)' }}>
                    {b.responses
                      .filter((r) => r.status === 'need_help')
                      .map((r) => db.members.find((x) => x.id === r.memberId)?.name)
                      .filter(Boolean)
                      .join(', ')}
                  </div>
                )}
              </div>
              <button
                className="icon-btn"
                style={{ width: 30, height: 30 }}
                onClick={() => deleteBroadcast(b.id)}
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          )
        })
      )}
    </div>
  )
}
