import { useCallback, useEffect, useState } from 'react'
import { apiFetch, errorText } from '../lib/api'
import { toast } from '../components/Toasts'

const j = (body: any) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const call = async (url: string, init?: RequestInit) => {
  const r = await apiFetch(url, init)
  if (!r.ok) throw new Error(await errorText(r))
  return r.json()
}
const card = { background: '#111', border: '1px solid #222', borderRadius: 10, padding: 14, marginBottom: 14 } as const
const input = { background: '#0a0a0a', color: '#e5e5e5', border: '1px solid #333', borderRadius: 6, padding: '6px 8px', fontSize: 12 } as const
const btn = { fontSize: 11, background: '#1a1a1a', color: '#fff', border: '1px solid #333', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' } as const
const mono = { fontFamily: 'monospace', fontSize: 11, background: '#0a0a0a', border: '1px solid #222', borderRadius: 6, padding: 8, wordBreak: 'break-all' } as const

function Scopes({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <span style={{ fontSize: 11 }}>
      {['read', 'run', 'admin'].map((s) => (
        <label key={s} style={{ marginRight: 8 }}>
          <input type="checkbox" checked={value.includes(s)} onChange={(e) => onChange(e.target.checked ? [...value, s] : value.filter((x) => x !== s))} /> {s}
        </label>
      ))}
    </span>
  )
}

function Access() {
  const [data, setData] = useState<any>(null)
  const [name, setName] = useState('openclaw')
  const [scopes, setScopes] = useState(['read', 'run'])
  const [secret, setSecret] = useState<{ label: string; lines: [string, string][] } | null>(null)
  const load = useCallback(() => call('/api/access').then(setData).catch((e) => toast('error', e.message)), [])
  useEffect(() => { load() }, [load])
  const origin = location.origin

  const mkToken = async () => {
    try {
      const r = await call('/api/access/tokens', { method: 'POST', ...j({ name, scopes }) })
      setSecret({ label: 'Access token (shown once)', lines: [['token', r.token]] }); load()
    } catch (e: any) { toast('error', e.message) }
  }
  const mkClient = async () => {
    try {
      const r = await call('/api/access/clients', { method: 'POST', ...j({ name, scopes }) })
      setSecret({ label: 'OAuth client (secret shown once)', lines: [['client_id', r.clientId], ['client_secret', r.clientSecret]] }); load()
    } catch (e: any) { toast('error', e.message) }
  }
  const del = async (kind: 'tokens' | 'clients', id: string) => { await apiFetch(`/api/access/${kind}/${id}`, { method: 'DELETE' }); load() }

  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 8px' }}>Let other agents in (OpenClaw, Claude, anything MCP)</h3>
      <div style={{ fontSize: 12, color: '#aaa', marginBottom: 8 }}>
        MCP endpoint <code>{origin}/mcp</code> (streamable HTTP, Bearer auth). OAuth 2.0 client_credentials at <code>{origin}/oauth/token</code>, discovery at <code>/.well-known/oauth-authorization-server</code>.
        Scopes: <b>read</b> = see agents/tools/threads, <b>run</b> = talk to agents, <b>admin</b> = edit agents, call any tool, approve, import MCP servers.
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="name" />
        <Scopes value={scopes} onChange={setScopes} />
        <button style={btn} onClick={mkToken}>New access token</button>
        <button style={btn} onClick={mkClient}>New OAuth client</button>
      </div>
      {secret && (
        <div style={{ ...mono, marginBottom: 8, border: '1px solid #22c55e' }}>
          <b>{secret.label}</b> - copy it now.
          {secret.lines.map(([k, v]) => <div key={k}>{k}: {v}</div>)}
          <div style={{ color: '#888', marginTop: 4 }}>{'{ "mcpServers": { "nodular": { "url": "' + origin + '/mcp", "headers": { "Authorization": "Bearer <token>" } } } }'}</div>
          <button style={{ ...btn, marginTop: 6 }} onClick={() => setSecret(null)}>Done</button>
        </div>
      )}
      {data?.tokens?.map((t: any) => (
        <div key={t.id} style={{ fontSize: 12, display: 'flex', gap: 8, padding: '3px 0' }}>
          <span style={{ flex: 1 }}>{t.kind === 'pat' ? 'token' : 'oauth session'} <b>{t.name}</b> [{t.scopes}] {t.last_used ? `used ${new Date(t.last_used).toLocaleString()}` : 'never used'}</span>
          <button style={btn} onClick={() => del('tokens', t.id)}>Revoke</button>
        </div>
      ))}
      {data?.clients?.map((c: any) => (
        <div key={c.client_id} style={{ fontSize: 12, display: 'flex', gap: 8, padding: '3px 0' }}>
          <span style={{ flex: 1 }}>oauth client <b>{c.name}</b> {c.client_id} [{c.scopes}]</span>
          <button style={btn} onClick={() => del('clients', c.client_id)}>Delete</button>
        </div>
      ))}
      {data?.envAdminToken && <div style={{ fontSize: 11, color: '#888' }}>MCP_ADMIN_TOKEN is set on the server (full admin).</div>}
    </div>
  )
}

function Servers() {
  const [list, setList] = useState<any[]>([])
  const [text, setText] = useState('{\n  "mcpServers": {\n    "example": { "url": "http://127.0.0.1:3900/mcp/" }\n  }\n}')
  const load = useCallback(() => call('/api/mcp').then(setList).catch(() => {}), [])
  useEffect(() => { load() }, [load])
  const imp = async () => {
    try {
      const r = await call('/api/mcp/import', { method: 'POST', ...j(JSON.parse(text)) })
      toast(r.every((x: any) => x.status === 'connected') ? 'success' : 'error', r.map((x: any) => `${x.name}: ${x.status}${x.detail ? ' - ' + x.detail : ` (${x.tools} tools)`}`).join('; '))
      load()
    } catch (e: any) { toast('error', e.message) }
  }
  const rm = async (n: string) => { try { await call('/api/mcp/' + n, { method: 'DELETE' }); load() } catch (e: any) { toast('error', e.message) } }
  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 8px' }}>MCP servers (import)</h3>
      {list.map((s) => (
        <div key={s.name} style={{ fontSize: 12, display: 'flex', gap: 8, padding: '3px 0' }}>
          <span style={{ flex: 1 }}><b>{s.name}</b> [{s.transport}] {s.status} {s.status === 'connected' ? `(${s.tools} tools)` : s.detail || ''}</span>
          {s.imported && <button style={btn} onClick={() => rm(s.name)}>Remove</button>}
        </div>
      ))}
      <textarea style={{ ...input, width: '100%', height: 100, fontFamily: 'monospace', marginTop: 8, boxSizing: 'border-box' }} value={text} onChange={(e) => setText(e.target.value)} />
      <div style={{ fontSize: 11, color: '#888', margin: '4px 0' }}>Paste one server or a Claude-Desktop style <code>mcpServers</code> block. Command (stdio) servers need <code>ALLOW_STDIO_IMPORT=1</code> on the server. Tools appear as <code>name__tool</code> and ask for approval unless marked in <code>safeTools</code>.</div>
      <button style={btn} onClick={imp}>Import</button>
    </div>
  )
}

function Manifests() {
  const [agents, setAgents] = useState<any[]>([])
  const [id, setId] = useState('')
  const [f, setF] = useState<any>(null)
  const load = useCallback(() => call('/api/agents').then(setAgents).catch(() => {}), [])
  useEffect(() => { load() }, [load])
  const pick = async (v: string) => {
    setId(v)
    if (!v) return setF({ id: '', name: '', role: '', description: '', greeting: '', model: '', tools: '*', systemPrompt: '' })
    const a = await call('/api/agents/' + v)
    setF({ ...a, tools: a.tools === '*' ? '*' : a.tools.join(', ') })
  }
  const save = async () => {
    try {
      const tools = f.tools.trim() === '*' ? '*' : f.tools.split(',').map((x: string) => x.trim()).filter(Boolean)
      await call('/api/agents/' + f.id, { method: 'PUT', ...j({ ...f, tools }) })
      toast('success', 'Saved to the agent manifest'); load()
    } catch (e: any) { toast('error', e.message) }
  }
  const reset = async () => { await apiFetch(`/api/agents/${f.id}/override`, { method: 'DELETE' }); toast('success', 'Override removed'); load(); setF(null); setId('') }
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value })
  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 8px' }}>Agent manifests</h3>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>Defaults are the files in <code>agents/</code>. Saving here writes an override to <code>DATA_DIR/agents/&lt;id&gt;.md</code>; connected agents can do the same via MCP.</div>
      <select style={input} value={id} onChange={(e) => pick(e.target.value)}>
        <option value="">+ new agent</option>
        {agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.id}){a.source === 'override' ? ' *' : ''}</option>)}
      </select>
      {f && (
        <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
          {['id', 'name', 'role', 'description', 'greeting', 'model', 'tools'].map((k) => (
            <input key={k} style={input} placeholder={k === 'tools' ? 'tools: * or comma list (voicestudio__* ok)' : k} value={f[k] || ''} onChange={set(k)} disabled={k === 'id' && !!id} />
          ))}
          <textarea style={{ ...input, height: 160, fontFamily: 'monospace' }} placeholder="system prompt" value={f.systemPrompt} onChange={set('systemPrompt')} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btn} onClick={save}>Save</button>
            {f.source === 'override' && <button style={btn} onClick={reset}>Reset to default</button>}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ConnectPage() {
  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 16, maxWidth: 900, margin: '0 auto' }}>
      <Access />
      <Servers />
      <Manifests />
    </div>
  )
}
