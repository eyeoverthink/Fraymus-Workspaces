
import { Handle, Position, NodeProps } from '@xyflow/react'

export function BackgroundRemoverNode({ data, selected }: NodeProps) {
  const d = data as any
  return (
    <div style={{ 
      width: 300, 
      background: selected ? '#1e1b4b' : '#111', 
      border: `1px solid ${selected ? '#6366f1' : '#333'}`, 
      borderRadius: 12, 
      padding: 12,
      boxShadow: selected ? '0 0 0 2px rgba(99,102,241,0.3)' : 'none'
    }}>
      <div style={{ fontSize: 10, color: '#818cf8', marginBottom: 8, letterSpacing: 0.5, fontWeight: 700 }}>
        FREE • BiRefNet • @imgly/background-removal • Local WASM
      </div>
      <div style={{ fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 8, height: 8, background: '#6366f1', borderRadius: '50%', display: 'inline-block' }}></span>
        Background Remover
      </div>
      <div style={{ fontSize: 11, color: '#aaa', marginBottom: 8 }}>
        Input: imageUrl → Output: transparent PNG • Replaces Remove.bg $0.20/img
      </div>
      <div style={{ background: '#0a0a0a', padding: 8, borderRadius: 8, fontSize: 10, fontFamily: 'monospace' }}>
        <div style={{ color: '#666' }}>// Runs locally - no API key needed</div>
        <div>const blob = await removeBackground(imageBlob)</div>
        <div style={{ color: '#22c55e' }}>→ transparent PNG ready for upscaler</div>
      </div>
      {d.lastOutput?.imageUrl && (
        <div style={{ marginTop: 8, borderRadius: 8, overflow: 'hidden', border: '1px solid #333', background: 'repeating-conic-gradient(#1a1a1a 0% 25%, #222 0% 50%) 0 / 20px 20px' }}>
          <img src={d.lastOutput.imageUrl} style={{ width: '100%', display: 'block' }} />
        </div>
      )}
      <Handle type="target" position={Position.Left} style={{ background: '#6366f1' }} />
      <Handle type="source" position={Position.Right} style={{ background: '#6366f1' }} />
    </div>
  )
}
