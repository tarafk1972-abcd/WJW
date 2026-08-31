import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  AUTH_CHANGED_EVENT,
  SESSION_EXPIRED_EVENT,
  authApi,
  getToken,
  setToken,
} from './api'
import {
  communityById,
  getSessionId,
  getStoredLang,
  loadDB,
  memberById,
  planState,
  resetDB,
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
import type { Community, DBShape, Lang, ManagementScope, Member } from './types'

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
  /** Hak tulis mandat operasional, diputuskan dari assignment server. */
  canManageScope: (scope: ManagementScope) => boolean
  /** Pendiri komunitas/superadmin boleh menunjuk Admin 1/2/3. */
  canAssignManagementResponsibilities: boolean
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
  const [token, setTokenState] = useState<string | null>(() => getToken())
  const [booted, setBooted] = useState(() => !getToken())

  // `storage` hanya datang dari tab lain. API dispatch event ini di tab yang
  // sama agar login/daftar langsung memulai SSE tanpa reload halaman.
  useEffect(() => {
    const updateToken = () => setTokenState(getToken())
    const expire = () => {
      // Token invalid tidak boleh meninggalkan state SOS/tamu pada perangkat
      // bersama. Bahasa perangkat tetap dipertahankan oleh resetDB.
      resetDB()
      updateToken()
      refresh()
    }
    window.addEventListener(AUTH_CHANGED_EVENT, updateToken)
    window.addEventListener(SESSION_EXPIRED_EVENT, expire)
    window.addEventListener('storage', updateToken)
    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, updateToken)
      window.removeEventListener(SESSION_EXPIRED_EVENT, expire)
      window.removeEventListener('storage', updateToken)
    }
  }, [refresh])

  useEffect(() => {
    if (!token) {
      setBooted(true)
      return
    }
    setBooted(false)
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
  }, [refresh, token])

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

  const isAdmin = me?.role === 'admin' || me?.role === 'superadmin'
  const isSuperadmin = me?.role === 'superadmin'
  const isSatpam = me?.role === 'satpam'
  const localCanAssignResponsibilities =
    !!me && !!community && (isSuperadmin || (me.role === 'admin' && community.createdBy === me.id))
  // Pada mode server, jadikan jawaban server sebagai petunjuk UI. Otorisasi
  // write tetap diperiksa ulang endpoint agar cache/peramban tidak dipercaya.
  const canAssignManagementResponsibilities = apiMode()
    ? db.canAssignManagementResponsibilities
    : localCanAssignResponsibilities
  const canManageScope = useCallback(
    (scope: ManagementScope) => {
      if (!me || !community) return false
      if (me.role === 'superadmin') return true
      if (me.role !== 'admin') return false
      const assigned = db.managementResponsibilities.find(
        (responsibility) =>
          responsibility.communityId === community.id && responsibility.scope === scope,
      )
      // Selaras dengan fallback backend untuk tenant yang belum menetapkan
      // pemegang mandat eksplisit: pendiri memegangnya lebih dulu.
      return assigned ? assigned.memberId === me.id : community.createdBy === me.id
    },
    [db.managementResponsibilities, me, community],
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
    // Mulai revoke sesi saat token masih tersedia, lalu hapus token/cache
    // segera. Dengan begitu layar perangkat bersama tidak menahan data SOS,
    // tamu, maupun daftar warga sambil request logout berjalan.
    if (getToken()) void authApi.logout()
    setToken(null)
    resetDB()
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
    isAdmin,
    isSuperadmin,
    isSatpam,
    canManageScope,
    canAssignManagementResponsibilities,
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
