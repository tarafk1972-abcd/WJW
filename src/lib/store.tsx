import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { authApi, getToken } from './api'
import {
  communityById,
  getSessionId,
  getStoredLang,
  loadDB,
  memberById,
  planState,
  setSession,
  storeLang,
} from './db'
import {
  apiMode,
  isLocationWanted,
  lastSyncError,
  startRealtimeSync,
  syncState,
} from './sync'
import { DEFAULT_LANG, translate, type Key } from './i18n'
import type { Community, DBShape, Lang, Member } from './types'

interface Ctx {
  db: DBShape
  me: Member | null
  community: Community | null
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: Key, vars?: Record<string, string | number>) => string
  refresh: () => void
  signOut: () => void
  plan: ReturnType<typeof planState> | null
  isAdmin: boolean
  isSuperadmin: boolean
  isSatpam: boolean
  /** true bila aplikasi terhubung ke server (bukan mode lokal saja). */
  online: boolean
  /** Kode error sinkronisasi terakhir, mis. 'errOffline'. */
  syncError: string | null
  /** Ada darurat berlangsung: aplikasi boleh mengirim posisi sekali. */
  locationWanted: boolean
  /** Tarik ulang data dari server. */
  reload: () => Promise<void>
}

const AppCtx = createContext<Ctx | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [tick, setTick] = useState(0)
  const [langState, setLangState] = useState<Lang>(
    () => getStoredLang() ?? DEFAULT_LANG,
  )

  const refresh = useCallback(() => setTick((x) => x + 1), [])

  // Sinkronisasi pertama harus selesai sebelum UI memutuskan pengguna
  // belum login — kalau tidak, layar akan salah mengalihkan ke halaman depan.
  const [booted, setBooted] = useState(() => !getToken())

  useEffect(() => {
    if (!apiMode()) {
      setBooted(true)
      return
    }
    let alive = true
    void syncState().then(() => {
      if (!alive) return
      setBooted(true)
      refresh()
    })
    // SSE memberi tahu dalam hitungan detik saat ada insiden/pesan/status
    // baru. State tetap ditarik dari API agar otorisasi server selalu berlaku.
    const stop = startRealtimeSync(refresh)
    const onOnline = () => void syncState().then(refresh)
    window.addEventListener('online', onOnline)
    return () => {
      alive = false
      stop()
      window.removeEventListener('online', onOnline)
    }
  }, [refresh])

  const reload = useCallback(async () => {
    await syncState()
    refresh()
  }, [refresh])

  useEffect(() => {
    const h = () => refresh()
    window.addEventListener('wjw:db', h)
    window.addEventListener('storage', h)
    return () => {
      window.removeEventListener('wjw:db', h)
      window.removeEventListener('storage', h)
    }
  }, [refresh])

  const db = useMemo(() => {
    void tick
    return loadDB()
  }, [tick])

  // Saat memakai server, identitas berasal dari token; jika tidak, dari sesi lokal.
  const me = useMemo(() => {
    void tick
    const local = memberById(db, getSessionId())
    if (local) return local
    if (!getToken()) return null
    // sesi lokal belum ada — pakai anggota yang datanya lengkap dari server
    return db.members.find((m) => m.id === getSessionId()) ?? null
  }, [db, tick])
  const community = useMemo(
    () => communityById(db, me?.communityId ?? null),
    [db, me, tick],
  )

  // Member language wins over the device default once signed in.
  const lang: Lang = me?.language ?? langState

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    storeLang(l)
  }, [])

  const t = useCallback(
    (key: Key, vars?: Record<string, string | number>) =>
      translate(lang, key, vars),
    [lang],
  )

  const signOut = useCallback(() => {
    if (apiMode()) void authApi.logout()
    setSession(null)
    refresh()
  }, [refresh])

  const value: Ctx = {
    db,
    me,
    community,
    lang,
    setLang,
    t,
    refresh,
    signOut,
    plan: community ? planState(community) : null,
    online: apiMode(),
    syncError: lastSyncError(),
    locationWanted: isLocationWanted(),
    reload,
    isAdmin: me?.role === 'admin' || me?.role === 'superadmin',
    isSuperadmin: me?.role === 'superadmin',
    isSatpam: me?.role === 'satpam',
  }

  // Tampilkan layar tunggu singkat, bukan halaman kosong yang menyesatkan.
  if (!booted) {
    return (
      <div className="boot">
        <div className="brand-mark">WJW</div>
        <span className="tiny">{translate(lang, 'loading')}</span>
      </div>
    )
  }

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

export function useApp(): Ctx {
  const c = useContext(AppCtx)
  if (!c) throw new Error('useApp must be used inside AppProvider')
  return c
}

export function useT() {
  return useApp().t
}
