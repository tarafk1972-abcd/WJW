/**
 * Kartu pembayaran QRIS ShopeePay.
 *
 * Satu-satunya cara membayar langganan. Nomor referensi selalu datang
 * dari sistem (server atau, di mode lokal, dibuat saat tagihan dibuat)
 * dan tidak pernah bisa diketik atau diubah admin.
 */
import { useState } from 'react'
import { fmtMoney } from '../lib/format'
import { useApp } from '../lib/store'
import { Icon } from './Icon'
import { useToast } from './Toast'

export interface QrisInfo {
  name: string
  phone: string
  imageUrl: string
  info: string
}

export function QrisCard({
  qris,
  reference,
  amount,
}: {
  qris: QrisInfo
  reference: string
  amount: number
}) {
  const { t, lang } = useApp()
  const toast = useToast()
  // Gambar QRIS belum tentu ada (mis. public/qris.png belum diisi).
  const [broken, setBroken] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(reference)
      toast(t('copied'))
    } catch {
      toast(t('copyFailed'), 'err')
    }
  }

  return (
    <div
      className="card card-tight qris-card"
      style={{ background: 'var(--bg-2)', marginBottom: 10, textAlign: 'center' }}
    >
      <div className="tiny strong" style={{ marginBottom: 4 }}>
        {t('qrisShopee')}
      </div>
      <div className="strong" style={{ fontSize: 19, marginBottom: 10 }}>
        {fmtMoney(amount, lang)}
      </div>

      {qris.imageUrl && !broken ? (
        <img
          src={qris.imageUrl}
          alt="QRIS"
          className="qris-img"
          onError={() => setBroken(true)}
        />
      ) : (
        <div className="tiny qris-missing">{t('qrisNotSet')}</div>
      )}

      {qris.name && (
        <div className="strong" style={{ fontSize: 13.5, marginTop: 8 }}>
          {t('onBehalf')} {qris.name}
          {qris.phone ? ` · ${qris.phone}` : ''}
        </div>
      )}
      <div className="tiny" style={{ marginTop: 6, lineHeight: 1.5 }}>
        {t('scanQris')}
      </div>
      {qris.info && (
        <div className="tiny" style={{ marginTop: 6, lineHeight: 1.5 }}>
          {qris.info}
        </div>
      )}

      {/* Nomor referensi — ditentukan sistem, hanya bisa disalin. */}
      <div className="ref-box">
        <div className="tiny">{t('refFixed')}</div>
        <div className="ref-code">{reference}</div>
        <button className="btn btn-sm btn-ghost" style={{ marginTop: 8 }} onClick={copy}>
          <Icon name="copy" size={13} /> {t('copyRef')}
        </button>
        <div className="tiny" style={{ marginTop: 8 }}>
          {t('refWhy')}
        </div>
      </div>
    </div>
  )
}
