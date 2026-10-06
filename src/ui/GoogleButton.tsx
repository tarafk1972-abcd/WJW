import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { authApi, ApiError } from '../lib/api'
import { deviceId, setSession } from '../lib/db'
import { syncState } from '../lib/sync'
import { inIframe, isNativePlatform } from '../lib/platform'
import { useApp } from '../lib/store'
import { useToast } from './Toast'
import type { Key } from '../lib/i18n'

/**
 * Tombol "Masuk dengan Google" untuk web/PWA.
 *
 * Memakai Google Identity Services (GIS): skrip dimuat dari accounts.google.com,
 * inisialisasi dengan client_id server, lalu merender tombol resmi Google.
 * Callback menerima `credential` (ID token), yang dikirim ke server untuk
 * diverifikasi dan dihubungkan ke akun anggota.
 *
 * Tidak dirender di dalam APK (jalur Capacitor menyusul) atau bila server
 * belum mengaktifkan Google (secret WJW_GOOGLE_CLIENT_ID belum terpasang).
 */
let scriptPromise: Promise<boolean> | null = null

function loadGisScript(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false)
  const w = window as unknown as { google?: { accounts?: unknown } }
  if (w.google?.accounts) return Promise.resolve(true)
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise<boolean>((resolve) => {
    if (document.querySelector('script[data-gsi-client]')) {
      // Skrip sudah terpasang; tunggu sebentar agar siap.
      resolve(Boolean(w.google?.accounts))
      return
    }
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.defer = true
    s.setAttribute('data-gsi-client', '')
    s.onload = () => resolve(Boolean(w.google?.accounts))
    s.onerror = () => resolve(false)
    document.head.appendChild(s)
  })
  return scriptPromise
}

interface GoogleIdentityApi {
  accounts: {
    id: {
      initialize: (opts: Record<string, unknown>) => void
      renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void
    }
  }
}

export function GoogleButton({ align = 'center' }: { align?: 'center' | 'stretch' }) {
  const { t } = useApp()
  const nav = useNavigate()
  const toast = useToast()
  const host = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'hidden' | 'error'>('loading')

  useEffect(() => {
    let alive = true

    // Di APK atau pratinjau tanpa jaringan, jangan tampilkan tombol Google.
    if (isNativePlatform() || inIframe()) {
      setState('hidden')
      return
    }

    authApi
      .googleConfig()
      .then(async (cfg) => {
        if (!alive) return
        if (!cfg.enabled || !cfg.clientId) {
          setState('hidden')
          return
        }
        const loaded = await loadGisScript()
        if (!alive || !loaded || !host.current) {
          if (alive) setState(loaded ? 'hidden' : 'error')
          return
        }
        const g = (window as unknown as { google?: GoogleIdentityApi }).google?.accounts
        if (!g?.id) {
          setState('error')
          return
        }
        g.id.initialize({
          client_id: cfg.clientId,
          callback: (res: { credential?: string; error?: string }) => {
            if (!res.credential) {
              toast(t('errLogin'), 'err')
              return
            }
            void googleSignIn(res.credential, nav, toast, t)
          },
          auto_select: false,
        })
        g.id.renderButton(host.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          text: 'signin_with',
          logo_alignment: 'left',
          width: align === 'stretch' ? '350' : 'auto',
        })
        setState('ready')
      })
      .catch(() => {
        if (alive) setState('hidden')
      })

    return () => {
      alive = false
    }
  }, [align, t, nav, toast])

  if (state === 'hidden') return null

  return (
    <div className="google-wrap" style={{ justifyContent: align === 'stretch' ? 'stretch' : 'center' }}>
      {state === 'ready' ? (
        <div ref={host} style={{ minHeight: 44, display: 'flex', justifyContent: 'inherit' }} />
      ) : state === 'error' ? (
        <p className="tiny center" style={{ color: 'var(--text-3)' }}>
          {t('googleUnavailable')}
        </p>
      ) : (
        <div className="google-skeleton" />
      )}
    </div>
  )
}

async function googleSignIn(
  credential: string,
  nav: (to: string) => void,
  toast: ReturnType<typeof useToast>,
  t: (key: Key) => string,
) {
  try {
    const res = await authApi.google(credential, deviceId())
    if (res.needRegister) {
      // Email Google belum terdaftar — arahkan ke pendaftaran, terisi emailnya.
      const email = (res as { email?: string }).email ?? ''
      const name = (res as { name?: string }).name ?? ''
      const q = new URLSearchParams({
        ...(email ? { email } : {}),
        ...(name ? { name } : {}),
        google: '1',
      })
      nav(`/register?${q.toString()}`)
      return
    }
    const m = res.member as { id: string; role: string; status: string }
    setSession(m.id)
    await syncState()
    if (m.role === 'superadmin') nav('/console')
    else if (m.status === 'active') nav('/app')
    else nav('/pending')
  } catch (e) {
    if (e instanceof ApiError && e.code === 'tenant_suspended') {
      toast(t('tenantSuspended'), 'err')
      return
    }
    toast(t('errLogin'), 'err')
  }
}
