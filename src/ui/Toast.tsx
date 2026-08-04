import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react'

type Kind = 'ok' | 'err' | 'info'
type Item = { id: number; msg: string; kind: Kind }

const Ctx = createContext<(msg: string, kind?: Kind) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([])

  const push = useCallback((msg: string, kind: Kind = 'ok') => {
    const id = Date.now() + Math.random()
    setItems((v) => [...v, { id, msg, kind }])
    setTimeout(() => setItems((v) => v.filter((i) => i.id !== id)), 3200)
  }, [])

  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toast-wrap">
        {items.map((i) => (
          <div key={i.id} className={`toast ${i.kind}`}>
            <span>{i.kind === 'ok' ? '✅' : i.kind === 'err' ? '⚠️' : 'ℹ️'}</span>
            <span>{i.msg}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast() {
  return useContext(Ctx)
}
