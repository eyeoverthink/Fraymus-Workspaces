import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { apiFetch, errorText } from '../lib/api'
import { toast } from '../components/Toasts'
import ModelsPanel from './ModelsPanel'

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

function GoogleAccount() {
  const [data, setData] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => call('/api/integrations/google').then(setData).catch((e) => toast('error', e.message)), [])
  useEffect(() => { load() }, [load])

  const connect = async () => {
    setBusy(true)
    try {
      const result = await call('/api/integrations/google/connect', { method: 'POST' })
      window.location.assign(result.authorizationUrl)
    } catch (e: any) {
      toast('error', e.message)
      setBusy(false)
    }
  }
  const disconnect = async () => {
    setBusy(true)
    try {
      await call('/api/integrations/google', { method: 'DELETE' })
      toast('success', 'Google account disconnected')
      await load()
    } catch (e: any) { toast('error', e.message); await load() }
    finally { setBusy(false) }
  }

  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 8px' }}>Google Gmail + Calendar</h3>
      <div style={{ fontSize: 12, color: '#aaa', marginBottom: 8 }}>
        Status: <b style={{ color: data?.connected ? '#22c55e' : data?.configured ? '#fbbf24' : '#888' }}>
          {data?.connected ? `Connected as ${data.email}` : data?.configured ? 'Not connected' : 'Server setup required'}
        </b>
      </div>
      <div style={{ fontSize: 12, color: '#aaa', marginBottom: 8 }}>
        Available actions: Gmail search (snippets only), create one reviewed draft, send one approved email, list primary-calendar events, and create one approved event. No bulk outreach, attachments, event changes, or attendee invitations.
      </div>
      {!data?.configured && (
        <div style={{ fontSize: 11, color: '#fbbf24', marginBottom: 8 }}>
          Configure <code>{(data?.missing || ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'INTEGRATION_ENCRYPTION_KEY']).join(', ')}</code> on the server. Register the callback URL below in your Google OAuth client. Tokens are encrypted in the app database.
        </div>
      )}
      {data?.callbackUrl && <div style={{ ...mono, marginBottom: 8 }}>Google OAuth redirect URI: {data.callbackUrl}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        {!data?.connected
          ? <button style={btn} disabled={busy || !data?.configured} onClick={connect}>{busy ? 'Opening Google…' : 'Connect Google account'}</button>
          : <button style={btn} disabled={busy} onClick={disconnect}>{busy ? 'Disconnecting…' : 'Disconnect Google account'}</button>}
      </div>
    </div>
  )
}

function NotionAccount() {
  const [data, setData] = useState<any>(null)
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<any[]>([])
  const [page, setPage] = useState<any>(null)
  const load = useCallback(() => call('/api/integrations/notion').then(setData).catch((e) => toast('error', e.message)), [])
  useEffect(() => { load() }, [load])

  const connect = async () => {
    setBusy(true)
    try {
      const result = await call('/api/integrations/notion', { method: 'POST', ...j({ token: secret }) })
      setSecret('')
      setData(result)
      toast('success', `Connected ${result.integrationName || 'Notion integration'}`)
    } catch (e: any) { toast('error', e.message) }
    finally { setBusy(false) }
  }
  const search = async () => {
    setSearching(true)
    setPage(null)
    try {
      const result = await call(`/api/integrations/notion/search?query=${encodeURIComponent(query)}`)
      setResults(result.results || [])
      if (!result.results?.length) toast('info', 'No shared Notion pages or data sources matched that title')
    } catch (e: any) { toast('error', e.message) }
    finally { setSearching(false) }
  }
  const readPage = async (id: string) => {
    setPage(null)
    try { setPage(await call(`/api/integrations/notion/pages/${encodeURIComponent(id)}`)) }
    catch (e: any) { toast('error', e.message) }
  }
  const disconnect = async () => {
    setBusy(true)
    try {
      const result = await call('/api/integrations/notion', { method: 'DELETE' })
      setData((current: any) => ({ ...current, connected: false, workspace: null, integrationName: null }))
      toast('success', result.note || 'Notion disconnected')
    } catch (e: any) { toast('error', e.message) }
    finally { setBusy(false) }
  }

  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 8px' }}>Notion</h3>
      <div style={{ fontSize: 12, color: '#aaa', marginBottom: 8 }}>
        Status: <b style={{ color: data?.connected ? '#22c55e' : data?.configured ? '#fbbf24' : '#888' }}>
          {data?.connected ? `Connected to ${data.workspace}` : data?.configured ? 'Not connected' : 'Encryption setup required'}
        </b>{data?.connected && ` · ${data.integrationName}`}
      </div>
      <div style={{ fontSize: 12, color: '#aaa', marginBottom: 8 }}>
        Search and read pages and data sources shared with the integration. An agent can create a child page only after app approval. Existing pages are never edited or deleted.
      </div>
      {!data?.configured && <div style={{ fontSize: 11, color: '#fbbf24', marginBottom: 8 }}>Set <code>INTEGRATION_ENCRYPTION_KEY</code> (32+ characters) on the server before adding a token.</div>}
      {!data?.connected ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input style={{ ...input, minWidth: 250 }} type="password" autoComplete="new-password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Notion internal integration secret" disabled={busy || !data?.configured} />
          <button style={btn} onClick={connect} disabled={busy || !data?.configured || !secret.trim()}>{busy ? 'Validating…' : 'Connect Notion'}</button>
          <a style={{ ...btn, textDecoration: 'none' }} href="https://www.notion.so/profile/integrations" target="_blank" rel="noreferrer">Create / manage integration</a>
        </div>
      ) : (
        <>
          <button style={btn} disabled={busy} onClick={disconnect}>{busy ? 'Disconnecting…' : 'Disconnect Notion'}</button>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <input style={{ ...input, minWidth: 250 }} value={query} onChange={(e) => setQuery(e.target.value)} maxLength={200} placeholder="Search shared page or data-source titles" onKeyDown={(e) => { if (e.key === 'Enter') void search() }} />
            <button style={btn} disabled={searching || !query.trim()} onClick={() => void search()}>{searching ? 'Searching…' : 'Search Notion'}</button>
          </div>
          {results.map((item) => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid #222', padding: '7px 0', fontSize: 11 }}>
              <span style={{ flex: 1 }}>{item.title || '(untitled)'} <span style={{ color: '#777' }}>· {item.type}</span></span>
              {item.type === 'page' && <button style={btn} onClick={() => void readPage(item.id)}>Read page</button>}
              {typeof item.url === 'string' && item.url.startsWith('https://') && <a style={{ color: '#93c5fd' }} href={item.url} target="_blank" rel="noreferrer">Open</a>}
            </div>
          ))}
          {page && <div style={{ ...mono, marginTop: 8, whiteSpace: 'pre-wrap', wordBreak: 'normal' }}><b>{page.title || 'Notion page'}</b>{page.truncated && <div style={{ color: '#fbbf24' }}>Preview truncated at the configured content limit.</div>}<div style={{ marginTop: 6 }}>{page.content || '(No direct text blocks on this page.)'}</div></div>}
        </>
      )}
      <div style={{ fontSize: 11, color: '#777', marginTop: 8 }}>Share individual Notion pages with the integration. The token is validated, encrypted at rest, and never returned to the browser. Revoke it in Notion to remove provider access.</div>
    </div>
  )
}

function ApiKeyAccount({ provider, endpoint, field, title, placeholder }: { provider: string; endpoint: string; field: string; title: string; placeholder: string }) {
  const [data, setData] = useState<any>(null)
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => call(endpoint).then(setData).catch((e) => toast('error', e.message)), [endpoint])
  useEffect(() => { load() }, [load])
  const connect = async () => {
    setBusy(true)
    try {
      const result = await call(endpoint, { method: 'POST', ...j({ [field]: secret }) })
      setSecret('')
      setData(result)
      toast('success', `${provider} connected`)
    } catch (e: any) { toast('error', e.message) }
    finally { setBusy(false) }
  }
  const disconnect = async () => {
    setBusy(true)
    try {
      const result = await call(endpoint, { method: 'DELETE' })
      setData((current: any) => ({ ...current, connected: false, account: null }))
      toast('success', result.disconnected ? `${provider} disconnected` : `${provider} was already disconnected`)
    } catch (e: any) { toast('error', e.message) }
    finally { setBusy(false) }
  }
  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 8px' }}>{title}</h3>
      <div style={{ fontSize: 12, color: '#aaa', marginBottom: 8 }}>
        Status: <b style={{ color: data?.connected ? '#22c55e' : data?.configured ? '#fbbf24' : '#888' }}>
          {data?.connected ? `Connected · ${data.account}` : data?.configured ? 'Not connected' : 'Encryption setup required'}
        </b>{provider === 'Stripe' && data?.connected && ` · ${data.livemode ? 'live mode' : 'test mode'}`}
      </div>
      <div style={{ fontSize: 12, color: '#aaa', marginBottom: 8 }}>
        {provider === 'Apollo'
          ? 'Search returns prospect names and public work-profile metadata only. Apollo documents People API Search as zero-credit; API eligibility and rate limits still apply. No email/phone enrichment or outreach is enabled.'
          : 'Search customers by exact email. Draft one invoice with a single line item only after app approval; this integration never finalizes, sends, or charges an invoice.'}
      </div>
      {!data?.configured && <div style={{ fontSize: 11, color: '#fbbf24', marginBottom: 8 }}>Set a stable private <code>INTEGRATION_ENCRYPTION_KEY</code> (32+ characters) on the server.</div>}
      {!data?.connected ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input style={{ ...input, minWidth: 250 }} type="password" autoComplete="new-password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={placeholder} disabled={busy || !data?.configured} />
          <button style={btn} disabled={busy || !data?.configured || !secret.trim()} onClick={connect}>{busy ? 'Validating…' : `Connect ${provider}`}</button>
        </div>
      ) : <button style={btn} disabled={busy} onClick={disconnect}>{busy ? 'Disconnecting…' : `Disconnect ${provider}`}</button>}
      <div style={{ fontSize: 11, color: '#777', marginTop: 8 }}>The secret is validated server-side, encrypted at rest, and never returned to the browser. Disconnect removes the local encrypted credential.</div>
    </div>
  )
}

function OAuthAccount({ provider, endpoint, title, description, requiredSetup }: { provider: string; endpoint: string; title: string; description: string; requiredSetup: string }) {
  const [data, setData] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => call(endpoint).then(setData).catch((e) => toast('error', e.message)), [endpoint])
  useEffect(() => { load() }, [load])
  const connect = async () => {
    setBusy(true)
    try {
      const result = await call(`${endpoint}/connect`, { method: 'POST' })
      window.location.assign(result.authorizationUrl)
    } catch (e: any) { toast('error', e.message); setBusy(false) }
  }
  const disconnect = async () => {
    setBusy(true)
    try {
      const result = await call(endpoint, { method: 'DELETE' })
      setData((current: any) => ({ ...current, connected: false }))
      toast('success', result.note || `${provider} disconnected`)
    } catch (e: any) { toast('error', e.message) }
    finally { setBusy(false) }
  }
  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 8px' }}>{title}</h3>
      <div style={{ fontSize: 12, color: '#aaa', marginBottom: 8 }}>
        Status: <b style={{ color: data?.connected ? '#22c55e' : data?.configured ? '#fbbf24' : '#888' }}>{data?.connected ? `Connected${data.displayName ? ` as ${data.displayName}` : ''}` : data?.configured ? 'Not connected' : 'Server setup required'}</b>
      </div>
      <div style={{ fontSize: 12, color: '#aaa', marginBottom: 8 }}>{description}</div>
      {!data?.configured && <div style={{ fontSize: 11, color: '#fbbf24', marginBottom: 8 }}>Configure <code>{(data?.missing || []).join(', ') || requiredSetup}</code> and add the callback URL below to the provider app.</div>}
      {data?.callbackUrl && <div style={{ ...mono, marginBottom: 8 }}>OAuth callback: {data.callbackUrl}</div>}
      {!data?.connected
        ? <button style={btn} disabled={busy || !data?.configured} onClick={connect}>{busy ? `Opening ${provider}…` : `Connect ${provider}`}</button>
        : <button style={btn} disabled={busy} onClick={disconnect}>{busy ? 'Disconnecting…' : `Disconnect ${provider}`}</button>}
    </div>
  )
}

function WhisperAccount() {
  const [data, setData] = useState<any>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState('')
  const load = useCallback(() => call('/api/integrations/whisper').then(setData).catch((e) => toast('error', e.message)), [])
  useEffect(() => { load() }, [load])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!file) return
    setBusy(true)
    setError('')
    setTranscript('')
    try {
      const body = new FormData()
      body.append('audio', file)
      const response = await apiFetch('/api/integrations/whisper/transcribe', { method: 'POST', body })
      if (!response.ok) throw new Error(await errorText(response))
      const result = await response.json()
      setTranscript(result.text || '')
      toast('success', `Local transcription complete · ${result.characters} characters`)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
      toast('error', message)
    } finally { setBusy(false) }
  }
  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 8px' }}>Whisper.cpp · private local transcription</h3>
      <div style={{ fontSize: 12, color: '#aaa', marginBottom: 8 }}>
        Status: <b style={{ color: data?.configured ? '#22c55e' : '#fbbf24' }}>{data?.configured ? 'Local model ready' : 'Local setup required'}</b>
      </div>
      <div style={{ fontSize: 12, color: '#aaa', marginBottom: 8 }}>Runs offline on this server. Provide the whisper.cpp executable and a local ggml model; only PCM 16-bit WAV is accepted (maximum 50 MiB). No audio is sent to a cloud transcription service.</div>
      {!!data?.missing?.length && <div style={{ fontSize: 11, color: '#fbbf24', marginBottom: 8 }}>Configure <code>{data.missing.join(', ')}</code>.</div>}
      <form onSubmit={submit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="file" accept=".wav,audio/wav,audio/x-wav" onChange={(e) => setFile(e.target.files?.[0] || null)} disabled={busy || !data?.configured} />
        <button style={btn} disabled={busy || !file || !data?.configured}>{busy ? 'Transcribing locally…' : 'Transcribe WAV'}</button>
      </form>
      {error && <div role="alert" style={{ color: '#fca5a5', fontSize: 11, marginTop: 8 }}>{error}</div>}
      {transcript && <pre style={{ ...mono, whiteSpace: 'pre-wrap', wordBreak: 'normal', marginTop: 8 }}>{transcript}</pre>}
    </div>
  )
}

function RepurposeNotice() {
  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 8px' }}>Repurpose.io · not connected</h3>
      <div style={{ fontSize: 12, color: '#aaa' }}>I could not verify a public Repurpose.io developer API or supported OAuth integration, so no Repurpose connector or publishing behavior is claimed. Use the existing MCP import for a vendor-supported server if you have one. LinkedIn text publishing is available separately above; it does not cross-post or schedule content.</div>
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
      <div style={{ fontSize: 11, color: '#888', margin: '4px 0' }}>Paste one server or a Claude-Desktop style <code>mcpServers</code> block. Command (stdio) servers need <code>ALLOW_STDIO_IMPORT=1</code> on the server. Imported tools always ask for approval before execution; client-supplied <code>safeTools</code> settings are not trusted.</div>
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
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const results = [
      ['google', 'Google Gmail and Calendar'],
      ['canva', 'Canva'],
      ['linkedin', 'LinkedIn']
    ] as const
    for (const [key, provider] of results) {
      const result = params.get(key)
      if (result === 'connected') toast('success', `${provider} connected`)
      if (result === 'error') toast('error', `${provider} connection failed or was cancelled; check setup and try again`)
      if (result) window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])
  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 16, maxWidth: 900, margin: '0 auto' }}>
      <ModelsPanel />
      <GoogleAccount />
      <NotionAccount />
      <ApiKeyAccount provider="Apollo" endpoint="/api/integrations/apollo" field="apiKey" title="Apollo · prospect search" placeholder="Apollo API key" />
      <ApiKeyAccount provider="Stripe" endpoint="/api/integrations/stripe" field="secretKey" title="Stripe · customers and draft invoices" placeholder="Stripe secret or restricted key" />
      <OAuthAccount
        provider="Canva"
        endpoint="/api/integrations/canva"
        title="Canva · designs and exports"
        requiredSetup="CANVA_CLIENT_ID, CANVA_CLIENT_SECRET, INTEGRATION_ENCRYPTION_KEY"
        description="List design metadata, create a blank design with app approval, and request a design export with app approval. Canva may permanently delete blank designs left unedited for seven days."
      />
      <OAuthAccount
        provider="LinkedIn"
        endpoint="/api/integrations/linkedin"
        title="LinkedIn · text publishing"
        requiredSetup="LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, INTEGRATION_ENCRYPTION_KEY"
        description="Publish a single public text post to your member profile after app approval. Your LinkedIn app needs OpenID Connect and Share on LinkedIn access. No schedule, organization posting, images, video, or auto-publishing; access expiry requires reconnect."
      />
      <WhisperAccount />
      <RepurposeNotice />
      <Access />
      <Servers />
      <Manifests />
    </div>
  )
}
