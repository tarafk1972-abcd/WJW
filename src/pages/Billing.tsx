import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { ApiError, billingApi, type InvoiceDto } from '../lib/api'
import { PRICE_MONTHLY, PRICE_YEARLY, submitPayment } from '../lib/db'
import { fmtDate, fmtDateTime, fmtMoney } from '../lib/format'
import { QRIS_LOCAL } from '../lib/qris'
import { useApp } from '../lib/store'
import { apiMode } from '../lib/sync'
import { Icon } from '../ui/Icon'
import { QrisCard } from '../ui/QrisCard'
import { Sheet } from '../ui/Sheet'
import { useToast } from '../ui/Toast'
import type { Key } from '../lib/i18n'
import type { Payment } from '../lib/types'

export default function Billing() {
  const { db, me, community, t, lang, plan, isAdmin, refresh } = useApp()
  const nav = useNavigate()
  const toast = useToast()

  const [choice, setChoice] = useState<'monthly' | 'yearly'>('yearly')
  const [busy, setBusy] = useState(false)
  const [invoices, setInvoices] = useState<InvoiceDto[] | null>(null)
  const [prices, setPrices] = useState({ monthly: PRICE_MONTHLY, yearly: PRICE_YEARLY })
  const [qris, setQris] = useState(QRIS_LOCAL)

  // sheet konfirmasi pembayaran
  const [claiming, setClaiming] = useState<InvoiceDto | null>(null)

  const load = useCallback(async () => {
    if (!apiMode()) return
    try {
      const r = await billingApi.fetch()
      setInvoices(r.invoices)
      setPrices(r.prices)
      setQris(r.qris)
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

  /** Tagihan yang belum lunas. */
  const openInvoice = invoices?.find(
    (i) => i.status === 'pending' || i.status === 'awaiting_verification',
  )

  /** Tagihan lokal yang masih menunggu verifikasi. */
  const openLocal: Payment | undefined = localPayments.find((p) => p.status === 'pending')

  const createBill = async () => {
    setBusy(true)
    try {
      const r = await billingApi.checkout(choice)
      await load()
      toast(r.emailSent ? t('billEmailed', { email: me.email }) : t('billCreated'))
    } catch (e) {
      toast(t((e instanceof ApiError ? e.code : 'errUnknown') as Key), 'err')
    }
    setBusy(false)
  }

  const sendClaim = async () => {
    if (!claiming) return
    setBusy(true)
    try {
      await billingApi.claim(claiming.id)
      await load()
      setClaiming(null)
      toast(t('claimSent'))
    } catch (e) {
      toast(t((e instanceof ApiError ? e.code : 'errUnknown') as Key), 'err')
    }
    setBusy(false)
  }

  /** Mode lokal: buat tagihan dengan nomor referensi dari sistem. */
  const createLocalBill = () => {
    submitPayment(community.id, me.id, choice)
    // Tulisan ke penyimpanan lokal tidak memicu render ulang dengan
    // sendirinya — minta store membaca ulang agar tagihannya tampil.
    refresh()
    toast(t('billCreatedLocal'))
  }

  const chipClass = (s: InvoiceDto['status']) =>
    s === 'paid'
      ? 'chip-brand'
      : s === 'awaiting_verification'
        ? 'chip-info'
        : s === 'pending'
          ? 'chip-warn'
          : 'chip-danger'

  const chipLabel = (s: InvoiceDto['status']) =>
    t(
      s === 'paid'
        ? 'billPaid'
        : s === 'awaiting_verification'
          ? 'awaitingVerification'
          : s === 'pending'
            ? 'billPending'
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
          {/* tagihan berjalan */}
          {openInvoice && (
            <div
              className="card"
              style={{
                marginTop: 14,
                borderColor:
                  openInvoice.status === 'awaiting_verification'
                    ? 'var(--info)'
                    : 'var(--warn)',
              }}
            >
              <div className="row-between" style={{ marginBottom: 10 }}>
                <span className="strong">{chipLabel(openInvoice.status)}</span>
                <span className={`chip ${chipClass(openInvoice.status)}`}>
                  {fmtMoney(openInvoice.amount, lang)}
                </span>
              </div>

              {openInvoice.status === 'awaiting_verification' ? (
                <p className="tiny">
                  {t('verifyWithin')} · {openInvoice.reference}
                </p>
              ) : (
                <>
                  {openInvoice.note && (
                    <div className="banner banner-danger" style={{ marginBottom: 10 }}>
                      <Icon name="info" size={15} />
                      <span>{t('rejectedNote', { note: openInvoice.note })}</span>
                    </div>
                  )}

                  <QrisCard
                    qris={qris}
                    reference={openInvoice.reference}
                    amount={openInvoice.amount}
                  />

                  <button
                    className="btn btn-primary"
                    onClick={() => setClaiming(openInvoice)}
                  >
                    <Icon name="check" size={16} /> {t('iHavePaid')}
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ marginTop: 8 }}
                    disabled={busy}
                    onClick={async () => {
                      try {
                        await billingApi.resend(openInvoice.id)
                        toast(t('billResent'))
                      } catch {
                        toast(t('errUnknown'), 'err')
                      }
                    }}
                  >
                    <Icon name="send" size={15} /> {t('resendBill')}
                  </button>
                </>
              )}
            </div>
          )}

          {/* tagihan berjalan — mode lokal */}
          {!apiMode() && openLocal && (
            <div className="card" style={{ marginTop: 14, borderColor: 'var(--warn)' }}>
              <div className="row-between" style={{ marginBottom: 10 }}>
                <span className="strong">{t('billPending')}</span>
                <span className="chip chip-warn">{fmtMoney(openLocal.amount, lang)}</span>
              </div>
              <QrisCard
                qris={qris}
                reference={openLocal.reference}
                amount={openLocal.amount}
              />
              <p className="tiny center">{t('localBillNote')}</p>
            </div>
          )}

          {/* pilih paket — hanya bila tidak ada tagihan berjalan */}
          {!openInvoice && !(!apiMode() && openLocal) && (
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
                        {fmtMoney(prices.monthly, lang)}
                        <span className="tiny">{t('perMonth')}</span>
                      </div>
                    </div>
                    {choice === 'monthly' && (
                      <Icon name="check" size={22} color="var(--brand)" />
                    )}
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
                        {t('planYearly')} ·{' '}
                        <span className="tiny">{t('save2Months')}</span>
                      </div>
                      <div className="amt">
                        {fmtMoney(prices.yearly, lang)}
                        <span className="tiny">{t('perYear')}</span>
                      </div>
                    </div>
                    {choice === 'yearly' && (
                      <Icon name="check" size={22} color="var(--brand)" />
                    )}
                  </div>
                </button>
              </div>

              {apiMode() ? (
                <>
                  <button
                    className="btn btn-primary"
                    style={{ marginTop: 16 }}
                    disabled={busy}
                    onClick={() => void createBill()}
                  >
                    <Icon name="credit" size={16} />{' '}
                    {busy ? t('loading') : t('createBill')}
                  </button>
                  <p className="tiny center" style={{ marginTop: 10 }}>
                    {t('billEmailNote', { email: me.email })}
                  </p>
                </>
              ) : (
                /* mode lokal — tanpa server, tanpa email */
                <>
                  <button
                    className="btn btn-primary"
                    style={{ marginTop: 16 }}
                    onClick={createLocalBill}
                  >
                    <Icon name="credit" size={16} /> {t('createBill')}
                  </button>
                  <p className="tiny center" style={{ marginTop: 10 }}>
                    {t('localBillNote')}
                  </p>
                </>
              )}
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
                      : i.status === 'awaiting_verification'
                        ? 'var(--info-soft)'
                        : 'var(--warn-soft)',
                  color:
                    i.status === 'paid'
                      ? 'var(--brand)'
                      : i.status === 'awaiting_verification'
                        ? 'var(--info)'
                        : 'var(--warn)',
                }}
              >
                <Icon name="credit" size={18} />
              </div>
              <div className="grow">
                <div className="strong">
                  {fmtMoney(i.amount, lang)} ·{' '}
                  {t(i.plan === 'monthly' ? 'planMonthly' : 'planYearly')}
                </div>
                <div className="tiny">{i.invoiceNo} · {i.reference}</div>
                <div className="tiny">{fmtDateTime(i.createdAt, lang)}</div>
              </div>
              <span className={`chip ${chipClass(i.status)}`}>{chipLabel(i.status)}</span>
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
              className={`chip ${p.status === 'verified' ? 'chip-brand' : 'chip-warn'}`}
            >
              {p.status === 'verified' ? t('billPaid') : t('pending')}
            </span>
          </div>
        ))
      )}

      {/* konfirmasi sudah bayar */}
      <Sheet
        open={!!claiming}
        onClose={() => setClaiming(null)}
        title={t('iHavePaid')}
        subtitle={claiming ? claiming.invoiceNo : ''}
      >
        <div className="card card-tight" style={{ marginBottom: 14, textAlign: 'center' }}>
          <div className="tiny">{t('refNumber')}</div>
          <div className="ref-code" style={{ marginTop: 4 }}>
            {claiming?.reference}
          </div>
        </div>
        <button className="btn btn-primary" disabled={busy} onClick={() => void sendClaim()}>
          <Icon name="check" size={16} /> {t('submit')}
        </button>
        <p className="tiny center" style={{ marginTop: 10 }}>
          {t('verifyWithin')}
        </p>
      </Sheet>
    </div>
  )
}
