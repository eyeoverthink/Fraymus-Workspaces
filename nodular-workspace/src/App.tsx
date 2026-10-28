
import WorkflowCanvas from './canvas/WorkflowCanvas'
import MonacoWorkspace from './editor/MonacoWorkspace'
import LivePreview from './editor/LivePreview'
import { useWorkflowStore } from './store/useWorkflowStore'
import { useState } from 'react'
import { apiFetch, errorText } from './lib/api'
import { Toasts, toast } from './components/Toasts'

export default function App() {
  const { isRunning, executionLog, deployedUrl, setDeployedUrl } = useWorkflowStore()
  const [showLogs, setShowLogs] = useState(false)

  const deployWorkflow = async () => {
    const { nodes, edges } = useWorkflowStore.getState()
    const clean = nodes.map((n: any) => ({ id: n.id, type: n.type, position: n.position, data: Object.fromEntries(Object.entries(n.data || {}).filter(([k]) => !['lastOutput', 'running', 'imageUrl', 'fileName'].includes(k))) }))
    try {
      const res = await apiFetch('/api/workflows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'ugc-mirror-selfie-v1', nodes: clean, edges }) })
      if (!res.ok) throw new Error(await errorText(res))
      const data = await res.json()
      const dep = await apiFetch(`/api/workflows/${data.id}/deploy`, { method: 'POST' })
      if (!dep.ok) throw new Error(await errorText(dep))
      const depData = await dep.json()
      setDeployedUrl(depData.fullUrl)
      useWorkflowStore.getState().setDeployedCurl(depData.curl)
      navigator.clipboard?.writeText(depData.curl).catch(() => {})
      toast('success', 'Deployed. cURL with your API key copied to clipboard - the key is shown only once.')
    } catch (e: any) {
      toast('error', 'Deploy failed: ' + e.message)
    }
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 0.85fr 0.6fr', gridTemplateRows: '100vh', background: '#0a0a0a', color: '#e5e5e5' }}>
      <div style={{ borderRight: '1px solid #222', display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #222', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0e0e0e' }}>
          <div>
            <div style={{ fontWeight: 800, letterSpacing: -0.5, fontSize: 14 }}>NODULAR • FULL</div>
            <div style={{ fontSize: 10, color: '#888' }}>5-NODE CHAIN • Llama → FLUX → Remover → Upscaler → Deploy • FREE 2026 STACK</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ fontSize: 10, background: isRunning ? '#22c55e' : '#1a1a1a', color: isRunning ? '#000' : '#888', padding: '4px 8px', borderRadius: 20, border: '1px solid #333' }}>{isRunning ? '● Running...' : '● REA Live'}</div>
            <button onClick={() => setShowLogs(!showLogs)} style={{ fontSize: 10, background: '#1a1a1a', color: '#fff', border: '1px solid #333', padding: '4px 8px', borderRadius: 6, cursor: 'pointer' }}>Logs ({executionLog.length})</button>
            <button onClick={deployWorkflow} style={{ fontSize: 11, background: '#fff', color: '#000', border: 0, padding: '6px 12px', borderRadius: 20, fontWeight: 700, cursor: 'pointer' }}>🚀 Deploy API</button>
          </div>
        </div>
        <div style={{ flex: 1, position: 'relative' }}>
          <WorkflowCanvas />
          {showLogs && (
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 200, background: 'rgba(0,0,0,0.9)', borderTop: '1px solid #333', padding: 12, overflow: 'auto', fontSize: 10, fontFamily: 'monospace' }}>
              {executionLog.map((log, i) => <div key={i} style={{ color: log.type === 'error' ? '#ef4444' : '#888', marginBottom: 4 }}>{JSON.stringify(log).slice(0,200)}</div>)}
            </div>
          )}
        </div>
        {deployedUrl && <div style={{ padding: '8px 12px', background: '#22c55e', color: '#000', fontSize: 10, fontWeight: 700 }}>Deployed: {deployedUrl} - POST with {'{ prompt }'}</div>}
      </div>
      <Toasts />
      <MonacoWorkspace />
      <LivePreview />
    </div>
  )
}
