/**
 * Panel unggah gambar QRIS untuk superadmin.
 *
 * Dulu gambarnya harus ditaruh manual sebagai `public/qris.png` di server.
 * Itu tidak praktis: pemilik aplikasi belum tentu bisa menyentuh berkas
 * server, dan gambarnya hilang setiap kali aplikasi dibangun ulang.
 * Sekarang cukup diunggah dari sini.
 */
import { useRef, useState } from 'react'
import { billingApi, qrisApi } from '../lib/api'
import { useApp } from '../lib/store'
import { Icon } from './Icon'
import { useToast } from './Toast'

/** Sesuai batas di server (server/settings.ts). */
const MAX_BYTES = 1_000_000
const ACCEPT = ['image/png', 'image/jpeg', 'image/webp']

export function QrisUpload() {
  const { t } = useApp()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')

  // Tampilkan QRIS yang sedang berlaku.
  const load = async () => {
    try {
      const r = await billingApi.fetch()
      setPreview(r.qris.imageUrl || null)
      setName(r.qris.name)
      setPhone(r.qris.phone)
    } catch {
      setPreview(null)
    }
    setLoaded(true)
  }
  if (!loaded) void load()

  const pick = async (file: File) => {
    if (!ACCEPT.includes(file.type)) return toast(t('errQrisType'), 'err')
    if (file.size > MAX_BYTES) return toast(t('errQrisTooBig'), 'err')

    setBusy(true)
    try {
      const data = await toBase64(file)
      const r = await qrisApi.upload(file.type, data)
      setPreview(r.imageUrl)
      toast(t('qrisSaved'))
    } catch {
      toast(t('errUnknown'), 'err')
    }
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const remove = async () => {
    setBusy(true)
    try {
      await qrisApi.clear()
      setPreview(null)
      toast(t('qrisRemoved'))
    } catch {
      toast(t('errUnknown'), 'err')
    }
    setBusy(false)
  }

  const saveOwner = async () => {
    if (!name.trim()) return toast(t('errRequired'), 'err')
    setBusy(true)
    try {
      await qrisApi.owner(name.trim(), phone.trim())
      toast(t('qrisOwnerSaved'))
    } catch {
      toast(t('errUnknown'), 'err')
    }
    setBusy(false)
  }

  return (
    <>
      <div className="section-title">{t('qrisImage')}</div>
      <div className="card card-tight" style={{ textAlign: 'center' }}>
        {preview ? (
          <img src={preview} alt="QRIS" className="qris-img" />
        ) : (
          <div className="tiny qris-missing">{t('qrisNotSet')}</div>
        )}

        <p className="tiny" style={{ marginTop: 10, lineHeight: 1.5 }}>
          {t('qrisUploadHint')}
        </p>

        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT.join(',')}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void pick(f)
          }}
        />
        <button
          className="btn btn-primary"
          style={{ marginTop: 10 }}
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          <Icon name="camera" size={16} />{' '}
          {busy ? t('loading') : preview ? t('qrisReplace') : t('qrisUpload')}
        </button>
        {preview && (
          <button
            className="btn btn-ghost"
            style={{ marginTop: 8 }}
            disabled={busy}
            onClick={() => void remove()}
          >
            {t('qrisRemove')}
          </button>
        )}

        <label className="field" style={{ marginTop: 14, textAlign: 'left' }}>
          <span>{t('qrisOwnerName')}</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="FADLUL KHAIRA"
          />
        </label>
        <label className="field" style={{ textAlign: 'left' }}>
          <span>{t('qrisOwnerPhone')}</span>
          <input
            className="input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(+62)81****781"
          />
        </label>
        <button className="btn btn-ghost" disabled={busy} onClick={() => void saveOwner()}>
          {t('save')}
        </button>
      </div>
    </>
  )
}

/** Baca berkas menjadi base64 tanpa awalan data URL. */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error('read'))
    r.onload = () => {
      const s = String(r.result)
      const comma = s.indexOf(',')
      resolve(comma >= 0 ? s.slice(comma + 1) : s)
    }
    r.readAsDataURL(file)
  })
}
