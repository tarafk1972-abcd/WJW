import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PRICE_MONTHLY, PRICE_YEARLY, submitPayment } from '../lib/db'
import { fmtDate, fmtDateTime, fmtMoney } from '../lib/format'
import { useApp } from '../lib/store'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/Toast'

const METHODS = ['Transfer Bank BCA', 'Transfer Bank Mandiri', 'QRIS', 'GoPay', 'OVO']

export default function Billing() {
  const { db, me, community, t, lang, plan, isAdmin } = useApp()
  const nav = useNavigate()
  const toast = useToast()
  const [choice, setChoice] = useState<'monthly' | 'yearly'>('yearly')
  const [method, setMethod] = useState(METHODS[0])
  const [ref, setRef] = useState('')

  const payments = useMemo(
    () => (community ? db.payments.filter((p) => p.communityId === community.id) : []),
    [db.payments, community],
  )

  if (!me || !community) return null

  const send = () => {
    if (!ref.trim()) return toast(t('errRequired'), 'err')
    submitPayment(community.id, me.id, choice, method, ref.trim())
    setRef('')
    toast(t('paymentPending'))
  }

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="icon-btn" onClick={() => nav(-1)}>
          <Icon name="chevronLeft" size={18} />
        </button>
        <h2 className="grow" style={{ fontSize: 20, fontWeight: 800 }}>
          {t('billing')}
        </h2>
      </div>

      <div
        className="card"
        style={{
          background:
            plan?.status === 'active'
              ? 'linear-gradient(135deg, rgba(46,194,126,.18), var(--surface))'
              : plan?.status === 'trial'
                ? 'linear-gradient(135deg, rgba(255,181,69,.16), var(--surface))'
                : 'linear-gradient(135deg, rgba(255,77,94,.16), var(--surface))',
        }}
      >
        <div className="row-between">
          <div>
            <div className="tiny">{community.name}</div>
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>
              {plan?.status === 'trial'
                ? t('trial')
                : plan?.status === 'active'
                  ? t('active')
                  : t('expired')}
            </div>
            <div className="muted" style={{ marginTop: 3 }}>
              {plan?.status === 'trial'
                ? t('trialBanner', { n: plan.daysLeft })
                : plan?.status === 'active' && community.paidUntil
                  ? `${t('paidUntil')} ${fmtDate(community.paidUntil, lang)}`
                  : t('trialEnded')}
            </div>
          </div>
          <Icon
            name={plan?.status === 'active' ? 'check' : 'gift'}
            size={32}
            color={plan?.status === 'active' ? 'var(--brand)' : 'var(--warn)'}
          />
        </div>
      </div>

      {!isAdmin ? (
        <div className="banner banner-info" style={{ marginTop: 14 }}>
          <Icon name="info" size={17} />
          <span>{t('adminOnly')}</span>
        </div>
      ) : (
        <>
          <div className="section-title">{t('subscribe')}</div>
          <div className="col" style={{ gap: 10 }}>
            <button
              className={`price-card ${choice === 'monthly' ? 'on' : ''}`}
              onClick={() => setChoice('monthly')}
            >
              <div className="row-between">
                <div>
                  <div className="strong">{t('planMonthly')}</div>
                  <div className="amt">
                    {fmtMoney(PRICE_MONTHLY, lang)}
                    <span className="tiny">{t('perMonth')}</span>
                  </div>
                </div>
                {choice === 'monthly' && <Icon name="check" size={22} color="var(--brand)" />}
              </div>
            </button>
            <button
              className={`price-card ${choice === 'yearly' ? 'on' : ''}`}
              onClick={() => setChoice('yearly')}
            >
              <span className="badge-corner">{t('bestValue')}</span>
              <div className="row-between">
                <div>
                  <div className="strong">
                    {t('planYearly')} · <span className="tiny">{t('save2Months')}</span>
                  </div>
                  <div className="amt">
                    {fmtMoney(PRICE_YEARLY, lang)}
                    <span className="tiny">{t('perYear')}</span>
                  </div>
                </div>
                {choice === 'yearly' && <Icon name="check" size={22} color="var(--brand)" />}
              </div>
            </button>
          </div>

          <label className="field" style={{ marginTop: 16 }}>
            <span>{t('paymentMethod')}</span>
            <select
              className="select"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              {METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('paymentRef')}</span>
            <input
              className="input"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder="TRX-000123"
            />
          </label>
          <button className="btn btn-primary" onClick={send}>
            <Icon name="credit" size={16} /> {t('submitPayment')}
          </button>
          <p className="tiny center" style={{ marginTop: 10 }}>
            {t('paymentPending')}
          </p>
        </>
      )}

      <div className="section-title">{t('paymentHistory')}</div>
      {payments.length === 0 ? (
        <div className="empty">
          <span className="em">🧾</span>
          {t('noPayments')}
        </div>
      ) : (
        payments.map((p) => (
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
              <div className="strong">
                {fmtMoney(p.amount, lang)} ·{' '}
                {t(p.plan === 'monthly' ? 'planMonthly' : 'planYearly')}
              </div>
              <div className="tiny truncate">
                {p.method} · {p.reference}
              </div>
              <div className="tiny">{fmtDateTime(p.createdAt, lang)}</div>
            </div>
            <span
              className={`chip ${
                p.status === 'verified'
                  ? 'chip-brand'
                  : p.status === 'rejected'
                    ? 'chip-danger'
                    : 'chip-warn'
              }`}
            >
              {p.status === 'verified'
                ? t('paymentVerified').split('.')[0]
                : p.status === 'rejected'
                  ? t('rejected')
                  : t('pending')}
            </span>
          </div>
        ))
      )}
    </div>
  )
}
