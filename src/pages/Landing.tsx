import { useNavigate } from 'react-router'
import { deviceId, setSession } from '../lib/db'
import { LANGS } from '../lib/i18n'
import { seedDemo } from '../lib/seed'
import { useApp } from '../lib/store'
import { Icon } from '../ui/Icon'
import type { Member } from '../lib/types'

/**
 * Public entry screen.
 * If this device already belongs to an approved member, the "Register" button is
 * replaced by the greeting "Apa kabar hari ini, <nama>?" as requested.
 */
export default function Landing() {
  const { db, t, lang, setLang } = useApp()
  const nav = useNavigate()
  const dev = deviceId()

  const deviceMember: Member | undefined = db.members.find(
    (m) => m.deviceId === dev && m.status !== 'rejected',
  )
  const approved = deviceMember?.status === 'active'
  const pending = deviceMember?.status === 'pending'

  const enter = () => {
    if (deviceMember) setSession(deviceMember.id)
    nav(approved ? '/app' : '/pending')
  }

  return (
    <div className="landing">
      <div className="row" style={{ marginBottom: 6 }}>
        <div className="brand-mark">WJW</div>
        <div className="grow">
          <div style={{ fontWeight: 800, fontSize: 15 }}>{t('appName')}</div>
          <div className="tiny">{t('appTagline')}</div>
        </div>
      </div>

      <div className="landing-hero">
        {approved && deviceMember ? (
          <>
            <div
              className="chip chip-brand"
              style={{ alignSelf: 'flex-start' }}
            >
              <Icon name="check" size={13} /> {t('active')}
            </div>
            <h1>{t('greeting', { name: deviceMember.name.split(' ')[0] })}</h1>
            <p className="lead">{t('greetingSub')}</p>
          </>
        ) : pending && deviceMember ? (
          <>
            <div className="chip chip-warn" style={{ alignSelf: 'flex-start' }}>
              <Icon name="clock" size={13} /> {t('pending')}
            </div>
            <h1>{t('waitingApproval')}</h1>
            <p className="lead">{t('waitingApprovalBody')}</p>
          </>
        ) : (
          <>
            <h1>
              {t('appName')}
              <br />
              <span style={{ color: 'var(--brand)' }}>{t('appTagline')}</span>
            </h1>
            <p className="lead">{t('firstResidentNote')}</p>

            <div className="col" style={{ gap: 12, marginTop: 6 }}>
              <Feature
                icon="alert"
                color="var(--danger)"
                bg="var(--danger-soft)"
                text={t('sosHold')}
              />
              <Feature
                icon="map"
                color="var(--brand)"
                bg="var(--brand-soft)"
                text={t('areaEditorHint')}
              />
              <Feature
                icon="door"
                color="var(--info)"
                bg="var(--info-soft)"
                text={t('guests')}
              />
              <Feature
                icon="gift"
                color="var(--warn)"
                bg="var(--warn-soft)"
                text={`${t('trial')} ${14} ${t('days')}`}
              />
            </div>
          </>
        )}
      </div>

      {!deviceMember && (
        <div style={{ marginBottom: 16 }}>
          <div className="tiny" style={{ marginBottom: 8 }}>
            <Icon name="globe" size={12} /> {t('chooseLanguage')}
          </div>
          <div className="lang-pills">
            {LANGS.map((l) => (
              <button
                key={l.code}
                className={`lang-pill ${lang === l.code ? 'on' : ''}`}
                onClick={() => setLang(l.code)}
              >
                {l.flag} {l.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="col" style={{ gap: 9 }}>
        {deviceMember ? (
          <button className="btn btn-primary" onClick={enter}>
            <Icon name="chevronRight" size={17} />
            {approved ? t('enter') : t('waitingApproval')}
          </button>
        ) : (
          <>
            <button
              className="btn btn-primary"
              onClick={() => nav('/register')}
            >
              <Icon name="plus" size={17} /> {t('registerNow')}
            </button>
            <button className="btn btn-ghost" onClick={() => nav('/login')}>
              <Icon name="lock" size={16} /> {t('login')}
            </button>
            {db.communities.length === 0 && (
              <button
                className="btn btn-ghost"
                style={{ borderStyle: 'dashed' }}
                onClick={() => {
                  const id = seedDemo()
                  if (id) nav('/app')
                }}
              >
                <Icon name="gift" size={16} /> {t('demoData')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Feature({
  icon,
  color,
  bg,
  text,
}: {
  icon: Parameters<typeof Icon>[0]['name']
  color: string
  bg: string
  text: string
}) {
  return (
    <div className="feature-row">
      <div className="ic" style={{ background: bg, color }}>
        <Icon name={icon} size={17} />
      </div>
      <span className="grow" style={{ lineHeight: 1.4 }}>
        {text}
      </span>
    </div>
  )
}
