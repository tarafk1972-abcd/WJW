import { useState } from 'react'
import { useNavigate } from 'react-router'
import { ApiError, communityApi, hubApi, profileApi, type BrandingDto } from '../lib/api'
import { renameCommunity, resetDB, setMemberLanguage } from '../lib/db'
import {
  disablePresence,
  enablePresence,
  presenceDisabled,
  setHomeManually,
} from '../lib/presence'
import { apiMode, mutate } from '../lib/sync'
import { fmtDate, initials } from '../lib/format'
import { LANGS } from '../lib/i18n'
import { useApp } from '../lib/store'
import { Icon } from '../ui/Icon'
import { Sheet } from '../ui/Sheet'
import { useToast } from '../ui/Toast'
import { roleChip, roleKey } from '../lib/meta'

export default function Settings() {
  const { me, community, t, lang, plan, signOut, isAdmin, canAssignManagementResponsibilities, refresh, reload } = useApp()
  const isSatpam = me?.role === 'satpam'
  const nav = useNavigate()
  const toast = useToast()
  // ganti nama lingkungan (hanya admin)
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCity, setNewCity] = useState('')
  const [shareOff, setShareOff] = useState(() => presenceDisabled())
  const [homeBusy, setHomeBusy] = useState(false)
  const [brandingOpen, setBrandingOpen] = useState(false)
  const [branding, setBranding] = useState<BrandingDto | null>(null)
  const [brandingBusy, setBrandingBusy] = useState(false)

  if (!me || !community) return null

  /** Pesan khusus supaya batas paket tidak terasa seperti kegagalan misterius. */
  const brandingError = (error: unknown): string => {
    if (!(error instanceof ApiError)) return t('tenantIdentitySaveFailed')
    if (error.code === 'tier_required') return t('tierRequired')
    if (error.code === 'forbidden') return t('tenantIdentityForbidden')
    if (error.code === 'invalid_hub_input') return t('tenantIdentityInvalid')
    return t('tenantIdentitySaveFailed')
  }

  const enterprise = community.subscriptionTier === 'ENTERPRISE'
  const openBranding = async () => {
    if (!apiMode()) return toast(t('tenantIdentityServerOnly'), 'err')
    setBrandingBusy(true)
    try {
      const result = await hubApi.branding()
      setBranding(result.branding)
      setBrandingOpen(true)
    } catch (error) {
      toast(brandingError(error), 'err')
    } finally {
      setBrandingBusy(false)
    }
  }

  const saveBranding = async () => {
    if (!branding || brandingBusy) return
    setBrandingBusy(true)
    try {
      const result = await hubApi.saveBranding({
        brandName: branding.brandName,
        accentColor: branding.accentColor,
        logoUrl: branding.logoUrl,
        customDomain: branding.customDomain,
        whiteLabelRequested: branding.whiteLabelRequested,
      })
      setBranding(result.branding)
      toast(t('tenantIdentitySaved'), 'ok')
    } catch (error) {
      toast(brandingError(error), 'err')
    } finally {
      setBrandingBusy(false)
    }
  }

  const verifyDomain = async () => {
    if (brandingBusy) return
    setBrandingBusy(true)
    try {
      const result = await hubApi.verifyBrandingDomain()
      setBranding(result.branding)
      toast(
        result.verified ? t('tenantDnsVerifiedMessage') : t('tenantDnsPendingMessage'),
        result.verified ? 'ok' : 'err',
      )
    } catch (error) {
      toast(brandingError(error), 'err')
    } finally {
      setBrandingBusy(false)
    }
  }

  return (
    <div className="page">
      <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 14 }}>{t('settings')}</h2>

      <div className="card">
        <div className="row">
          <div className={`avatar ${me.role}`} style={{ width: 52, height: 52, fontSize: 17 }}>
            {initials(me.name)}
          </div>
          <div className="grow">
            <div className="strong" style={{ fontSize: 16 }}>
              {me.name}
            </div>
            <div className="tiny">
              {me.house} · {me.phone}
            </div>
            <div className="tiny">{me.email}</div>
          </div>
          <span className={`chip ${roleChip(me.role)}`}>{t(roleKey(me.role))}</span>
        </div>
      </div>

      <div className="section-title">{t('language')}</div>
      <div className="col" style={{ gap: 8 }}>
        {LANGS.map((l) => (
          <button
            key={l.code}
            className="list-link"
            onClick={() => {
              setMemberLanguage(me.id, l.code)
              if (apiMode()) void mutate(() => profileApi.save({ language: l.code }))
              refresh()
            }}
            style={
              lang === l.code
                ? { borderColor: 'var(--brand)', background: 'var(--brand-soft)' }
                : undefined
            }
          >
            <span style={{ fontSize: 20 }}>{l.flag}</span>
            <span className="grow strong">{l.label}</span>
            {lang === l.code && <Icon name="check" size={17} color="var(--brand)" />}
          </button>
        ))}
      </div>

      <div className="section-title">{t('emergencyProfile')}</div>
      <button className="list-link" onClick={() => nav('/app/emergency-profile')}>
        <Icon name="heart" size={19} color="var(--danger)" />
        <span className="grow">
          <span className="strong" style={{ display: 'block' }}>
            {t('emergencyProfile')}
          </span>
          <span className="tiny">{t('emergencyProfileHint')}</span>
        </span>
        <Icon name="chevronRight" size={16} color="var(--text-3)" />
      </button>

      <div className="section-title" id="emergency">
        {t('myNetwork')}
      </div>
      <button className="list-link" onClick={() => nav('/app/network')}>
        <Icon name="users" size={19} color="var(--brand)" />
        <span className="grow">
          <span className="strong" style={{ display: 'block' }}>
            {t('myNetwork')}
          </span>
          <span className="tiny">{t('networkHint')}</span>
        </span>
        <Icon name="chevronRight" size={16} color="var(--text-3)" />
      </button>
      <div className="disclaimer" style={{ marginTop: 10 }}>
        <Icon name="info" size={15} />
        <span>{t('noPolice')}</span>
      </div>

      <div className="section-title">{t('community')}</div>
      <div className="card">
        <div className="row-between">
          <span className="muted">{t('communityName')}</span>
          {/*
            Inilah tempat orang mencari nama lingkungannya, jadi cara
            mengubahnya harus ada di sini juga — bukan hanya di halaman
            Admin.
          */}
          {isAdmin ? (
            <button
              className="link-btn strong"
              onClick={() => {
                setNewName(community.name)
                setNewCity(community.city)
                setRenaming(true)
              }}
            >
              {community.name} <Icon name="edit" size={12} />
            </button>
          ) : (
            <span className="strong">{community.name}</span>
          )}
        </div>
        <div className="divider" />
        <div className="row-between">
          <span className="muted">{t('city')}</span>
          <span className="strong">{community.city || '-'}</span>
        </div>
        <div className="divider" />
        <div className="row-between">
          <span className="muted">{t('map')}</span>
          <span className="strong">
            {community.area.length >= 3
              ? t('areaPoints', { n: community.area.length })
              : t('none')}
          </span>
        </div>
        <div className="divider" />
        <div className="row-between">
          <span className="muted">{t('billing')}</span>
          <span className="strong">
            {plan?.status === 'trial'
              ? `${t('trial')} · ${t('daysLeft', { n: plan.daysLeft })}`
              : plan?.status === 'active'
                ? `${t('paidUntil')} ${community.paidUntil ? fmtDate(community.paidUntil, lang) : '-'}`
                : t('expired')}
          </span>
        </div>
        {canAssignManagementResponsibilities && (
          <>
            <div className="divider" />
            <div className="row-between" style={{ gap: 10 }}>
              <div className="grow">
                <div className="muted">{t('tenantIdentity')}</div>
                <div className="tiny">{t('tenantIdentitySummary')}</div>
              </div>
              <button className="btn btn-sm btn-ghost" disabled={brandingBusy} onClick={() => void openBranding()}>
                <Icon name="edit" size={14} /> {t('tenantManage')}
              </button>
            </div>
          </>
        )}
      </div>

      {/*
        Berbagi posisi menyangkut privasi warga, jadi harus terlihat dan
        bisa ditolak — bukan berjalan diam-diam.

        TIDAK ditampilkan kepada satpam. Bagi mereka lokasi dan notifikasi
        darurat adalah alat kerja, bukan pilihan: satu ketukan "Nonaktif"
        akan melumpuhkan seluruh jalur peringatan pada orang yang justru
        ditugaskan menerimanya. Rumah pun tidak relevan — satpam dipanggil
        karena sedang berjaga, bukan karena tempat tinggalnya.
      */}
      {!isSatpam && (
        <>
      <div className="section-title">{t('privacy')}</div>
      <div className="card">
        <div className="row-between">
          <div className="grow" style={{ paddingRight: 12 }}>
            <div className="strong" style={{ fontSize: 13.5 }}>
              {t('shareNearby')}
            </div>
            <div className="tiny" style={{ marginTop: 3, lineHeight: 1.5 }}>
              {t('shareNearbyHint')}
            </div>
          </div>
          <button
            className={`btn btn-sm ${shareOff ? 'btn-ghost' : 'btn-primary'}`}
            onClick={async () => {
              if (shareOff) {
                enablePresence()
                setShareOff(false)
              } else {
                await disablePresence()
                setShareOff(true)
              }
            }}
          >
            {shareOff ? t('off') : t('on')}
          </button>
        </div>

        {/*
          Letak rumah dicatat sekali saat mendaftar. Bila GPS sedang
          buruk waktu itu, inilah satu-satunya cara memperbaikinya —
          tidak ada pembacaan ulang otomatis.
        */}
        {!shareOff && (
          <>
            <div className="divider" />
            <div className="row-between">
              <div className="grow" style={{ paddingRight: 12 }}>
                <div className="strong" style={{ fontSize: 13.5 }}>
                  {t('markHome')}
                </div>
                <div className="tiny" style={{ marginTop: 3, lineHeight: 1.5 }}>
                  {t('markHomeHint')}
                </div>
              </div>
              <button
                className="btn btn-sm btn-ghost"
                disabled={homeBusy}
                onClick={async () => {
                  setHomeBusy(true)
                  const ok = await setHomeManually()
                  setHomeBusy(false)
                  toast(ok ? t('homeMarked') : t('homeFailed'), ok ? 'ok' : 'err')
                }}
              >
                {homeBusy ? '…' : t('markHomeNow')}
              </button>
            </div>
          </>
        )}
      </div>
        </>
      )}

      <div className="section-title">{t('helpSupport')}</div>
      <button className="list-link" onClick={() => nav('/app/support')}>
        <Icon name="headset" size={19} color="var(--info)" />
        <span className="grow strong">{t('contactCS')}</span>
        <Icon name="chevronRight" size={16} color="var(--text-3)" />
      </button>
      {isAdmin && (
        <button className="list-link" onClick={() => nav('/app/billing')}>
          <Icon name="credit" size={19} color="var(--brand)" />
          <span className="grow strong">{t('billing')}</span>
          <Icon name="chevronRight" size={16} color="var(--text-3)" />
        </button>
      )}

      <div className="section-title">{t('account')}</div>
      <button
        className="list-link"
        onClick={() => {
          signOut()
          nav('/')
        }}
      >
        <Icon name="logout" size={19} color="var(--warn)" />
        <span className="grow strong">{t('logout')}</span>
      </button>
      <button
        className="list-link"
        onClick={() => {
          if (confirm(t('resetDemoConfirm'))) {
            resetDB()
            nav('/')
          }
        }}
      >
        <Icon name="trash" size={19} color="var(--danger)" />
        <span className="grow strong">{t('resetDemo')}</span>
      </button>

      <p className="tiny center" style={{ marginTop: 20 }}>
        {t('appName')} · v1.0 · {t('appTagline')}
      </p>

      {/* Identitas tenant: khusus pemegang mandat tenant, selalu server-first. */}
      <Sheet
        open={brandingOpen}
        onClose={() => setBrandingOpen(false)}
        title={t('tenantIdentity')}
        subtitle={t('tenantCurrentPlan', { plan: community.subscriptionTier ?? 'FREE' })}
      >
        {!branding ? (
          <div className="empty">{t('tenantLoadingIdentity')}</div>
        ) : (
          <>
            <label className="field">
              <span>{t('tenantBrandName')}</span>
              <input
                className="input"
                value={branding.brandName}
                maxLength={60}
                onChange={(event) => setBranding({ ...branding, brandName: event.target.value })}
                placeholder={community.name}
              />
            </label>
            <label className="field">
              <span>{t('tenantAccentColor')}</span>
              <input
                className="input"
                type="color"
                value={branding.accentColor || '#2ec27e'}
                onChange={(event) => setBranding({ ...branding, accentColor: event.target.value })}
              />
            </label>
            <label className="field">
              <span>{t('tenantLogoUrl')}</span>
              <input
                className="input"
                type="url"
                inputMode="url"
                value={branding.logoUrl}
                maxLength={500}
                onChange={(event) => setBranding({ ...branding, logoUrl: event.target.value })}
                placeholder="https://contoh.id/logo.png"
              />
            </label>

            {!enterprise && (
              <div className="banner banner-info" style={{ marginBottom: 12 }}>
                <Icon name="info" size={16} />
                <span>{t('tierRequired')}</span>
              </div>
            )}
            <label className="field">
              <span>{t('tenantCustomDomain')}</span>
              <input
                className="input"
                type="text"
                inputMode="url"
                autoCapitalize="none"
                value={branding.customDomain}
                maxLength={253}
                disabled={!enterprise && !branding.customDomain}
                onChange={(event) => setBranding({ ...branding, customDomain: event.target.value.toLowerCase() })}
                placeholder="warga.contoh.id"
              />
              <span className="tiny">{t('tenantCustomDomainHint')}</span>
            </label>
            <label className="row" style={{ alignItems: 'flex-start', gap: 8, marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={branding.whiteLabelRequested}
                disabled={!enterprise && !branding.whiteLabelRequested}
                onChange={(event) => setBranding({ ...branding, whiteLabelRequested: event.target.checked })}
              />
              <span className="grow">
                <span className="strong" style={{ display: 'block', fontSize: 13.5 }}>{t('tenantWhiteLabel')}</span>
                <span className="tiny">{t('tenantWhiteLabelHint')}</span>
              </span>
            </label>

            {branding.customDomain && (
              <div className="card card-tight" style={{ marginBottom: 12 }}>
                <div className="strong" style={{ fontSize: 13.5 }}>
                  <Icon name="globe" size={14} /> {t('tenantDnsStatus')}: {' '}
                  {branding.domainStatus === 'dns_verified' ? t('tenantDnsVerified') : t('tenantDnsPending')}
                </div>
                {branding.verificationName && branding.verificationValue && (
                  <div className="tiny" style={{ marginTop: 7, wordBreak: 'break-word', lineHeight: 1.55 }}>
                    {t('tenantDnsInstruction', {
                      name: branding.verificationName,
                      value: branding.verificationValue,
                    })}
                  </div>
                )}
                <button className="btn btn-sm btn-ghost" style={{ marginTop: 9 }} disabled={brandingBusy} onClick={() => void verifyDomain()}>
                  {t('tenantCheckDns')}
                </button>
              </div>
            )}
            <button className="btn btn-primary" disabled={brandingBusy} onClick={() => void saveBranding()}>
              <Icon name="check" size={16} /> {brandingBusy ? t('tenantSaving') : t('tenantSaveIdentity')}
            </button>
          </>
        )}
      </Sheet>

      {/* ganti nama lingkungan */}
      <Sheet
        open={renaming}
        onClose={() => setRenaming(false)}
        title={t('renameCommunity')}
      >
        <label className="field">
          <span>{t('communityName')}</span>
          <input
            className="input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="RW 05 Griya Soreang"
          />
          <span className="tiny pw-hint">{t('communityNameHint')}</span>
        </label>
        <label className="field">
          <span>{t('city')}</span>
          <input
            className="input"
            value={newCity}
            onChange={(e) => setNewCity(e.target.value)}
            placeholder="Kab. Bandung"
          />
        </label>
        <button
          className="btn btn-primary"
          onClick={async () => {
            const nama = newName.trim()
            if (!nama) return toast(t('errCommunityName'), 'err')

            if (apiMode()) {
              try {
                await communityApi.rename(nama, newCity.trim())
              } catch (e) {
                return toast(
                  t((e instanceof ApiError ? e.code : 'errUnknown') as never),
                  'err',
                )
              }
              await reload()
            } else {
              const r = renameCommunity(me.id, community.id, nama, newCity.trim())
              if (!r.ok) return toast(t(r.error as never), 'err')
              refresh()
            }
            setRenaming(false)
            toast(t('communityRenamed'))
          }}
        >
          <Icon name="check" size={16} /> {t('save')}
        </button>
      </Sheet>
    </div>
  )
}
