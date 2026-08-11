import { useState } from 'react'
import { useNavigate } from 'react-router'
import { authApi, ApiError } from '../lib/api'
import { SUPERADMIN_EMAIL, deviceId, login, setSession } from '../lib/db'
import { syncState } from '../lib/sync'
import { useApp } from '../lib/store'
import { Icon } from '../ui/Icon'
import { Sheet } from '../ui/Sheet'
import type { Key } from '../lib/i18n'

export default function Login() {
  const { t } = useApp()
  const nav = useNavigate()
  const [id, setId] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState<Key | ''>('')

  const [busy, setBusy] = useState(false)
  // Server tidak terjangkau pada percobaan terakhir.
  const [offline, setOffline] = useState(false)
  const [help, setHelp] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      // Utamakan server; bila tidak terjangkau, jatuh ke data lokal.
      const res = await authApi.login(id, pw, deviceId())
      const m = res.member as { id: string; role: string; status: string }
      setSession(m.id)
      await syncState()
      if (m.role === 'superadmin') nav('/console')
      else if (m.status === 'active') nav('/app')
      else nav('/pending')
    } catch (e2) {
      const offline = e2 instanceof ApiError && e2.status === 0
      if (!offline) {
        setErr((e2 instanceof ApiError ? e2.code : 'errLogin') as Key)
        setBusy(false)
        return
      }
      setOffline(true)
      const local = login(id, pw)
      if (!local.ok) {
        setErr(local.error as Key)
        setBusy(false)
        return
      }
      if (local.member.role === 'superadmin') nav('/console')
      else if (local.member.status === 'active') nav('/app')
      else nav('/pending')
    }
    setBusy(false)
  }

  return (
    <div className="shell">
      <div className="topbar">
        <button className="icon-btn" onClick={() => nav('/')}>
          <Icon name="chevronLeft" size={18} />
        </button>
        <div className="grow">
          <h1>{t('login')}</h1>
          <div className="sub">{t('appName')}</div>
        </div>
      </div>

      <form className="page no-nav" onSubmit={(e) => void submit(e)}>
        <div className="brand-mark" style={{ width: 54, height: 54, borderRadius: 17, fontSize: 18, margin: '10px auto 16px' }}>
          WJW
        </div>
        <h2 className="center" style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>
          {t('loginTitle')}
        </h2>
        <p className="muted center" style={{ marginBottom: 22 }}>
          {t('appTagline')}
        </p>

        {err && (
          <div className="error-box">
            {t(err)}
            {err === 'errLogin' && (
              <button
                type="button"
                className="link-btn"
                onClick={() => setHelp(true)}
              >
                {t('forgotPassword')}
              </button>
            )}
          </div>
        )}

        <label className="field">
          <span>{t('email')} / {t('phone')}</span>
          <input
            className="input"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="nama@email.com"
            autoCapitalize="none"
          />
        </label>
        <label className="field">
          <span>{t('password')}</span>
          <input
            className="input"
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="••••••"
          />
        </label>

        <button className="btn btn-primary" type="submit" disabled={busy}>
          <Icon name="lock" size={16} /> {busy ? t('loading') : t('login')}
        </button>

        <p className="tiny center" style={{ marginTop: 14 }}>
          {t('noAccount')} <a onClick={() => nav('/register')}>{t('register')}</a>
        </p>

        {/*
          Sandi contoh hanya berlaku pada data demo di perangkat ini.
          Saat memakai server, sandi superadmin ditentukan operator lewat
          WJW_SUPERADMIN_PASSWORD, jadi menampilkannya di sini justru
          menyesatkan: pengguna mencobanya lalu ditolak.
        */}
        {offline && (
          <>
            <div className="divider" />
            <div className="card card-tight">
              <div className="tiny strong" style={{ marginBottom: 6 }}>
                <Icon name="key" size={12} /> {t('demoLogins')}
              </div>
              <div className="tiny">
                Superadmin: <b>{SUPERADMIN_EMAIL}</b> / <b>superadmin</b>
              </div>
              <div className="tiny" style={{ marginTop: 6 }}>
                {t('demoLocalOnly')}
              </div>
            </div>
          </>
        )}
      </form>

      <Sheet open={help} onClose={() => setHelp(false)} title={t('forgotPassword')}>
        <p className="tiny" style={{ whiteSpace: 'pre-line', lineHeight: 1.7 }}>
          {t('forgotPasswordHelp')}
        </p>
      </Sheet>
    </div>
  )
}
