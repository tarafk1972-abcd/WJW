import { useState } from 'react'
import { useNavigate } from 'react-router'
import { saveEmergencyProfile } from '../lib/db'
import { useApp } from '../lib/store'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/Toast'

const BLOOD = ['-', 'A', 'B', 'AB', 'O']

/**
 * Biographical / medical details handed to responders when this member raises
 * a panic alert (SaferWatch shares an emergency profile with dispatchers).
 */
export default function EmergencyProfilePage() {
  const { me, t } = useApp()
  const nav = useNavigate()
  const toast = useToast()
  const e = me?.emergency

  const [bloodType, setBloodType] = useState(e?.bloodType ?? '-')
  const [allergies, setAllergies] = useState(e?.allergies ?? '')
  const [conditions, setConditions] = useState(e?.conditions ?? '')
  const [contactName, setContactName] = useState(e?.contactName ?? '')
  const [contactPhone, setContactPhone] = useState(e?.contactPhone ?? '')
  const [notes, setNotes] = useState(e?.notes ?? '')

  if (!me) return null

  const save = () => {
    saveEmergencyProfile(me.id, {
      bloodType,
      allergies: allergies.trim(),
      conditions: conditions.trim(),
      contactName: contactName.trim(),
      contactPhone: contactPhone.trim(),
      notes: notes.trim(),
    })
    toast(t('profileSaved'))
    nav(-1)
  }

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="icon-btn" onClick={() => nav(-1)}>
          <Icon name="chevronLeft" size={18} />
        </button>
        <h2 className="grow" style={{ fontSize: 20, fontWeight: 800 }}>
          {t('emergencyProfile')}
        </h2>
      </div>

      <div className="banner banner-info">
        <Icon name="info" size={17} />
        <span>{t('emergencyProfileHint')}</span>
      </div>

      <label className="field">
        <span>{t('bloodType')}</span>
        <select
          className="select"
          value={bloodType}
          onChange={(ev) => setBloodType(ev.target.value)}
        >
          {BLOOD.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t('allergies')}</span>
        <input
          className="input"
          value={allergies}
          onChange={(ev) => setAllergies(ev.target.value)}
          placeholder="—"
        />
      </label>
      <label className="field">
        <span>{t('conditions')}</span>
        <input
          className="input"
          value={conditions}
          onChange={(ev) => setConditions(ev.target.value)}
          placeholder="—"
        />
      </label>
      <label className="field">
        <span>{t('contactName')}</span>
        <input
          className="input"
          value={contactName}
          onChange={(ev) => setContactName(ev.target.value)}
        />
      </label>
      <label className="field">
        <span>{t('contactPhone')}</span>
        <input
          className="input"
          value={contactPhone}
          onChange={(ev) => setContactPhone(ev.target.value)}
          inputMode="tel"
        />
      </label>
      <label className="field">
        <span>{t('medicalNotes')}</span>
        <textarea
          className="textarea"
          value={notes}
          onChange={(ev) => setNotes(ev.target.value)}
        />
      </label>

      <button className="btn btn-primary" onClick={save}>
        <Icon name="check" size={16} /> {t('save')}
      </button>
    </div>
  )
}
