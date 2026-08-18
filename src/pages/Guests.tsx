import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { addGuest, checkoutGuest } from '../lib/db'
import { fmtDateTime, fmtTime } from '../lib/format'
import { useApp } from '../lib/store'
import { Icon } from '../ui/Icon'
import { Sheet } from '../ui/Sheet'
import { useToast } from '../ui/Toast'

export default function Guests() {
  const { db, me, community, t, lang, isAdmin, isSatpam } = useApp()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'inside' | 'all'>('inside')

  const [name, setName] = useState('')
  const [purpose, setPurpose] = useState('')
  const [host, setHost] = useState('')
  const [plate, setPlate] = useState('')
  const [idCard, setIdCard] = useState('')

  useEffect(() => {
    if (params.get('new')) {
      setOpen(true)
      params.delete('new')
      setParams(params, { replace: true })
    }
  }, [params, setParams])

  const list = useMemo(() => {
    if (!community) return []
    return db.guests
      .filter((g) => g.communityId === community.id)
      .filter((g) => (tab === 'inside' ? !g.checkOut : true))
  }, [db.guests, community, tab])

  if (!me || !community) return null
  const canWrite = isAdmin || isSatpam

  const submit = () => {
    if (!name.trim()) return
    addGuest({
      communityId: community.id,
      name: name.trim(),
      purpose: purpose.trim(),
      host: host.trim(),
      plate: plate.trim().toUpperCase(),
      idCard: idCard.trim(),
      recordedBy: me.id,
    })
    setName('')
    setPurpose('')
    setHost('')
    setPlate('')
    setIdCard('')
    setOpen(false)
    toast(t('checkIn'))
  }

  return (
    <div className="page">
      <div className="row-between" style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800 }}>{t('guests')}</h2>
        {canWrite && (
          <button className="btn btn-sm btn-primary" onClick={() => setOpen(true)}>
            <Icon name="plus" size={14} /> {t('newGuest')}
          </button>
        )}
      </div>

      <div className="tabs" style={{ marginBottom: 14 }}>
        <button className={tab === 'inside' ? 'on' : ''} onClick={() => setTab('inside')}>
          {t('stillInside')}
        </button>
        <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>
          {t('all')}
        </button>
      </div>

      {list.length === 0 ? (
        <div className="empty">
          <span className="em">🚪</span>
          {t('noGuests')}
        </div>
      ) : (
        list.map((g) => (
          <div key={g.id} className="item">
            <div
              className="item-icon"
              style={{
                background: g.checkOut ? 'var(--surface-2)' : 'var(--info-soft)',
                color: g.checkOut ? 'var(--text-3)' : 'var(--info)',
              }}
            >
              <Icon name="user" size={19} />
            </div>
            <div className="grow">
              <div className="row" style={{ gap: 6 }}>
                <span className="strong truncate">{g.name}</span>
                {!g.checkOut && <span className="chip chip-info">{t('stillInside')}</span>}
              </div>
              <div className="muted truncate" style={{ fontSize: 13 }}>
                {g.purpose || '-'} {g.host && `→ ${g.host}`}
              </div>
              <div className="tiny truncate">
                {g.plate && `🚗 ${g.plate} · `}
                {fmtDateTime(g.checkIn, lang)}
                {g.checkOut && ` → ${fmtTime(g.checkOut, lang)}`}
              </div>
            </div>
            {canWrite && !g.checkOut && (
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  checkoutGuest(me.id, g.id)
                  toast(t('checkOut'))
                }}
              >
                {t('doCheckOut')}
              </button>
            )}
          </div>
        ))
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title={t('newGuest')}>
        <label className="field">
          <span>{t('guestName')} *</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>{t('purpose')}</span>
          <input
            className="input"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
          />
        </label>
        <label className="field">
          <span>{t('hostHouse')}</span>
          <input className="input" value={host} onChange={(e) => setHost(e.target.value)} />
        </label>
        <label className="field">
          <span>{t('plate')}</span>
          <input
            className="input"
            value={plate}
            onChange={(e) => setPlate(e.target.value)}
            style={{ textTransform: 'uppercase' }}
          />
        </label>
        <label className="field">
          <span>{t('idCard')}</span>
          <input className="input" value={idCard} onChange={(e) => setIdCard(e.target.value)} />
        </label>
        <button className="btn btn-primary" onClick={submit}>
          <Icon name="check" size={16} /> {t('checkIn')}
        </button>
      </Sheet>
    </div>
  )
}
