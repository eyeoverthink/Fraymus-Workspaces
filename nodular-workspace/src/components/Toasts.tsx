import { useEffect, useState } from 'react'

type Toast = { id: number; kind: 'error' | 'success' | 'info'; msg: string }
const listeners = new Set<(t: Toast) => void>()
let seq = 0

export function toast(kind: Toast['kind'], msg: string) {
  const t = { id: ++seq, kind, msg }
  listeners.forEach((l) => l(t))
}

const colors = { error: '#ef4444', success: '#22c55e', info: '#6366f1' }

export function Toasts() {
  const [items, setItems] = useState<Toast[]>([])
  useEffect(() => {
    const l = (t: Toast) => {
      setItems((s) => [...s, t])
      setTimeout(() => setItems((s) => s.filter((x) => x.id !== t.id)), 6000)
    }
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])
  return (
    <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360 }}>
      {items.map((t) => (
        <div key={t.id} role="alert" onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))}
          style={{ background: '#111', color: '#fff', border: `1px solid ${colors[t.kind]}`, borderLeft: `4px solid ${colors[t.kind]}`, padding: '10px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer', wordBreak: 'break-word' }}>
          {t.msg}
        </div>
      ))}
    </div>
  )
}
