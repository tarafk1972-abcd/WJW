import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { ApiError, billingApi, type InvoiceDto } from '../lib/api'
import { PRICE_MONTHLY, PRICE_YEARLY, submitPayment } from '../lib/db'
import { fmtDate, fmtDateTime, fmtMoney } from '../lib/format'
import { useApp } from '../lib/store'
import { apiMode } from '../lib/sync'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import type { Key } from '../lib/i18n'

const METHODS = ['Transfer Bank BCA', 'Transfer Bank Mandiri', 'QRIS', 'GoPay', 'OVO']

export default function Billing() {
  const { db, me, community, t, lang, plan, isAdmin } = useApp()
  const nav = useNavigate()
  const toast = useToast()

  const [choice, setChoice] = useState<'monthly' | 'yearly'>('yearly')
  const [busy, setBusy] = useState(false)
  const [invoices, setInvoices] = useState<InvoiceDto[] | null>(null)
  const [prices, setPrices] = useState({ monthly: PRICE_MONTHLY, yearly: PRICE_YEARLY })
  const [provider, setProvider] = useState<'mayar' | 'manual'>('manual')

  // mode lokal (tanpa server)
  const [method, setMethod] = useState(METHODS[0])
  const [ref, setRef] = useState('')

  const load = useCallback(async () => {
    if (!apiMode()) return
    try {
      const r = await billingApi.fetch()
      setInvoices(r.invoices)
      setPrices(r.prices)
      setProvider(r.provider)
    } catch {
      setInvoices(null)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const localPayments = useMemo(
    () => (community ? db.payments.filter((p) => p.communityId === community.id) : []),
    [db.payments, community],
  )

  if (!me || !community) return null

  /** Tagihan pending terbaru yang masih punya tautan bayar. */
  const openInvoice = invoices?.find((i) => i.status === 'pending' && i.payUrl)

  const checkout = async () => {
    setBusy(true)
    try {
      const r = await billingApi.checkout(choice, `${location.origin}${location.pathname}#/app/billing`)
      await load()
      toast(t('billCreated'))
      // langsung buka tautan pembayaran Mayar
      if (r.invoice.payUrl) window.open(r.invoice.payUrl, '_blank', 'noopener')
    } catch (e) {
      toast(t((e instanceof ApiError ? e.code : 'errPaymentProvider') as Key), 'err')
    }
    setBusy(false)
  }

  const submitLocal = () => {
    if (!ref.trim()) return toast(t('errRequired'), 'err')
    submitPayment(community.id, me.id, choice, method, ref.trim())
    setRef('')
    toast(t('paymentPending'))
  }

  const statusChipClass = (s: InvoiceDto['status']) =>
    s === 'paid' ? 'chip-brand' : s === 'pending' ? 'chip-warn' : 'chip-danger'

  const statusLabel = (s: InvoiceDto['status']) =>
    t(
      s === 'paid'
        ? 'billPaid'
        : s === 'pending'
          ? 'billPending'
          : s === 'failed'
            ? 'billFailed'
            : 'billExpired',
    )

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

      {/* status langganan */}
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
          {/* tagihan yang masih menunggu pembayaran */}
          {openInvoice && (
            <div className="card" style={{ marginTop: 14, borderColor: 'var(--warn)' }}>
              <div className="row-between" style={{ marginBottom: 8 }}>
                <span className="strong">{t('billPending')}</span>
                <span className="chip chip-warn">
                  {fmtMoney(openInvoice.amount, lang)}
                </span>
              </div>
              <p className="tiny" style={{ marginBottom: 10 }}>
                {t('billEmailNote', { email: me.email })}
                {openInvoice.expiresAt &&
                  ` · ${t('billValidUntil', { date: fmtDate(openInvoice.expiresAt, lang) })}`}
              </p>
              <a
                className="btn btn-primary"
                href={openInvoice.payUrl ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon name="credit" size={16} /> {t('payNow')}
              </a>
            </div>
          )}

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
                    {fmtMoney(prices.monthly, lang)}
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
                    {fmtMoney(prices.yearly, lang)}
                    <span className="tiny">{t('perYear')}</span>
                  </div>
                </div>
                {choice === 'yearly' && <Icon name="check" size={22} color="var(--brand)" />}
              </div>
            </button>
          </div>

          {apiMode() && provider === 'mayar' ? (
            <>
              <button
                className="btn btn-primary"
                style={{ marginTop: 16 }}
                disabled={busy}
                onClick={() => void checkout()}
              >
                <Icon name="credit" size={16} />{' '}
                {busy ? t('loading') : t('createBill')}
              </button>
              <p className="tiny center" style={{ marginTop: 10 }}>
                {t('billAutoActivate')}
              </p>
            </>
          ) : apiMode() ? (
            <div className="banner banner-warn" style={{ marginTop: 16 }}>
              <Icon name="info" size={17} />
              <span>{t('billManualMode')}</span>
            </div>
          ) : (
            /* mode lokal: konfirmasi manual seperti sebelumnya */
            <>
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
              <button className="btn btn-primary" onClick={submitLocal}>
                <Icon name="credit" size={16} /> {t('submitPayment')}
              </button>
            </>
          )}
        </>
      )}

      {/* riwayat */}
      <div className="section-title">{t('billInvoices')}</div>
      {apiMode() ? (
        !invoices || invoices.length === 0 ? (
          <div className="empty">
            <span className="em">🧾</span>
            {t('noInvoices')}
          </div>
        ) : (
          invoices.map((i) => (
            <div key={i.id} className="item">
              <div
                className="item-icon"
                style={{
                  background:
                    i.status === 'paid'
                      ? 'var(--brand-soft)'
                      : i.status === 'pending'
                        ? 'var(--warn-soft)'
                        : 'var(--danger-soft)',
                  color:
                    i.status === 'paid'
                      ? 'var(--brand)'
                      : i.status === 'pending'
                        ? 'var(--warn)'
                        : 'var(--danger)',
                }}
              >
                <Icon name="credit" size={18} />
              </div>
              <div className="grow">
                <div className="strong">
                  {fmtMoney(i.amount, lang)} ·{' '}
                  {t(i.plan === 'monthly' ? 'planMonthly' : 'planYearly')}
                </div>
                <div className="tiny">{fmtDateTime(i.createdAt, lang)}</div>
                {i.status === 'pending' && i.payUrl && (
                  <a
                    className="tiny"
                    href={i.payUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--brand)' }}
                  >
                    {t('openPayLink')} →
                  </a>
                )}
              </div>
              <span className={`chip ${statusChipClass(i.status)}`}>
                {statusLabel(i.status)}
              </span>
            </div>
          ))
        )
      ) : localPayments.length === 0 ? (
        <div className="empty">
          <span className="em">🧾</span>
          {t('noPayments')}
        </div>
      ) : (
        localPayments.map((p) => (
          <div key={p.id} className="item">
            <div
              className="item-icon"
              style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
            >
              <Icon name="credit" size={18} />
            </div>
            <div className="grow">
              <div className="strong">{fmtMoney(p.amount, lang)}</div>
              <div className="tiny truncate">
                {p.method} · {p.reference}
              </div>
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
              {p.status === 'verified' ? t('billPaid') : t('pending')}
            </span>
          </div>
        ))
      )}
    </div>
  )
}
