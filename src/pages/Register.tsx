import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ApiError, authApi, publicApi } from '../lib/api'
import { deviceId, lookupInvite, register, searchCommunities, setSession } from '../lib/db'
import { markHomeOnRegister } from '../lib/presence'
import { syncState } from '../lib/sync'
import { LANGS, translate } from '../lib/i18n'
import { useApp } from '../lib/store'
import { Icon } from '../ui/Icon'
import { PasswordField } from '../ui/PasswordField'
import { QrScanner } from '../ui/QrScanner'
import { Sheet } from '../ui/Sheet'
import { useToast } from '../ui/Toast'
import type { Key } from '../lib/i18n'
import type { Community, Lang, Role } from '../lib/types'

const DEFAULT_CENTER = { lat: -6.9829, lng: 107.5197 } // Soreang, West Java

type Path = 'invite' | 'search' | 'create'
type Step = 'lang' | 'how' | 'community' | 'profile'

function roleLabel(r: Role): Key {
  return r === 'admin' ? 'roleAdmin' : r === 'satpam' ? 'roleSatpam' : 'roleWarga'
}

export default function Register() {
  const { db, lang, setLang } = useApp()
  const nav = useNavigate()
  const toast = useToast()
  const { code: codeParam } = useParams<{ code: string }>()

  const [step, setStep] = useState<Step>(codeParam ? 'community' : 'lang')
  const [path, setPath] = useState<Path>(codeParam ? 'invite' : 'invite')
  const [chosenLang, setChosenLang] = useState<Lang>(lang)

  // invite path
  const [code, setCode] = useState(codeParam ?? '')
  const [scanOpen, setScanOpen] = useState(false)
  const [invitedRole, setInvitedRole] = useState<Role | null>(null)

  // search path
  const [query, setQuery] = useState('')

  // resolved target
  const [picked, setPicked] = useState<Community | null>(() => {
    if (!codeParam) return null
    const res = lookupInvite(codeParam)
    return res.ok ? res.community : null
  })
  const [joinNote, setJoinNote] = useState('')

  // create path
  const [cName, setCName] = useState('')
  const [cAddress, setCAddress] = useState('')
  const [cCity, setCCity] = useState('')

  // profile
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [house, setHouse] = useState('')
  const [err, setErr] = useState<Key | ''>('')

  const tr = (k: Key, v?: Record<string, string | number>) => translate(chosenLang, k, v)

  const [remote, setRemote] = useState<Community[] | null>(null)
  useEffect(() => {
    let alive = true
    publicApi
      .searchCommunities(query)
      .then((r) => alive && setRemote(r.communities as unknown as Community[]))
      .catch(() => alive && setRemote(null))
    return () => {
      alive = false
    }
  }, [query])

  // Hasil server bila tersedia; jika offline, pakai data lokal.
  const results = useMemo(
    () => remote ?? searchCommunities(query),
    [remote, query, db.communities],
  )

  const pickLang = (l: Lang) => {
    setChosenLang(l)
    setLang(l)
  }

  /** Kode ini hanya dikenal data di perangkat ini, bukan oleh server. */
  const [localInvite, setLocalInvite] = useState(false)

  const applyCode = async (raw: string) => {
    setErr('')
    try {
      const r = await publicApi.lookupInvite(raw)
      setPicked(r.community as unknown as Community)
      setInvitedRole(r.invite.role as Role)
      setCode(r.invite.code)
      setLocalInvite(false)
      toast(tr('codeValid'))
      return true
    } catch (e) {
      const unreachable = e instanceof ApiError && e.status === 0

      /*
       * Server menjawab tetapi tidak mengenal kodenya.
       *
       * Itu belum tentu kode yang salah: undangan yang dibuat saat luring
       * — termasuk yang berasal dari data contoh — hanya ada di peramban
       * ini. Dulu jalur ini langsung menyalahkan kodenya, padahal
       * pemuatan lewat tautan /join/:code justru menerimanya dari data
       * lokal. Dua jalur, dua jawaban berbeda untuk kode yang sama.
       *
       * Jadi coba data lokal dulu, dan hanya menolak bila di sana pun
       * kodenya tidak ada.
       */
      if (!unreachable) {
        const local = lookupInvite(raw)
        if (local.ok) {
          setPicked(local.community)
          setInvitedRole(local.invite.role)
          setCode(local.invite.code)
          setLocalInvite(true)
          toast(tr('codeValid'))
          return true
        }
        setInvitedRole(null)
        setPicked(null)
        setErr((e instanceof ApiError ? e.code : 'errInvite') as Key)
        return false
      }

      // Server tidak terjangkau: beri tahu pengguna, lalu coba data lokal.
      setOffline(true)
      const res = lookupInvite(raw)
      if (!res.ok) {
        setInvitedRole(null)
        setPicked(null)
        setErr(res.error)
        return false
      }
      setPicked(res.community)
      setInvitedRole(res.invite.role)
      setCode(res.invite.code)
      setLocalInvite(true)
      toast(tr('codeValid'))
      return true
    }
  }

  const back = () => {
    setErr('')
    if (step === 'profile') setStep('community')
    else if (step === 'community') setStep('how')
    else if (step === 'how') setStep('lang')
    else nav('/')
  }

  const goProfile = () => {
    setErr('')
    if (path === 'create') {
      if (!cName.trim()) return setErr('errRequired')
    } else if (!picked) {
      return setErr('errNoCommunity')
    }
    setStep('profile')
  }

  const [busy, setBusy] = useState(false)
  const [offline, setOffline] = useState(false)

  const submit = async () => {
    setErr('')
    if (!name.trim() || !phone.trim() || !email.trim() || !password || !house.trim())
      return setErr('errRequired')
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setErr('errEmail')
    if (phone.replace(/\D/g, '').length < 8) return setErr('errPhone')
    if (password.length < 6) return setErr('errPasswordShort')

    const payload = {
      name,
      phone,
      email,
      password,
      house,
      language: chosenLang,
      mode: (path === 'create' ? 'create' : 'join') as 'create' | 'join',
      communityId: picked?.id,
      communityName: cName,
      communityAddress: cAddress,
      city: cCity,
      center: DEFAULT_CENTER,
      inviteCode: path === 'invite' ? code : '',
      joinNote,
    }

    setBusy(true)
    try {
      const res = await authApi.register({ ...payload, deviceId: deviceId() })
      const m = res.member as { id: string; status: string }
      setSession(m.id)
      /*
       * Tandai letak rumah sekarang: saat mendaftar, warga biasanya
       * memang sedang di rumahnya. Titik inilah yang nanti membuat ia
       * tetap terhitung sebagai tetangga terdekat walau aplikasinya
       * tertutup. Tidak ditunggu — pendaftaran tidak boleh tertahan
       * hanya karena GPS lambat.
       */
      void markHomeOnRegister()
      await syncState()
      setBusy(false)
      if (m.status === 'active') {
        toast(tr('youAreFirst'))
        nav('/app')
      } else {
        toast(tr('requestSent'))
        nav('/pending')
      }
      return
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 0)) {
        setBusy(false)
        return setErr((e instanceof ApiError ? e.code : 'errRequired') as Key)
      }
      setOffline(true)
    }

    // offline: daftar ke penyimpanan lokal
    const res = register(payload)
    setBusy(false)
    if (!res.ok) return setErr(res.error as Key)
    if (res.member.status === 'active') {
      toast(tr('youAreFirst'))
      nav('/app')
    } else {
      toast(tr('requestSent'))
      nav('/pending')
    }
  }

  const stepIndex = { lang: 0, how: 1, community: 2, profile: 3 }[step]

  return (
    <div className="shell">
      <div className="topbar">
        <button className="icon-btn" onClick={back}>
          <Icon name="chevronLeft" size={18} />
        </button>
        <div className="grow">
          <h1>{tr('registerTitle')}</h1>
          <div className="sub">
            {tr('appName')} · {stepIndex + 1}/4
          </div>
        </div>
      </div>

      <div className="page no-nav">
        <div className="stepper">
          {[0, 1, 2, 3].map((i) => (
            <i key={i} className={i <= stepIndex ? 'on' : ''} />
          ))}
        </div>

        {err && <div className="error-box">{tr(err)}</div>}

        {offline && !err && (
          <div className="banner banner-warn">
            <Icon name="info" size={17} />
            <span>
              {tr('serverDown')}
              <br />
              <span className="tiny">{tr('serverDownHint')}</span>
            </span>
          </div>
        )}

        {/* ---------------- 1. language ---------------- */}
        {step === 'lang' && (
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
              onClick={() => setStep('how')}
            >
              {tr('next')} <Icon name="chevronRight" size={17} />
            </button>
          </>
        )}

        {/* ---------------- 2. how do you want to join ---------------- */}
        {step === 'how' && (
          <>
            <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>
              {tr('howToJoin')}
            </h2>
            <p className="muted" style={{ marginBottom: 16 }}>
              {tr('joinOrCreate')}
            </p>

            <Choice
              icon="key"
              color="var(--brand)"
              bg="var(--brand-soft)"
              title={tr('optInvite')}
              sub={tr('optInviteSub')}
              onClick={() => {
                setPath('invite')
                setStep('community')
              }}
            />
            <Choice
              icon="search"
              color="var(--info)"
              bg="var(--info-soft)"
              title={tr('optSearch')}
              sub={tr('optSearchSub')}
              onClick={() => {
                setPath('search')
                setPicked(null)
                setStep('community')
              }}
            />
            <Choice
              icon="building"
              color="var(--purple)"
              bg="rgba(163,113,247,.16)"
              title={tr('optCreate')}
              sub={tr('optCreateSub')}
              onClick={() => {
                setPath('create')
                setPicked(null)
                setStep('community')
              }}
            />

            <div className="disclaimer" style={{ marginTop: 16 }}>
              <Icon name="info" size={15} />
              <span>{tr('approvalRequired')}</span>
            </div>
          </>
        )}

        {/* ---------------- 3. community ---------------- */}
        {step === 'community' && path === 'invite' && (
          <>
            <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>
              {tr('enterCode')}
            </h2>
            <p className="muted" style={{ marginBottom: 16 }}>
              {tr('optInviteSub')}
            </p>

            <input
              className="input code-input"
              value={code}
              maxLength={12}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase())
                setPicked(null)
                setInvitedRole(null)
                setErr('')
              }}
              placeholder={tr('codePlaceholder')}
              aria-label={tr('enterCode')}
            />

            <div className="btn-row" style={{ marginTop: 10 }}>
              <button
                className="btn btn-ghost grow"
                onClick={() => setScanOpen(true)}
              >
                <Icon name="camera" size={16} /> {tr('scanQr')}
              </button>
              <button
                className="btn btn-primary grow"
                disabled={!code.trim()}
                onClick={() => void applyCode(code)}
              >
                <Icon name="check" size={16} /> {tr('checkCode')}
              </button>
            </div>

            {picked && (
              <>
                <div className="banner banner-brand" style={{ marginTop: 16 }}>
                  <Icon name="check" size={17} />
                  <span>
                    <b>{picked.name}</b>
                    {picked.city ? ` · ${picked.city}` : ''}
                    {invitedRole && (
                      <>
                        <br />
                        {tr('inviteRole')}: {tr(roleLabel(invitedRole))}
                      </>
                    )}
                  </span>
                </div>

                {/*
                  Undangan yang hanya ada di peramban ini: pendaftarannya
                  tidak akan sampai ke admin sungguhan. Katakan sekarang,
                  bukan setelah warga menunggu persetujuan yang tak kunjung
                  datang.
                */}
                {localInvite && (
                  <div className="banner banner-warn">
                    <Icon name="info" size={17} />
                    <span>{tr('inviteLocalOnly')}</span>
                  </div>
                )}

                <label className="field">
                  <span>{tr('joinNote')}</span>
                  <textarea
                    className="textarea"
                    value={joinNote}
                    onChange={(e) => setJoinNote(e.target.value)}
                    placeholder={tr('joinNotePlaceholder')}
                  />
                </label>
                <div className="disclaimer" style={{ marginBottom: 14 }}>
                  <Icon name="info" size={15} />
                  <span>{tr('approvalRequiredInvite')}</span>
                </div>
                <button className="btn btn-primary" onClick={goProfile}>
                  {tr('next')} <Icon name="chevronRight" size={17} />
                </button>
              </>
            )}

            <Sheet open={scanOpen} onClose={() => setScanOpen(false)} title={tr('scanQr')}>
              <QrScanner
                onCode={(c) => {
                  setScanOpen(false)
                  void applyCode(c)
                }}
                onClose={() => setScanOpen(false)}
              />
            </Sheet>
          </>
        )}

        {step === 'community' && path === 'search' && (
          <>
            <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>
              {tr('optSearch')}
            </h2>
            <p className="muted" style={{ marginBottom: 14 }}>
              {tr('optSearchSub')}
            </p>

            <label className="field">
              <span>{tr('searchCommunity')}</span>
              <input
                className="input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="RW 05 / Bandung"
                aria-label={tr('searchCommunity')}
              />
            </label>

            {results.length === 0 ? (
              <div className="empty">
                <span className="em">🔎</span>
                {tr('searchEmpty')}
              </div>
            ) : (
              results.map((c) => {
                const count = db.members.filter(
                  (m) => m.communityId === c.id && m.status === 'active',
                ).length
                return (
                  <button
                    key={c.id}
                    className={`result-row ${picked?.id === c.id ? 'on' : ''}`}
                    onClick={() => setPicked(c)}
                  >
                    <div
                      className="item-icon"
                      style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
                    >
                      <Icon name="building" size={19} />
                    </div>
                    <div className="grow">
                      <div className="strong truncate">{c.name}</div>
                      <div className="tiny truncate">
                        {[c.address, c.city].filter(Boolean).join(' · ') || '—'}
                      </div>
                      <div className="tiny">
                        {count} {tr('members1')}
                      </div>
                    </div>
                    {picked?.id === c.id && (
                      <Icon name="check" size={18} color="var(--brand)" />
                    )}
                  </button>
                )
              })
            )}

            {picked && (
              <>
                <label className="field" style={{ marginTop: 16 }}>
                  <span>{tr('joinNote')}</span>
                  <textarea
                    className="textarea"
                    value={joinNote}
                    onChange={(e) => setJoinNote(e.target.value)}
                    placeholder={tr('joinNotePlaceholder')}
                  />
                </label>
                <div className="disclaimer" style={{ marginBottom: 14 }}>
                  <Icon name="info" size={15} />
                  <span>{tr('approvalRequired')}</span>
                </div>
                <button className="btn btn-primary" onClick={goProfile}>
                  <Icon name="send" size={16} /> {tr('requestToJoin')}
                </button>
              </>
            )}
          </>
        )}

        {step === 'community' && path === 'create' && (
          <>
            <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>
              {tr('optCreate')}
            </h2>
            <p className="muted" style={{ marginBottom: 16 }}>
              {tr('firstResidentNote')}
            </p>

            <label className="field">
              <span>{tr('communityName')} *</span>
              <input
                className="input"
                value={cName}
                onChange={(e) => setCName(e.target.value)}
                placeholder="RW 05 Griya Soreang"
              />
              {/* Nama tempat, bukan nama orang — lihat catatan di db.ts. */}
              <span className="tiny pw-hint">{tr('communityNameHint')}</span>
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

            <div className="banner banner-brand">
              <Icon name="crown" size={17} />
              <span>{tr('youAreFirst')}</span>
            </div>

            <button className="btn btn-primary" onClick={goProfile}>
              {tr('next')} <Icon name="chevronRight" size={17} />
            </button>
          </>
        )}

        {/* ---------------- 4. profile ---------------- */}
        {step === 'profile' && (
          <>
            <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>
              {tr('profile')}
            </h2>
            <p className="muted" style={{ marginBottom: 14 }}>
              {path === 'create' ? cName : picked?.name}
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
            <PasswordField
              label={`${tr('password')} *`}
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              hint={tr('passwordHint')}
            />
            <label className="field">
              <span>{tr('house')} *</span>
              <input
                className="input"
                value={house}
                onChange={(e) => setHouse(e.target.value)}
                placeholder="Blok C No. 12"
              />
            </label>

            <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
              <Icon name="check" size={17} />{' '}
              {path === 'create' ? tr('createCommunity') : tr('requestToJoin')}
            </button>
            <p className="tiny center" style={{ marginTop: 12 }}>
              {tr('haveAccount')} <a onClick={() => nav('/login')}>{tr('login')}</a>
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function Choice({
  icon,
  color,
  bg,
  title,
  sub,
  onClick,
}: {
  icon: Parameters<typeof Icon>[0]['name']
  color: string
  bg: string
  title: string
  sub: string
  onClick: () => void
}) {
  return (
    <button className="choice" onClick={onClick}>
      <span className="ic" style={{ background: bg, color }}>
        <Icon name={icon} size={21} />
      </span>
      <span className="grow">
        <span className="strong" style={{ display: 'block', fontSize: 15 }}>
          {title}
        </span>
        <span className="tiny">{sub}</span>
      </span>
      <Icon name="chevronRight" size={17} color="var(--text-3)" />
    </button>
  )
}
