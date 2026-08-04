import { useState } from 'react'
import { respondSafety } from '../lib/db'
import { timeAgo } from '../lib/format'
import { SEVERITY_META } from '../lib/meta'
import { useApp } from '../lib/store'
import { Icon } from './Icon'
import { useToast } from './Toast'
import type { Broadcast } from '../lib/types'

/**
 * Mass-notification card. When the broadcast requires a safety check the
 * resident is asked "Are you safe?" and can answer safe / need help.
 */
export function SafetyCheck({ broadcast }: { broadcast: Broadcast }) {
  const { me, t, lang, isAdmin, db, community } = useApp()
  const toast = useToast()
  const [note, setNote] = useState('')
  const [asking, setAsking] = useState(false)

  if (!me) return null
  const meta = SEVERITY_META[broadcast.severity]
  const mine = broadcast.responses.find((r) => r.memberId === me.id)

  const total = community
    ? db.members.filter((m) => m.communityId === community.id && m.status === 'active')
        .length
    : 0
  const safe = broadcast.responses.filter((r) => r.status === 'safe').length
  const help = broadcast.responses.filter((r) => r.status === 'need_help').length

  const answer = (status: 'safe' | 'need_help') => {
    respondSafety(broadcast.id, me.id, status, note.trim())
    setAsking(false)
    setNote('')
    toast(t(status === 'safe' ? 'markedSafe' : 'markedHelp'), status === 'safe' ? 'ok' : 'err')
  }

  return (
    <div
      className="safety-card"
      style={{ background: meta.bg, borderColor: meta.color + '55' }}
    >
      <div className="row" style={{ gap: 9, marginBottom: 8 }}>
        <Icon name={meta.icon} size={19} color={meta.color} />
        <div className="grow">
          <div className="strong" style={{ fontSize: 15 }}>
            {broadcast.title}
          </div>
          <div className="tiny">
            {t(meta.key)} · {timeAgo(broadcast.createdAt, lang)}
          </div>
        </div>
      </div>

      {broadcast.body && (
        <p style={{ fontSize: 13.5, lineHeight: 1.5 }}>{broadcast.body}</p>
      )}

      {broadcast.instruction && (
        <div
          className="card card-tight"
          style={{ marginTop: 10, background: 'rgba(0,0,0,.28)', borderColor: 'transparent' }}
        >
          <div className="tiny strong" style={{ marginBottom: 2 }}>
            <Icon name="handRaised" size={12} /> {t('instruction')}
          </div>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{broadcast.instruction}</div>
        </div>
      )}

      {broadcast.requireSafetyCheck && (
        <div style={{ marginTop: 12 }}>
          {mine ? (
            <div className="row" style={{ gap: 8 }}>
              <span
                className={`chip ${mine.status === 'safe' ? 'chip-brand' : 'chip-danger'}`}
              >
                <Icon name={mine.status === 'safe' ? 'check' : 'handRaised'} size={12} />
                {t(mine.status === 'safe' ? 'imSafe' : 'needHelp')}
              </span>
              {mine.note && <span className="tiny truncate">{mine.note}</span>}
            </div>
          ) : asking ? (
            <>
              <input
                className="input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('note')}
                style={{ marginBottom: 8 }}
              />
              <div className="btn-row">
                <button className="btn btn-sm btn-primary grow" onClick={() => answer('safe')}>
                  <Icon name="check" size={14} /> {t('imSafe')}
                </button>
                <button className="btn btn-sm btn-danger grow" onClick={() => answer('need_help')}>
                  <Icon name="handRaised" size={14} /> {t('needHelp')}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="strong" style={{ fontSize: 13.5, marginBottom: 8 }}>
                {t('areYouSafe')}
              </div>
              <div className="btn-row">
                <button className="btn btn-sm btn-primary grow" onClick={() => answer('safe')}>
                  <Icon name="check" size={14} /> {t('imSafe')}
                </button>
                <button className="btn btn-sm btn-ghost grow" onClick={() => setAsking(true)}>
                  <Icon name="handRaised" size={14} /> {t('needHelp')}
                </button>
              </div>
            </>
          )}

          {isAdmin && (
            <div className="tiny" style={{ marginTop: 10 }}>
              <Icon name="users" size={11} />{' '}
              {t('safetyResponses', {
                safe,
                help,
                pending: Math.max(0, total - safe - help),
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
