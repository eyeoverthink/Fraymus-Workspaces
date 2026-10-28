
import { Handle, Position, NodeProps } from '@xyflow/react'

export function UpscalerNode({ data, selected }: NodeProps) {
  const d = data as any
  return (
    <div style={{ 
      width: 300, 
      background: selected ? '#14532d' : '#111', 
      border: `1px solid ${selected ? '#22c55e' : '#333'}`, 
      borderRadius: 12, 
      padding: 12,
      boxShadow: selected ? '0 0 0 2px rgba(34,197,94,0.3)' : 'none'
    }}>
      <div style={{ fontSize: 10, color: '#4ade80', marginBottom: 8, letterSpacing: 0.5, fontWeight: 700 }}>
        FREE • Real-ESRGAN 4x • Sharp Lanczos • Local
      </div>
      <div style={{ fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 8, height: 8, background: '#22c55e', borderRadius: '50%', display: 'inline-block' }}></span>
        4x Upscaler • 1024 → 4096
      </div>
      <div style={{ fontSize: 11, color: '#aaa', marginBottom: 8 }}>
        Input: imageUrl → Output: 4K image • Replaces Magnific $0.50/img
      </div>
      <div style={{ background: '#0a0a0a', padding: 8, borderRadius: 8, fontSize: 10, fontFamily: 'monospace' }}>
        <div style={{ color: '#666' }}>// Sharp local - no API, instant</div>
        <div>sharp(img).resize(w*4, h*4, {'{'}</div>
        <div>&nbsp;&nbsp;kernel: 'lanczos3'{'}).png()</div>
        <div style={{ color: '#22c55e' }}>→ 4K for product listings</div>
      </div>
      <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
        <div style={{ flex: 1, background: '#0a0a0a', padding: 6, borderRadius: 6, fontSize: 10 }}>
          <div style={{ color: '#666' }}>SCALE</div>
          <div style={{ fontWeight: 700 }}>{d.scale || 4}x</div>
        </div>
        <div style={{ flex: 1, background: '#0a0a0a', padding: 6, borderRadius: 6, fontSize: 10 }}>
          <div style={{ color: '#666' }}>FORMAT</div>
          <div style={{ fontWeight: 700 }}>PNG</div>
        </div>
      </div>
      {d.lastOutput?.imageUrl && (
        <div style={{ marginTop: 8, borderRadius: 8, overflow: 'hidden', border: '1px solid #333' }}>
          <img src={d.lastOutput.imageUrl} style={{ width: '100%', display: 'block' }} />
        </div>
      )}
      <Handle type="target" position={Position.Left} style={{ background: '#22c55e' }} />
      <Handle type="source" position={Position.Right} style={{ background: '#22c55e' }} />
    </div>
  )
}
