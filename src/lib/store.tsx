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
  communityById,
  getSessionId,
  getStoredLang,
  loadDB,
  memberById,
  planState,
  setSession,
  storeLang,
} from './db'
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
}

const AppCtx = createContext<Ctx | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [tick, setTick] = useState(0)
  const [langState, setLangState] = useState<Lang>(
    () => getStoredLang() ?? DEFAULT_LANG,
  )

  const refresh = useCallback(() => setTick((x) => x + 1), [])

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

  const me = useMemo(() => memberById(db, getSessionId()), [db, tick])
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
    isAdmin: me?.role === 'admin' || me?.role === 'superadmin',
    isSuperadmin: me?.role === 'superadmin',
    isSatpam: me?.role === 'satpam',
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
