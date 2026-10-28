import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch, errorText } from '../lib/api'
import { toast } from '../components/Toasts'

type Automation = {
  id: string
  name: string
  cron: string
  kind: 'agent' | 'tool'
  agentId?: string
  tool?: string
  prompt?: string
  args?: Record<string, unknown>
  enabled: boolean
  nextRun: number | null
  lastRun: { id: string; trigger: string; status: string; thread_id?: string; error?: string; started_at?: number; finished_at?: number } | null
}
type Run = { id: string; trigger: string; status: string; output?: string; error?: string; started_at?: number; finished_at?: number }
type Agent = { id: string; name: string }
type Tool = { name: string; risk: 'safe' | 'approval'; description: string }
type Template = { key: string; name: string; cron: string; kind: 'agent' | 'tool' }
type Form = { id?: string; name: string; cron: string; kind: 'agent' | 'tool'; agentId: string; tool: string; prompt: string; argsText: string; enabled: boolean }

const initialForm = (): Form => ({ name: '', cron: '0 8 * * *', kind: 'agent', agentId: '', tool: '', prompt: '', argsText: '{}', enabled: true })
const json = (body: unknown) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const request = async (url: string, init?: RequestInit) => {
  const response = await apiFetch(url, init)
  if (!response.ok) throw new Error(await errorText(response))
  return response.json()
}
const panel = { background: '#111', border: '1px solid #222', borderRadius: 10, padding: 14, marginBottom: 12 } as const
const field = { display: 'grid', gap: 4, color: '#aaa', fontSize: 11 } as const
const input = { background: '#0a0a0a', color: '#e5e5e5', border: '1px solid #333', borderRadius: 6, padding: '7px 9px', font: 'inherit', fontSize: 12, width: '100%', boxSizing: 'border-box' as const }
const button = { background: '#1a1a1a', color: '#eee', border: '1px solid #333', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 11 }
const utc = (value: number | null | undefined) => value ? `${new Date(value).toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'Disabled'

export default function AutomationsPage() {
  const [automations, setAutomations] = useState<Automation[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [tools, setTools] = useState<Tool[]>([])
  const [form, setForm] = useState<Form | null>(null)
  const [history, setHistory] = useState<Record<string, Run[]>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const safeTools = useMemo(() => tools.filter((tool) => tool.risk === 'safe'), [tools])
  const load = useCallback(async () => {
    try {
      const [automationData, agentData, status] = await Promise.all([
        request('/api/automations'),
        request('/api/agents'),
        request('/api/agent/status')
      ])
      setAutomations(automationData.automations)
      setTemplates(automationData.templates)
      setAgents(agentData)
      setTools(status.tools)
      setError('')
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
      toast('error', `Could not load automations: ${message}`)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const change = (key: keyof Form, value: string | boolean) => setForm((current) => current && ({ ...current, [key]: value }))
  const edit = (automation: Automation) => setForm({
    id: automation.id, name: automation.name, cron: automation.cron, kind: automation.kind,
    agentId: automation.agentId || agents[0]?.id || '', tool: automation.tool || safeTools[0]?.name || '',
    prompt: automation.prompt || '', argsText: JSON.stringify(automation.args || {}, null, 2), enabled: automation.enabled
  })

  const save = async () => {
    if (!form) return
    let args: Record<string, unknown>
    try {
      const value = JSON.parse(form.argsText || '{}')
      if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Tool arguments must be a JSON object.')
      args = value
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Invalid tool argument JSON')
      return
    }
    setSaving(true)
    try {
      await request('/api/automations', { method: 'POST', ...json({
        id: form.id, name: form.name, cron: form.cron, kind: form.kind,
        enabled: form.enabled,
        ...(form.kind === 'agent' ? { agentId: form.agentId, prompt: form.prompt } : { tool: form.tool, args })
      }) })
      toast('success', form.id ? 'Automation updated' : 'Automation created')
      setForm(null)
      await load()
    } catch (e) { toast('error', e instanceof Error ? e.message : String(e)) }
    finally { setSaving(false) }
  }

  const install = async (template: Template) => {
    try {
      await request(`/api/automations/template/${encodeURIComponent(template.key)}`, { method: 'POST' })
      toast('success', 'Template installed disabled; review it before enabling.')
      await load()
    } catch (e) { toast('error', e instanceof Error ? e.message : String(e)) }
  }

  const toggle = async (automation: Automation) => {
    try {
      await request('/api/automations', { method: 'POST', ...json({ ...automation, enabled: !automation.enabled }) })
      await load()
    } catch (e) { toast('error', e instanceof Error ? e.message : String(e)) }
  }

  const runNow = async (automation: Automation) => {
    try {
      const run = await request(`/api/automations/${encodeURIComponent(automation.id)}/run`, { method: 'POST' })
      toast(run.status === 'error' ? 'error' : 'success', `Run ${run.status}${run.error ? `: ${run.error}` : ''}`)
      await load()
      await loadHistory(automation.id)
    } catch (e) { toast('error', e instanceof Error ? e.message : String(e)) }
  }

  const loadHistory = async (id: string) => {
    try {
      const runs = await request(`/api/automations/${encodeURIComponent(id)}/runs`)
      setHistory((current) => ({ ...current, [id]: runs }))
    } catch (e) { toast('error', e instanceof Error ? e.message : String(e)) }
  }

  const showHistory = async (id: string) => {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    await loadHistory(id)
  }

  const remove = async (automation: Automation) => {
    if (!window.confirm(`Delete "${automation.name}" and its run history?`)) return
    try {
      await request(`/api/automations/${encodeURIComponent(automation.id)}`, { method: 'DELETE' })
      toast('success', 'Automation deleted')
      setExpanded(null)
      await load()
    } catch (e) { toast('error', e instanceof Error ? e.message : String(e)) }
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 18, boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 1050, margin: '0 auto' }}>
        <h2 style={{ margin: '0 0 5px' }}>Automations</h2>
        <div style={{ color: '#999', fontSize: 12, marginBottom: 14 }}>
          Schedule agent runs or safe registered tools. Cron uses five fields in UTC; agent runs never auto-approve risky tools.
        </div>

        {error && <div role="alert" style={{ ...panel, color: '#fca5a5', borderColor: '#7f1d1d' }}>Could not load automations: {error}</div>}

        <section style={panel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h3 style={{ margin: 0 }}>Your schedules</h3>
            <button style={button} onClick={() => setForm(initialForm())}>New automation</button>
          </div>
          {loading && <div style={{ color: '#888', fontSize: 12 }}>Loading…</div>}
          {!loading && !automations.length && <div style={{ color: '#888', fontSize: 12 }}>No automations yet. Create one or install a template below.</div>}
          {automations.map((automation) => (
            <article key={automation.id} style={{ borderTop: '1px solid #242424', padding: '12px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 220, flex: 1 }}>
                  <strong>{automation.name}</strong>{' '}
                  <span style={{ color: automation.enabled ? '#86efac' : '#888', fontSize: 10 }}>{automation.enabled ? 'ENABLED' : 'DISABLED'}</span>
                  <div style={{ color: '#999', fontSize: 11, marginTop: 4 }}>
                    <code>{automation.cron}</code> · UTC · next: {utc(automation.nextRun)}
                  </div>
                  <div style={{ color: '#777', fontSize: 10, marginTop: 3 }}>
                    {automation.kind === 'agent' ? `Agent: ${automation.agentId}` : `Safe tool: ${automation.tool}`}
                    {automation.lastRun && ` · last: ${automation.lastRun.status} (${automation.lastRun.trigger})`}
                    {automation.lastRun?.error && <span style={{ color: '#fca5a5' }}> · {automation.lastRun.error}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'start', flexWrap: 'wrap' }}>
                  <button style={button} onClick={() => void runNow(automation)}>Run now</button>
                  <button style={button} onClick={() => void toggle(automation)}>{automation.enabled ? 'Disable' : 'Enable'}</button>
                  <button style={button} onClick={() => edit(automation)}>Edit</button>
                  <button style={button} onClick={() => void showHistory(automation.id)}>Run history</button>
                  <button style={{ ...button, color: '#fca5a5' }} onClick={() => void remove(automation)}>Delete</button>
                </div>
              </div>
              {expanded === automation.id && (
                <div style={{ marginTop: 10, paddingLeft: 8, borderLeft: '2px solid #333' }}>
                  {!history[automation.id]?.length && <div style={{ color: '#888', fontSize: 11 }}>No run history.</div>}
                  {(history[automation.id] || []).map((run) => (
                    <div key={run.id} style={{ borderTop: '1px solid #222', padding: '7px 0', fontSize: 11 }}>
                      <div><b>{run.status}</b> · {run.trigger} · {run.started_at ? new Date(run.started_at).toLocaleString() : 'time unavailable'}</div>
                      {run.error && <div style={{ color: '#fca5a5', whiteSpace: 'pre-wrap' }}>{run.error}</div>}
                      {run.output && <pre style={{ margin: '4px 0', color: '#aaa', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{run.output}</pre>}
                    </div>
                  ))}
                </div>
              )}
            </article>
          ))}
        </section>

        <section style={panel}>
          <h3 style={{ margin: '0 0 8px' }}>Templates</h3>
          <div style={{ color: '#999', fontSize: 11, marginBottom: 8 }}>Templates install disabled. Inspect the prompt and enable only after you are comfortable with its behavior.</div>
          {templates.map((template) => (
            <div key={template.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid #222' }}>
              <div style={{ flex: 1 }}>
                <b style={{ fontSize: 12 }}>{template.name}</b>
                <div style={{ fontSize: 10, color: '#888' }}><code>{template.cron}</code> · UTC · {template.kind === 'agent' ? 'agent' : 'safe tool'}</div>
              </div>
              <button style={button} onClick={() => void install(template)}>Install disabled</button>
            </div>
          ))}
        </section>

        {form && (
          <section style={panel}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: '0 0 10px' }}>{form.id ? 'Edit automation' : 'New automation'}</h3>
              <button style={button} onClick={() => setForm(null)}>Close</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
              <label style={field}>Name<input style={input} value={form.name} maxLength={80} onChange={(e) => change('name', e.target.value)} /></label>
              <label style={field}>5-field cron (UTC)<input style={input} value={form.cron} onChange={(e) => change('cron', e.target.value)} placeholder="0 8 * * *" /></label>
              <label style={field}>Run type<select style={input} value={form.kind} onChange={(e) => change('kind', e.target.value as Form['kind'])}><option value="agent">Agent run</option><option value="tool">Safe tool only</option></select></label>
              {form.kind === 'agent' ? (
                <>
                  <label style={field}>Agent<select style={input} value={form.agentId} onChange={(e) => change('agentId', e.target.value)}>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} ({agent.id})</option>)}</select></label>
                  <label style={{ ...field, gridColumn: '1 / -1' }}>Prompt<textarea style={{ ...input, minHeight: 90, resize: 'vertical' }} value={form.prompt} onChange={(e) => change('prompt', e.target.value)} /></label>
                </>
              ) : (
                <>
                  <label style={field}>Safe registered tool<select style={input} value={form.tool} onChange={(e) => change('tool', e.target.value)}>{safeTools.map((tool) => <option key={tool.name} value={tool.name}>{tool.name}</option>)}</select></label>
                  <label style={{ ...field, gridColumn: '1 / -1' }}>Arguments (JSON object)<textarea style={{ ...input, minHeight: 90, resize: 'vertical', fontFamily: 'monospace' }} value={form.argsText} onChange={(e) => change('argsText', e.target.value)} /></label>
                  <div style={{ gridColumn: '1 / -1', color: '#fbbf24', fontSize: 11 }}>Approval-required tools are excluded and cannot run unattended.</div>
                </>
              )}
              <label style={{ ...field, display: 'flex', alignItems: 'center', gridColumn: '1 / -1' }}><span><input type="checkbox" checked={form.enabled} onChange={(e) => change('enabled', e.target.checked)} /> Enable schedule</span></label>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button style={{ ...button, background: '#eee', color: '#111', fontWeight: 700 }} disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save automation'}</button>
              <span style={{ color: '#888', fontSize: 10, alignSelf: 'center' }}>Next scheduled time is shown in UTC.</span>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
