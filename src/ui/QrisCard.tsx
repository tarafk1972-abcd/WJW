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
  const [saving, setSaving] = useState(false)

  /**
   * Simpan gambar QRIS ke perangkat admin.
   *
   * Admin membayar lewat aplikasi ShopeePay, yang perlu memindai QR dari
   * galeri — bukan dari layar aplikasi ini. Tanpa cara menyimpannya,
   * satu-satunya jalan adalah tangkapan layar, yang ikut memotong
   * pinggiran dan kadang membuat QR gagal terbaca.
   */
  const unduh = async () => {
    if (!qris.imageUrl) return
    setSaving(true)
    try {
      // Ambil sebagai blob agar atribut `download` tetap berlaku;
      // menautkan langsung ke URL server bisa berakhir membuka tab baru.
      const res = await fetch(qris.imageUrl)
      if (!res.ok) throw new Error('fetch')
      const blob = await res.blob()

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'qris-wjw.png'
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Beri jeda sebelum dilepas: sebagian peramban masih membacanya.
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      toast(t('qrisSaved2'))
    } catch {
      toast(t('qrisSaveFailed'), 'err')
    }
    setSaving(false)
  }

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
      {qris.imageUrl && !broken && (
        <button
          className="btn btn-sm btn-ghost"
          style={{ marginTop: 10 }}
          disabled={saving}
          onClick={() => void unduh()}
        >
          <Icon name="clipboard" size={13} /> {saving ? '…' : t('saveQrisImage')}
        </button>
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
