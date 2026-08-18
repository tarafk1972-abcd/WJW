/**
 * Kolom kata sandi dengan tombol untuk melihat apa yang diketik.
 *
 * Di ponsel, mengetik sandi tanpa bisa memeriksanya adalah sebab umum
 * kegagalan masuk — huruf besar/kecil tertukar, atau papan ketik
 * menyisipkan spasi. Tombol mata membuat pengguna bisa memastikan
 * ketikannya sebelum menekan Masuk.
 *
 * Bawaannya tetap tersembunyi: sandi hanya terlihat bila diminta.
 */
import { useId, useState } from 'react'
import { useApp } from '../lib/store'
import { Icon } from './Icon'

export function PasswordField({
  label,
  value,
  onChange,
  placeholder = '••••••',
  autoComplete,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoComplete?: string
  /** Keterangan kecil di bawah kolom, mis. syarat panjang minimum. */
  hint?: string
}) {
  const { t } = useApp()
  const [shown, setShown] = useState(false)
  const hintId = useId()

  return (
    <label className="field">
      <span>{label}</span>
      <div className="pw-wrap">
        <input
          className="input pw-input"
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby={hint ? hintId : undefined}
        />
        <button
          type="button"
          className="pw-toggle"
          // Tombol ini bukan bagian dari isian, jadi lewati saat menekan Tab.
          tabIndex={-1}
          aria-label={shown ? t('hidePassword') : t('showPassword')}
          aria-pressed={shown}
          title={shown ? t('hidePassword') : t('showPassword')}
          onClick={() => setShown((v) => !v)}
        >
          <Icon name={shown ? 'eyeOff' : 'eye'} size={17} />
        </button>
      </div>
      {hint && (
        <span id={hintId} className="tiny pw-hint">
          {hint}
        </span>
      )}
    </label>
  )
}
