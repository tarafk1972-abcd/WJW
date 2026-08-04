import { useState } from 'react'
import { useNavigate } from 'react-router'
import { SUPERADMIN_EMAIL, login } from '../lib/db'
import { useApp } from '../lib/store'
import { Icon } from '../ui/Icon'
import type { Key } from '../lib/i18n'

export default function Login() {
  const { t } = useApp()
  const nav = useNavigate()
  const [id, setId] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState<Key | ''>('')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    const res = login(id, pw)
    if (!res.ok) return setErr(res.error as Key)
    if (res.member.role === 'superadmin') nav('/console')
    else if (res.member.status === 'active') nav('/app')
    else nav('/pending')
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

      <form className="page no-nav" onSubmit={submit}>
        <div className="brand-mark" style={{ width: 54, height: 54, borderRadius: 17, fontSize: 18, margin: '10px auto 16px' }}>
          WJW
        </div>
        <h2 className="center" style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>
          {t('loginTitle')}
        </h2>
        <p className="muted center" style={{ marginBottom: 22 }}>
          {t('appTagline')}
        </p>

        {err && <div className="error-box">{t(err)}</div>}

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

        <button className="btn btn-primary" type="submit">
          <Icon name="lock" size={16} /> {t('login')}
        </button>

        <p className="tiny center" style={{ marginTop: 14 }}>
          {t('noAccount')} <a onClick={() => nav('/register')}>{t('register')}</a>
        </p>

        <div className="divider" />
        <div className="card card-tight">
          <div className="tiny strong" style={{ marginBottom: 6 }}>
            <Icon name="key" size={12} /> {t('demoLogins')}
          </div>
          <div className="tiny">
            Superadmin: <b>{SUPERADMIN_EMAIL}</b> / <b>superadmin</b>
          </div>
        </div>
      </form>
    </div>
  )
}
