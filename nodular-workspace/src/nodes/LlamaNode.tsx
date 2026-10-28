
import { Handle, Position, NodeProps } from '@xyflow/react'
export function LlamaNode({ data, selected }: NodeProps) {
  const d = data as any
  return (
    <div style={{ width: 300, background: selected ? '#1a102e' : '#111', border: `1px solid ${selected ? '#a78bfa' : '#333'}`, borderRadius: 12, padding: 12, boxShadow: selected ? '0 0 0 2px rgba(167,139,250,0.3)' : 'none' }}>
      <div style={{ fontSize: 10, color: '#a78bfa', marginBottom: 8, fontWeight: 700, letterSpacing: 0.5 }}>BRAIN • Groq Llama 3.3 70B • FREE 14k tok/s • Your IP / Moat</div>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>System Prompt Node</div>
      <div style={{ fontSize: 11, background: '#0a0a0a', padding: 8, borderRadius: 8, whiteSpace: 'pre-wrap', maxHeight: 100, overflow: 'auto', border: '1px solid #222' }}>{d.prompt || 'UGC mirror selfie, iPhone flash, messy bedroom...'}</div>
      <div style={{ marginTop: 6, fontSize: 10, color: '#666' }}>This prompt chain is your defensible IP - not the model</div>
      <Handle type="source" position={Position.Right} style={{ background: '#a78bfa' }} />
    </div>
  )
}
