import { useCallback, useEffect, useState } from 'react'
import { apiFetch, errorText } from '../lib/api'

type Entry = { id: number; agent_id: string; run_id?: string; thread_id?: string; action: string; status: string; created_at: number }
type Agent = { id: string; name: string }

const panel = { background: '#111', border: '1px solid #222', borderRadius: 10, padding: 14, marginBottom: 12 } as const
const button = { background: '#1a1a1a', color: '#eee', border: '1px solid #333', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 11 }

export default function ActionLogPage() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [agentId, setAgentId] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [logResponse, agentResponse] = await Promise.all([
        apiFetch(`/api/agent/action-log?limit=200${agentId ? `&agentId=${encodeURIComponent(agentId)}` : ''}`),
        apiFetch('/api/agents')
      ])
      if (!logResponse.ok) throw new Error(await errorText(logResponse))
      if (!agentResponse.ok) throw new Error(await errorText(agentResponse))
      setEntries(await logResponse.json())
      setAgents(await agentResponse.json())
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setLoading(false) }
  }, [agentId])

  useEffect(() => { void load() }, [load])

  const nameOf = (id: string) => agents.find((agent) => agent.id === id)?.name || id
  const colorOf = (status: string) => status === 'succeeded' || status === 'approved' ? '#86efac'
    : status === 'failed' || status === 'rejected' ? '#fca5a5' : '#fbbf24'

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 18, boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 1050, margin: '0 auto' }}>
        <h2 style={{ margin: '0 0 5px' }}>Agent action log</h2>
        <div style={{ color: '#999', fontSize: 12, marginBottom: 14 }}>
          User-scoped audit of tool names, outcomes, and timestamps. Arguments and private tool output are intentionally not retained here.
        </div>
        <section style={panel}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ color: '#aaa', fontSize: 11 }}>Agent
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)} style={{ marginLeft: 8, background: '#0a0a0a', color: '#eee', border: '1px solid #333', borderRadius: 6, padding: '6px 8px' }}>
                <option value="">All agents</option>
                {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
              </select>
            </label>
            <button style={button} onClick={() => void load()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
          </div>
          {error && <div role="alert" style={{ color: '#fca5a5', marginTop: 12, fontSize: 12 }}>{error}</div>}
          {!loading && !error && !entries.length && <div style={{ color: '#888', fontSize: 12, marginTop: 12 }}>No agent actions recorded yet.</div>}
          {entries.map((entry) => (
            <div key={entry.id} style={{ borderTop: '1px solid #242424', padding: '10px 0', display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11 }}>
              <time style={{ color: '#888', minWidth: 170 }}>{new Date(entry.created_at).toLocaleString()}</time>
              <strong>{nameOf(entry.agent_id)}</strong>
              <code>{entry.action}</code>
              <span style={{ color: colorOf(entry.status) }}>{entry.status.replace(/_/g, ' ')}</span>
              {entry.run_id && <span style={{ color: '#666' }}>run {entry.run_id.slice(0, 8)}</span>}
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
