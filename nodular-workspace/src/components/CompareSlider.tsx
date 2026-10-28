import { useRef, useState } from 'react'

const checker = 'repeating-conic-gradient(#1a1a1a 0% 25%, #2a2a2a 0% 50%) 0 / 20px 20px'

export function CompareSlider({ before, after, checkerboard = false }: { before: string; after: string; checkerboard?: boolean }) {
  const [pos, setPos] = useState(50)
  const ref = useRef<HTMLDivElement>(null)

  const move = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    setPos(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)))
  }

  return (
    <div
      ref={ref}
      className="nodrag"
      onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); move(e.clientX) }}
      onPointerMove={(e) => { if (e.buttons) move(e.clientX) }}
      style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid #333', background: checkerboard ? checker : '#000', cursor: 'ew-resize', touchAction: 'none', userSelect: 'none' }}
    >
      <img src={after} draggable={false} style={{ width: '100%', display: 'block' }} />
      <div style={{ position: 'absolute', inset: 0, clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        <img src={before} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      </div>
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${pos}%`, width: 2, background: '#fff', boxShadow: '0 0 6px rgba(0,0,0,.6)' }} />
      <span style={{ position: 'absolute', left: 6, top: 6, fontSize: 9, background: 'rgba(0,0,0,.6)', padding: '2px 5px', borderRadius: 4 }}>BEFORE</span>
      <span style={{ position: 'absolute', right: 6, top: 6, fontSize: 9, background: 'rgba(0,0,0,.6)', padding: '2px 5px', borderRadius: 4 }}>AFTER</span>
    </div>
  )
}
