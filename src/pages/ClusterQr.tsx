import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { createInvite, inviteLink, revokeInvite } from '../lib/db'
import { fmtDate } from '../lib/format'
import { useApp } from '../lib/store'
import { Icon } from '../ui/Icon'
import { QrCode } from '../ui/QrCode'
import { useToast } from '../ui/Toast'

/**
 * Halaman admin untuk membuat QR pendaftaran cluster.
 *
 * QR memuat tautan #/join/<KODE>. Warga memindainya, mengisi data, lalu
 * masuk antrean persetujuan admin — QR tidak melewati persetujuan.
 */
export default function ClusterQr() {
  const { db, me, community, t, lang, isAdmin } = useApp()
  const nav = useNavigate()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  /** QR cluster = undangan peran Warga, berlaku lama, tanpa batas pakai. */
  const clusterInvite = useMemo(() => {
    if (!community) return null
    return (
      db.invites
        .filter(
          (i) =>
            i.communityId === community.id &&
            i.role === 'warga' &&
            i.maxUses === null &&
            !i.revokedAt &&
            i.expiresAt > Date.now(),
        )
        .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
    )
  }, [db.invites, community])

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

  const make = () => {
    setBusy(true)
    createInvite(me.id, community.id, 'warga', { days: 365, maxUses: null })
    setBusy(false)
    toast(t('inviteCreated'))
  }

  const link = clusterInvite ? inviteLink(clusterInvite.code) : ''

  const printPoster = () => {
    if (!clusterInvite) return
    const w = window.open('', '_blank', 'width=800,height=1000')
    if (!w) return toast(t('printQr'), 'err')
    // QR digambar ulang di jendela cetak agar tajam saat dicetak
    w.document.write(`<!doctype html><html><head><meta charset="utf-8">
<title>${community.name} — ${t('scanToRegister')}</title>
<style>
  @page { size: A4; margin: 18mm; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
         text-align: center; color: #0d1117; }
  .card { border: 3px solid #0d1117; border-radius: 22px; padding: 34px 28px; }
  h1 { font-size: 30px; margin: 0 0 4px; }
  h2 { font-size: 17px; font-weight: 600; color: #444; margin: 0 0 26px; }
  img { width: 340px; height: 340px; }
  .code { font-size: 40px; font-weight: 900; letter-spacing: 12px;
          margin: 20px 0 6px; }
  .hint { color: #555; font-size: 14px; }
  ol { text-align: left; max-width: 430px; margin: 24px auto 0;
       color: #333; font-size: 14px; line-height: 1.75; }
</style></head><body>
<div class="card">
  <h1>${community.name}</h1>
  <h2>${t('scanToRegister')}</h2>
  <img src="${document.querySelector<HTMLImageElement>('#cluster-qr img')?.src ?? ''}" alt="QR">
  <div class="code">${clusterInvite.code}</div>
  <div class="hint">${t('enterCode')}</div>
  <ol>
    <li>${t('qrStep2')}</li>
    <li>${t('qrStep3')}</li>
    <li>${t('qrStep4')}</li>
  </ol>
</div>
<script>window.onload = () => setTimeout(() => window.print(), 350)</script>
</body></html>`)
    w.document.close()
  }

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="icon-btn" onClick={() => nav(-1)}>
          <Icon name="chevronLeft" size={18} />
        </button>
        <div className="grow">
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>{t('clusterQr')}</h2>
          <div className="tiny">{community.name}</div>
        </div>
      </div>

      {clusterInvite ? (
        <>
          <div
            className="card"
            id="cluster-qr"
            style={{ padding: 20, textAlign: 'center' }}
          >
            <div className="tiny" style={{ marginBottom: 12 }}>
              {t('scanToRegister')}
            </div>
            <QrCode value={link} size={220} />
            <div className="code-display" style={{ marginTop: 16 }}>
              {clusterInvite.code}
            </div>
            <div className="tiny" style={{ marginTop: 8 }}>
              {t('qrValidUntil', { date: fmtDate(clusterInvite.expiresAt, lang) })}
              {' · '}
              {t('inviteUses', { n: clusterInvite.usedBy.length })}
            </div>
          </div>

          <div className="btn-row" style={{ marginTop: 12 }}>
            <button
              className="btn btn-ghost grow"
              onClick={() => {
                navigator.clipboard?.writeText(clusterInvite.code)
                toast(t('copied'))
              }}
            >
              <Icon name="copy" size={15} /> {t('inviteCopy')}
            </button>
            <button
              className="btn btn-ghost grow"
              onClick={() => {
                navigator.clipboard?.writeText(link)
                toast(t('copied'))
              }}
            >
              <Icon name="copy" size={15} /> {t('copyLink')}
            </button>
          </div>

          <button
            className="btn btn-primary"
            style={{ marginTop: 8 }}
            onClick={printPoster}
          >
            <Icon name="clipboard" size={16} /> {t('qrPoster')}
          </button>

          <button
            className="btn btn-ghost"
            style={{ marginTop: 8 }}
            onClick={async () => {
              const text = `${community.name}\n${t('scanToRegister')}\n${t('enterCode')}: ${clusterInvite.code}\n${link}`
              if (navigator.share) {
                try {
                  await navigator.share({ title: community.name, text })
                  return
                } catch {
                  /* dibatalkan */
                }
              }
              navigator.clipboard?.writeText(text)
              toast(t('copied'))
            }}
          >
            <Icon name="send" size={15} /> {t('shareVia')}
          </button>

          <div className="section-title">{t('qrHowTo')}</div>
          <div className="card">
            {[t('qrStep1'), t('qrStep2'), t('qrStep3'), t('qrStep4')].map((step, i) => (
              <div key={i} className="row" style={{ gap: 10, marginBottom: i < 3 ? 10 : 0 }}>
                <span
                  className="chip chip-brand"
                  style={{ minWidth: 22, justifyContent: 'center' }}
                >
                  {i + 1}
                </span>
                <span className="grow" style={{ fontSize: 13 }}>
                  {step}
                </span>
              </div>
            ))}
          </div>

          <div className="disclaimer" style={{ marginTop: 12 }}>
            <Icon name="info" size={15} />
            <span>{t('approvalRequiredInvite')}</span>
          </div>

          <button
            className="btn btn-ghost"
            style={{ marginTop: 12 }}
            onClick={() => {
              revokeInvite(me.id, clusterInvite.id)
              toast(t('revoked'))
            }}
          >
            <Icon name="trash" size={15} /> {t('regenerate')}
          </button>
        </>
      ) : (
        <>
          <div className="empty">
            <span className="em">📇</span>
            {t('clusterQrSub')}
          </div>
          <button className="btn btn-primary" disabled={busy} onClick={make}>
            <Icon name="key" size={16} /> {t('makeClusterQr')}
          </button>
        </>
      )}
    </div>
  )
}
