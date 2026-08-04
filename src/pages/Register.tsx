import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { register } from '../lib/db'
import { LANGS, translate } from '../lib/i18n'
import { useApp } from '../lib/store'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import type { Key } from '../lib/i18n'
import type { Lang } from '../lib/types'

const DEFAULT_CENTER = { lat: -6.9829, lng: 107.5197 } // Soreang, West Java

export default function Register() {
  const { db, lang, setLang } = useApp()
  const nav = useNavigate()
  const toast = useToast()

  const [step, setStep] = useState(0)
  const [chosenLang, setChosenLang] = useState<Lang>(lang)
  const [mode, setMode] = useState<'create' | 'join'>(
    db.communities.length ? 'join' : 'create',
  )
  const [communityId, setCommunityId] = useState(db.communities[0]?.id ?? '')
  const [cName, setCName] = useState('')
  const [cAddress, setCAddress] = useState('')
  const [cCity, setCCity] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [house, setHouse] = useState('')
  const [invite, setInvite] = useState('')
  const [err, setErr] = useState<Key | ''>('')

  const tr = (k: Key, v?: Record<string, string | number>) =>
    translate(chosenLang, k, v)

  const noCommunities = db.communities.length === 0

  const willBeFirstAdmin = useMemo(() => {
    if (mode === 'create') return true
    const c = db.communities.find((x) => x.id === communityId)
    if (!c) return false
    return !db.members.some(
      (m) => m.communityId === c.id && m.role === 'admin' && m.status === 'active',
    )
  }, [mode, communityId, db])

  const pickLang = (l: Lang) => {
    setChosenLang(l)
    setLang(l)
  }

  const submit = () => {
    setErr('')
    if (!name.trim() || !phone.trim() || !email.trim() || !password || !house.trim())
      return setErr('errRequired')
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setErr('errEmail')
    if (phone.replace(/\D/g, '').length < 8) return setErr('errPhone')
    if (password.length < 6) return setErr('errPasswordShort')
    if (mode === 'create' && !cName.trim()) return setErr('errRequired')
    if (mode === 'join' && !communityId) return setErr('errNoCommunity')

    const res = register({
      name,
      phone,
      email,
      password,
      house,
      language: chosenLang,
      mode,
      communityId,
      communityName: cName,
      communityAddress: cAddress,
      city: cCity,
      center: DEFAULT_CENTER,
      inviteCode: invite,
    })

    if (!res.ok) return setErr(res.error as Key)

    if (res.member.status === 'active') {
      toast(
        res.firstAdmin
          ? tr('youAreFirst')
          : tr('memberAccepted', {
              name: res.member.name,
              role: tr(('role' + cap(res.member.role)) as Key),
            }),
      )
      nav('/app')
    } else {
      nav('/pending')
    }
  }

  return (
    <div className="shell">
      <div className="topbar">
        <button className="icon-btn" onClick={() => (step ? setStep(step - 1) : nav('/'))}>
          <Icon name="chevronLeft" size={18} />
        </button>
        <div className="grow">
          <h1>{tr('registerTitle')}</h1>
          <div className="sub">
            {tr('appName')} · {step + 1}/3
          </div>
        </div>
      </div>

      <div className="page no-nav">
        <div className="stepper">
          {[0, 1, 2].map((i) => (
            <i key={i} className={i <= step ? 'on' : ''} />
          ))}
        </div>

        {err && <div className="error-box">{tr(err)}</div>}

        {step === 0 && (
          <>
            <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>
              {tr('chooseLanguage')}
            </h2>
            <p className="muted" style={{ marginBottom: 16 }}>
              {tr('languageHint')}
            </p>
            <div className="col" style={{ gap: 9 }}>
              {LANGS.map((l) => (
                <button
                  key={l.code}
                  className="list-link"
                  onClick={() => pickLang(l.code)}
                  style={
                    chosenLang === l.code
                      ? { borderColor: 'var(--brand)', background: 'var(--brand-soft)' }
                      : undefined
                  }
                >
                  <span style={{ fontSize: 22 }}>{l.flag}</span>
                  <span className="grow strong">{l.label}</span>
                  {chosenLang === l.code && (
                    <Icon name="check" size={18} color="var(--brand)" />
                  )}
                </button>
              ))}
            </div>
            <button
              className="btn btn-primary"
              style={{ marginTop: 22 }}
              onClick={() => setStep(1)}
            >
              {tr('next')} <Icon name="chevronRight" size={17} />
            </button>
          </>
        )}

        {step === 1 && (
          <>
            <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>
              {tr('community')}
            </h2>
            <p className="muted" style={{ marginBottom: 16 }}>
              {tr('firstResidentNote')}
            </p>

            <div className="tabs" style={{ marginBottom: 16 }}>
              <button
                className={mode === 'create' ? 'on' : ''}
                onClick={() => setMode('create')}
              >
                {tr('createCommunity')}
              </button>
              <button
                className={mode === 'join' ? 'on' : ''}
                onClick={() => !noCommunities && setMode('join')}
                disabled={noCommunities}
                style={noCommunities ? { opacity: 0.4 } : undefined}
              >
                {tr('joinCommunity')}
              </button>
            </div>

            {mode === 'create' ? (
              <>
                <label className="field">
                  <span>{tr('communityName')} *</span>
                  <input
                    className="input"
                    value={cName}
                    onChange={(e) => setCName(e.target.value)}
                    placeholder="RW 05 Griya Soreang"
                  />
                </label>
                <label className="field">
                  <span>{tr('communityAddress')}</span>
                  <input
                    className="input"
                    value={cAddress}
                    onChange={(e) => setCAddress(e.target.value)}
                    placeholder="Jl. Raya Soreang No. 1"
                  />
                </label>
                <label className="field">
                  <span>{tr('city')}</span>
                  <input
                    className="input"
                    value={cCity}
                    onChange={(e) => setCCity(e.target.value)}
                    placeholder="Bandung"
                  />
                </label>
              </>
            ) : (
              <>
                <label className="field">
                  <span>{tr('selectCommunity')} *</span>
                  <select
                    className="select"
                    value={communityId}
                    onChange={(e) => setCommunityId(e.target.value)}
                  >
                    {db.communities.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.city ? `· ${c.city}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>
                    {tr('inviteCode')}
                  </span>
                  <input
                    className="input"
                    value={invite}
                    onChange={(e) => setInvite(e.target.value.toUpperCase())}
                    placeholder="ABC123"
                    style={{ letterSpacing: 2, fontWeight: 700 }}
                  />
                </label>
              </>
            )}

            {willBeFirstAdmin && (
              <div className="banner banner-brand">
                <Icon name="crown" size={17} />
                <span>{tr('youAreFirst')}</span>
              </div>
            )}

            <button className="btn btn-primary" onClick={() => setStep(2)}>
              {tr('next')} <Icon name="chevronRight" size={17} />
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>
              {tr('profile')}
            </h2>
            <p className="muted" style={{ marginBottom: 16 }}>
              {tr('registerTitle')}
            </p>

            <label className="field">
              <span>{tr('name')} *</span>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Budi Santoso"
              />
            </label>
            <label className="field">
              <span>{tr('phone')} *</span>
              <input
                className="input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0812xxxxxxx"
                inputMode="tel"
              />
            </label>
            <label className="field">
              <span>{tr('email')} *</span>
              <input
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nama@email.com"
                inputMode="email"
                autoCapitalize="none"
              />
            </label>
            <label className="field">
              <span>{tr('password')} *</span>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••"
              />
            </label>
            <label className="field">
              <span>{tr('house')} *</span>
              <input
                className="input"
                value={house}
                onChange={(e) => setHouse(e.target.value)}
                placeholder="Blok C No. 12"
              />
            </label>

            <button className="btn btn-primary" onClick={submit}>
              <Icon name="check" size={17} /> {tr('register')}
            </button>
            <p className="tiny center" style={{ marginTop: 12 }}>
              {tr('trial')}: {14} {tr('days')} · {tr('haveAccount')}{' '}
              <a onClick={() => nav('/login')}>{tr('login')}</a>
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
