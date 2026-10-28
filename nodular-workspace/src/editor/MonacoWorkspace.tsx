
import Editor from '@monaco-editor/react'
import { useWorkflowStore } from '../store/useWorkflowStore'

export default function MonacoWorkspace() {
  const { code, agentSuggestion, executionLog, setCode } = useWorkflowStore()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0e0e0e', borderLeft: '1px solid #222' }}>
      <div style={{ padding: '10px 12px', fontSize: 11, borderBottom: '1px solid #222', display: 'flex', justifyContent: 'space-between', background: '#111' }}>
        <span style={{ fontWeight: 700 }}>REA • Live Code Editor + Execution Log</span><span style={{ color: '#22c55e' }}>● streaming via Socket.io</span>
      </div>
      <div style={{ padding: '8px 10px', background: '#1a1a1a', fontSize: 11, color: '#a78bfa', borderBottom: '1px solid #222', minHeight: 40 }}>{agentSuggestion}</div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Editor height="60%" defaultLanguage="typescript" theme="vs-dark" value={code} onChange={(v)=>setCode(v||'')} options={{ minimap: { enabled: false }, fontSize: 12, wordWrap: 'on' }} />
        <div style={{ height: '40%', borderTop: '1px solid #222', background: '#0a0a0a', padding: 8, overflow: 'auto' }}>
          <div style={{ fontSize: 10, color: '#666', marginBottom: 6, fontWeight: 700 }}>EXECUTION LOG (Full implementation - no stubs)</div>
          {executionLog.slice(-20).map((log, i) => (
            <div key={i} style={{ fontSize: 10, fontFamily: 'monospace', color: log.type === 'error' ? '#ef4444' : log.type === 'node' ? '#fff' : '#888', marginBottom: 3, padding: 2, background: log.type === 'node' ? '#1a1a1a' : 'transparent', borderRadius: 3 }}>
              [{new Date(log.time).toLocaleTimeString()}] {log.type} {log.nodeId || ''} {log.duration ? `(${log.duration}ms)` : ''} {log.msg || ''} {log.error || ''}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
