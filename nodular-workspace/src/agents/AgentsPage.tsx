import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch, errorText } from '../lib/api'
import { toast } from '../components/Toasts'

type Agent = { id: string; name: string; role?: string; description?: string; greeting?: string; custom?: boolean }
type Msg = { id: number; role: string; content: string; tool_calls?: { id: string; name: string; arguments: any }[]; name?: string }
type Thread = { thread: { id: string; agent_id: string }; messages: Msg[]; run?: { status: string; error?: string; provider?: string; model?: string }; approvals: { id: string; tool: string; args: any }[] }

const j = (body: any) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const get = async (url: string) => {
  const r = await apiFetch(url)
  if (!r.ok) throw new Error(await errorText(r))
  return r.json()
}
const imagesIn = (m: Msg) => {
  if (m.role !== 'tool') return []
  try {
    const v = JSON.parse(m.content)
    return [v.imageUrl, v.mediaUrl].filter((u): u is string => typeof u === 'string' && u.startsWith('/outputs/'))
  } catch { return [] }
}
const MediaView = ({ url }: { url: string }) =>
  /\.(mp4|webm)$/i.test(url) ? <video src={url} controls style={{ maxWidth: 320, borderRadius: 8, marginTop: 4, background: '#222' }} />
  : /\.(wav|mp3|ogg)$/i.test(url) ? <audio src={url} controls style={{ marginTop: 4 }} />
  : <img src={url} style={{ maxWidth: 320, borderRadius: 8, marginTop: 4, background: '#222' }} />

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [threads, setThreads] = useState<{ id: string; agent_id: string; title: string }[]>([])
  const [agentId, setAgentId] = useState('concierge')
  const [data, setData] = useState<Thread | null>(null)
  const [text, setText] = useState('')
  const [memories, setMemories] = useState<any[] | null>(null)
  const [status, setStatus] = useState<any>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const threadId = data?.thread.id

  const loadThreads = useCallback(() => get('/api/agent/threads').then(setThreads).catch(() => {}), [])
  const loadThread = useCallback((id: string) => get('/api/agent/threads/' + id).then(setData).catch((e) => toast('error', e.message)), [])

  useEffect(() => {
    get('/api/agents').then(setAgents).catch((e) => toast('error', e.message))
    get('/api/agent/status').then(setStatus).catch(() => {})
    loadThreads()
  }, [loadThreads])

  const busy = data?.run?.status === 'running' || data?.run?.status === 'awaiting_approval'
  useEffect(() => {
    if (!threadId || !busy) return
    const t = setInterval(() => loadThread(threadId).then(loadThreads), 1000)
    return () => clearInterval(t)
  }, [threadId, busy, loadThread, loadThreads])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [data?.messages.length, data?.approvals.length])

  const send = async () => {
    const message = text.trim()
    if (!message || busy) return
    setText('')
    const r = await apiFetch('/api/agent/runs', { method: 'POST', ...j({ agentId, message, threadId }) })
    if (!r.ok) { setText(message); return toast('error', await errorText(r)) }
    const { threadId: id } = await r.json()
    await loadThread(id)
    loadThreads()
  }

  const decide = async (id: string, approve: boolean) => {
    const r = await apiFetch('/api/agent/approvals/' + id, { method: 'POST', ...j({ approve }) })
    if (!r.ok) return toast('error', await errorText(r))
    if (threadId) loadThread(threadId)
  }

  const removeThread = async (id: string) => {
    await apiFetch('/api/agent/threads/' + id, { method: 'DELETE' })
    if (id === threadId) setData(null)
    loadThreads()
  }

  const showMemories = async () => setMemories(memories ? null : await get('/api/agent/memories'))
  const forget = async (id: number) => {
    await apiFetch('/api/agent/memories/' + id, { method: 'DELETE' })
    setMemories((m) => m && m.filter((x) => x.id !== id))
  }

  const agent = agents.find((a) => a.id === agentId)
  const box = { background: '#111', border: '1px solid #222', borderRadius: 10, padding: '8px 12px' } as const

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', height: '100%' }}>
      <aside style={{ borderRight: '1px solid #222', overflow: 'auto', padding: 12, fontSize: 12 }}>
        <div style={{ color: '#888', marginBottom: 6 }}>AGENTS</div>
        {agents.map((a) => (
          <div key={a.id} onClick={() => { setAgentId(a.id); setData(null) }} title={a.description}
            style={{ padding: '6px 8px', borderRadius: 8, cursor: 'pointer', background: a.id === agentId ? '#1d1d1d' : 'transparent' }}>
            <b>{a.name}</b>{a.custom && <span style={{ color: '#22c55e' }}> · yours</span>}
            <div style={{ color: '#777', fontSize: 10 }}>{a.role}</div>
          </div>
        ))}
        <div style={{ color: '#888', margin: '14px 0 6px' }}>CONVERSATIONS</div>
        {threads.map((t) => (
          <div key={t.id} style={{ display: 'flex', gap: 6, padding: '4px 8px', cursor: 'pointer', background: t.id === threadId ? '#1d1d1d' : 'transparent', borderRadius: 8 }}>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onClick={() => { setAgentId(t.agent_id); loadThread(t.id) }}>{t.title}</span>
            <span onClick={() => removeThread(t.id)} style={{ color: '#666' }} title="Delete">×</span>
          </div>
        ))}
        <button onClick={showMemories} style={{ marginTop: 14, fontSize: 11, background: '#1a1a1a', color: '#fff', border: '1px solid #333', padding: '4px 8px', borderRadius: 6, cursor: 'pointer' }}>
          {memories ? 'Hide memory' : 'Memory'}
        </button>
        {memories && (memories.length ? memories.map((m) => (
          <div key={m.id} style={{ ...box, marginTop: 6, fontSize: 11 }}>{m.text} <span onClick={() => forget(m.id)} style={{ color: '#ef4444', cursor: 'pointer' }}>forget</span></div>
        )) : <div style={{ color: '#777', marginTop: 6 }}>Nothing saved yet.</div>)}
      </aside>

      <main style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        {status?.mockFallback && (
          <div style={{ background: '#78350f', color: '#fde68a', padding: '6px 16px', fontSize: 11 }}>
            No language model connected - replies come from a basic offline stand-in. Start Ollama or set GROQ_API_KEY (see DEPLOY.md).
          </div>
        )}
        <div style={{ flex: 1, overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!data && <div style={{ color: '#888', margin: 'auto', textAlign: 'center' }}><h3 style={{ color: '#e5e5e5' }}>{agent?.name}</h3>{agent?.greeting || agent?.description}</div>}
          {data?.messages.map((m) => {
            if (m.role === 'user') return <div key={m.id} style={{ ...box, alignSelf: 'flex-end', background: '#1e293b', maxWidth: '75%', whiteSpace: 'pre-wrap' }}>{m.content}</div>
            if (m.role === 'tool') return (
              <div key={m.id} style={{ alignSelf: 'flex-start', fontSize: 11, color: '#888' }}>
                ⚙ {m.name}
                {imagesIn(m).map((u) => <div key={u}><MediaView url={u} /></div>)}
              </div>
            )
            return (
              <div key={m.id} style={{ alignSelf: 'flex-start', maxWidth: '75%' }}>
                {m.content && <div style={{ ...box, whiteSpace: 'pre-wrap' }}>{m.content}</div>}
                {m.tool_calls?.map((c) => <div key={c.id} style={{ fontSize: 11, color: '#888', marginTop: 4 }}>→ {c.name}({JSON.stringify(c.arguments).slice(0, 120)})</div>)}
              </div>
            )
          })}
          {data?.approvals.map((a) => (
            <div key={a.id} style={{ ...box, border: '1px solid #f59e0b', alignSelf: 'flex-start', maxWidth: '75%' }}>
              <div style={{ fontSize: 12, marginBottom: 6 }}>Approve <b>{a.tool}</b>?</div>
              <pre style={{ margin: 0, fontSize: 11, color: '#aaa', whiteSpace: 'pre-wrap' }}>{JSON.stringify(a.args, null, 2)}</pre>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={() => decide(a.id, true)} style={{ background: '#22c55e', border: 0, borderRadius: 6, padding: '4px 12px', fontWeight: 700, cursor: 'pointer' }}>Approve</button>
                <button onClick={() => decide(a.id, false)} style={{ background: '#222', color: '#fff', border: '1px solid #444', borderRadius: 6, padding: '4px 12px', cursor: 'pointer' }}>Reject</button>
              </div>
            </div>
          ))}
          {data?.run?.status === 'running' && <div style={{ color: '#888', fontSize: 12 }}>Thinking…</div>}
          {data?.run?.status === 'error' && <div style={{ color: '#ef4444', fontSize: 12 }}>Run failed: {data.run.error}</div>}
          <div ref={endRef} />
        </div>
        <div style={{ borderTop: '1px solid #222', padding: 12, display: 'flex', gap: 8 }}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder={`Message ${agent?.name || 'agent'}…`}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            style={{ flex: 1, background: '#111', color: '#e5e5e5', border: '1px solid #333', borderRadius: 10, padding: 10, resize: 'none', font: 'inherit' }} />
          <button onClick={send} disabled={busy || !text.trim()} style={{ background: '#fff', color: '#000', border: 0, borderRadius: 10, padding: '0 18px', fontWeight: 700, cursor: 'pointer', opacity: busy || !text.trim() ? 0.5 : 1 }}>Send</button>
        </div>
      </main>
    </div>
  )
}
