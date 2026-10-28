
import { Handle, Position, NodeProps } from '@xyflow/react'
export function HtmlPreviewNode({ data }: NodeProps) {
  const d = data as any
  return (
    <div style={{ width: 320, background: '#111', border: '1px solid #333', borderRadius: 12, padding: 12 }}>
      <div style={{ fontSize: 10, color: '#fff', background: '#22c55e', display: 'inline-block', padding: '2px 6px', borderRadius: 4, marginBottom: 8, fontWeight: 700 }}>OUTPUT • Deployable API Endpoint</div>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Live Preview + Deploy</div>
      <div style={{ marginTop: 8, borderRadius: 8, overflow: 'hidden', background: '#fff', minHeight: 80, border: '1px solid #333' }}>
        {d.html ? <div dangerouslySetInnerHTML={{ __html: d.html }} /> : <div style={{ padding: 20, color: '#888', fontSize: 12 }}>Run workflow to see output. Then Deploy → POST /api/workflows/demo/run</div>}
      </div>
      <div style={{ marginTop: 8, background: '#0a0a0a', padding: 8, borderRadius: 8, fontSize: 9, fontFamily: 'monospace' }}>
        POST /api/workflows/{'{id}'}/run<br/>
        → returns {`{ imageUrl, html }`}<br/>
        <span style={{ color: '#22c55e' }}>This endpoint is your product</span>
      </div>
      <Handle type="target" position={Position.Left} />
    </div>
  )
}
