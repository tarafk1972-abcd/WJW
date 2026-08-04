import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  addContact,
  alertAudience,
  personalContacts,
  removeContact,
  setContactVerified,
} from '../lib/db'
import { useApp } from '../lib/store'
import { Icon } from '../ui/Icon'
import { Sheet } from '../ui/Sheet'
import { useToast } from '../ui/Toast'
import { KIND_META } from './Panic'
import type { ContactKind } from '../lib/types'

const PERSONAL: ContactKind[] = ['family', 'friend']
const COMMUNITY: ContactKind[] = ['responder', 'guard', 'volunteer']

/**
 * "My safety network" — the list of people who receive this member's alerts.
 * Family/friends are personal; responders/guards/volunteers are community-wide
 * and require admin verification before they are included.
 */
export default function Network() {
  const { db, me, community, t, isAdmin } = useApp()
  const nav = useNavigate()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [kind, setKind] = useState<ContactKind>('family')

  const mine = useMemo(
    () => (me ? personalContacts(db, me.id) : []),
    [db, me],
  )
  const communityContacts = useMemo(
    () =>
      community
        ? db.contacts.filter(
            (c) => c.ownerId === null && c.communityId === community.id,
          )
        : [],
    [db.contacts, community],
  )
  const audience = useMemo(() => (me ? alertAudience(db, me) : []), [db, me])

  if (!me || !community) return null

  const save = () => {
    if (!name.trim() || !phone.trim()) return toast(t('errRequired'), 'err')
    const isCommunity = COMMUNITY.includes(kind)
    addContact({
      ownerId: isCommunity ? null : me.id,
      communityId: community.id,
      name: name.trim(),
      phone: phone.trim(),
      kind,
      // personal contacts are trusted by definition; community roles need admin sign-off
      verified: isCommunity ? isAdmin : true,
      memberId: null,
    })
    setName('')
    setPhone('')
    setOpen(false)
    toast(t('addContact'))
  }

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="icon-btn" onClick={() => nav(-1)}>
          <Icon name="chevronLeft" size={18} />
        </button>
        <div className="grow">
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>{t('myNetwork')}</h2>
          <div className="tiny">
            {t('willReceive')}: {audience.length}
          </div>
        </div>
      </div>

      <div className="disclaimer" style={{ marginBottom: 14 }}>
        <Icon name="info" size={15} />
        <span>{t('noPolice')}</span>
      </div>

      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        <Icon name="plus" size={16} /> {t('addContact')}
      </button>

      <div className="section-title">
        {t('family')} & {t('friend')}
      </div>
      {mine.length === 0 ? (
        <div className="empty">
          <span className="em">👨‍👩‍👧</span>
          {t('noContacts')}
        </div>
      ) : (
        mine.map((c) => {
          const km = KIND_META[c.kind]
          return (
            <div key={c.id} className="recip">
              <span className="who" style={{ background: km.bg }}>
                {km.emoji}
              </span>
              <div className="grow">
                <div className="strong truncate" style={{ fontSize: 13.5 }}>
                  {c.name}
                </div>
                <div className="tiny">
                  {t(km.key)} · {c.phone}
                </div>
              </div>
              <a className="icon-btn" href={`tel:${c.phone}`} style={{ width: 32, height: 32 }}>
                <Icon name="phone" size={15} />
              </a>
              <button
                className="icon-btn"
                style={{ width: 32, height: 32 }}
                onClick={() => removeContact(c.id)}
              >
                <Icon name="trash" size={15} />
              </button>
            </div>
          )
        })
      )}

      <div className="section-title">{t('communityResponders')}</div>
      <p className="tiny" style={{ marginBottom: 10 }}>
        {t('verifyHint')}
      </p>

      {/* guards & admins are responders by role */}
      {db.members
        .filter(
          (m) =>
            m.communityId === community.id &&
            m.status === 'active' &&
            m.id !== me.id &&
            (m.role === 'satpam' || m.role === 'admin'),
        )
        .map((m) => {
          const km = KIND_META[m.role === 'satpam' ? 'guard' : 'responder']
          return (
            <div key={m.id} className="recip">
              <span className="who" style={{ background: km.bg }}>
                {km.emoji}
              </span>
              <div className="grow">
                <div className="strong truncate" style={{ fontSize: 13.5 }}>
                  {m.name}
                </div>
                <div className="tiny">
                  {t(km.key)} · {m.phone}
                </div>
              </div>
              <span className="chip chip-brand">{t('verified')}</span>
            </div>
          )
        })}

      {communityContacts.map((c) => {
        const km = KIND_META[c.kind]
        return (
          <div key={c.id} className="recip">
            <span className="who" style={{ background: km.bg }}>
              {km.emoji}
            </span>
            <div className="grow">
              <div className="strong truncate" style={{ fontSize: 13.5 }}>
                {c.name}
              </div>
              <div className="tiny">
                {t(km.key)} · {c.phone}
              </div>
            </div>
            {isAdmin ? (
              <button
                className={`chip ${c.verified ? 'chip-brand' : 'chip-warn'}`}
                onClick={() => setContactVerified(me.id, c.id, !c.verified)}
              >
                {t(c.verified ? 'verified' : 'verify')}
              </button>
            ) : (
              <span className={`chip ${c.verified ? 'chip-brand' : ''}`}>
                {t(c.verified ? 'verified' : 'unverified')}
              </span>
            )}
            {isAdmin && (
              <button
                className="icon-btn"
                style={{ width: 32, height: 32 }}
                onClick={() => removeContact(c.id)}
              >
                <Icon name="trash" size={15} />
              </button>
            )}
          </div>
        )
      })}

      <Sheet open={open} onClose={() => setOpen(false)} title={t('addContact')}>
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
            {t('contactKind')}
          </span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
            {[...PERSONAL, ...COMMUNITY].map((k) => {
              const km = KIND_META[k]
              return (
                <button
                  key={k}
                  className="quick"
                  onClick={() => setKind(k)}
                  style={
                    kind === k
                      ? { borderColor: km.color, background: km.bg, color: km.color }
                      : undefined
                  }
                >
                  <span style={{ fontSize: 20 }}>{km.emoji}</span>
                  {t(km.key)}
                </button>
              )
            })}
          </div>
        </div>

        <label className="field">
          <span>{t('contactName2')} *</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>{t('phone')} *</span>
          <input
            className="input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
          />
        </label>

        {COMMUNITY.includes(kind) && !isAdmin && (
          <div className="banner banner-warn">
            <Icon name="info" size={16} />
            <span>{t('verifyHint')}</span>
          </div>
        )}

        <button className="btn btn-primary" onClick={save}>
          <Icon name="check" size={16} /> {t('save')}
        </button>
      </Sheet>
    </div>
  )
}
