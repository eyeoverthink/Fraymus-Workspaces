
import { Handle, Position, NodeProps } from '@xyflow/react'
export function FluxNode({ data, selected }: NodeProps) {
  const d = data as any
  return (
    <div style={{ width: 300, background: selected ? '#1a1a1a' : '#111', border: `1px solid ${selected ? '#fff' : '#333'}`, borderRadius: 12, padding: 12, boxShadow: selected ? '0 0 0 2px rgba(255,255,255,0.2)' : 'none' }}>
      <div style={{ fontSize: 10, color: '#fff', background: '#000', display: 'inline-block', padding: '2px 6px', borderRadius: 4, marginBottom: 8, fontWeight: 700 }}>FREE • FLUX.1 [schnell] • Apache 2.0 • Replaces Nano Banana</div>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>FLUX Generator - 4 Steps</div>
      <div style={{ fontSize: 11, color: '#aaa' }}>Model: {d.model || 'black-forest-labs/FLUX.1-schnell'}</div>
      <div style={{ marginTop: 8, background: '#0a0a0a', padding: 8, borderRadius: 8, fontSize: 10, fontFamily: 'monospace' }}>
        prompt → image (1024x1024)<br/>cost: $0 • 4 steps • commercial use OK
      </div>
      {d.lastOutput?.imageUrl && <div style={{ marginTop: 8, borderRadius: 8, overflow: 'hidden', border: '1px solid #333' }}><img src={d.lastOutput.imageUrl} style={{ width: '100%' }} /></div>}
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
