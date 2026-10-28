import { useEffect, useState, type FormEvent } from 'react'
import type { IdeaReview, LabSettings, TrendScan } from '../../server/agent/idea-lab'
import { apiFetch, errorText } from '../lib/api'

export const card = { background: '#111', border: '1px solid #222', borderRadius: 10, padding: 14, marginBottom: 12 } as const
export const input = { background: '#0a0a0a', color: '#e5e5e5', border: '1px solid #333', borderRadius: 6, padding: '7px 9px', font: 'inherit', fontSize: 12, width: '100%', boxSizing: 'border-box' as const }
export const button = { background: '#1a1a1a', color: '#eee', border: '1px solid #333', borderRadius: 6, padding: '7px 12px', cursor: 'pointer', fontSize: 11 }
export const field = { display: 'grid', gap: 4, color: '#aaa', fontSize: 12 } as const
export const request = async (url: string, method = 'GET', body?: unknown) => {
  const response = await apiFetch(url, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  if (!response.ok) throw new Error(await errorText(response))
  return response.json()
}
export const safeLink = (url?: string) => {
  try { const parsed = new URL(url || ''); return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : undefined }
  catch { return undefined }
}
export type SavedReview = IdeaReview & { reportId: string; ideaIndex: number }
export type LabState = { settings: LabSettings; topics: LabSettings['topics']; scans: TrendScan[]; reviews: SavedReview[] }

export function MissionPanel({ lab, onSaved }: { lab: LabState; onSaved: () => void }) {
  const [settings, setSettings] = useState(lab.settings)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const save = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true); setMessage('')
    try { await request('/api/idea-finder/settings', 'PUT', settings); setMessage('Mission and goals saved. These targets do not authorize spending.'); onSaved() }
    catch (e) { setMessage(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  return <section style={card}>
    <h3 style={{ margin: '0 0 8px' }}>Creative mission and moonshot goals</h3>
    <p style={{ color: '#aaa', fontSize: 12 }}>Aim high; measure actual experiments and evidence. AI does not have financial motivation. A stretch target guides exploration, never forecasts income or overrides approvals.</p>
    <form onSubmit={save} style={{ display: 'grid', gap: 10 }}>
      <label style={field}>Mission / creative constraints<textarea style={input} required maxLength={1000} value={settings.mission} onChange={(e) => setSettings({ ...settings, mission: e.target.value })} /></label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
        {([
          ['revenueGoal', 'Stretch gross-revenue goal ($)', 1, 1e15],
          ['actualRevenue', 'Actual gross revenue ($, self-reported)', 0, 1e15],
          ['horizonDays', 'Goal horizon (days)', 1, 3650],
          ['weeklyExperiments', 'Experiment target / week', 1, 100],
          ['maxExperimentBudget', 'Experiment budget ceiling ($)', 0, 1_000_000]
        ] as const).map(([key, title, min, max]) => <label key={key} style={field}>{title}<input style={input} type="number" min={min} max={max} step={key === 'horizonDays' || key === 'weeklyExperiments' ? 1 : 'any'} required value={settings[key]} onChange={(e) => setSettings({ ...settings, [key]: Number(e.target.value) })} /></label>)}
      </div>
      <div style={{ color: '#aaa', fontSize: 12 }}>Trend watch topics (public labels only)</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {lab.topics.map((topic) => <label key={topic} style={{ fontSize: 12, color: '#aaa' }}><input type="checkbox" checked={settings.topics.includes(topic)} onChange={(e) => setSettings({ ...settings, topics: e.target.checked ? [...settings.topics, topic] : settings.topics.filter((value) => value !== topic) })} /> {topic}</label>)}
      </div>
      <div style={{ color: '#86efac', fontSize: 12 }}>
        {lab.reviews.filter((r) => r.status === 'shortlisted').length} shortlisted · {lab.reviews.filter((r) => r.status === 'testing').length} testing · {lab.reviews.filter((r) => r.status === 'validated').length} marked validated by you.
        {' '}Self-reported revenue: ${lab.settings.actualRevenue.toLocaleString()} / ${lab.settings.revenueGoal.toLocaleString()} aspiration.
      </div>
      <div><button style={button} disabled={busy || !settings.topics.length}>{busy ? 'Saving...' : 'Save mission and goals'}</button></div>
      {message && <div role="status" style={{ fontSize: 12, color: '#fbbf24' }}>{message}</div>}
    </form>
  </section>
}

export function TrendPanel({ scans, onSaved }: { scans: TrendScan[]; onSaved: () => void }) {
  const [selectedId, setSelectedId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [installed, setInstalled] = useState<string[]>([])
  const scan = scans.find((item) => item.id === selectedId) || scans[0]
  const refresh = async () => {
    setBusy(true); setError('')
    try { const result = await request('/api/idea-finder/trends', 'POST'); setSelectedId(result.id); onSaved() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const install = async (template: string) => {
    setBusy(true); setError('')
    try { await request(`/api/automations/template/${template}`, 'POST'); setInstalled((items) => [...items, template]) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  return <section style={card}>
    <h3 style={{ margin: '0 0 8px' }}>AI trend radar / ten YouTube signals</h3>
    <p style={{ fontSize: 12, color: '#aaa' }}>Refresh searches public YouTube and the web using your saved topic labels. Search order is not an earnings ranking. This scans metadata, not video transcripts; it cannot guarantee being ahead of every trend.</p>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button style={button} disabled={busy} onClick={() => void refresh()}>{busy ? 'Working...' : 'Search YouTube + web now'}</button>
      <button style={button} disabled={busy || installed.includes('ai-trend-radar')} onClick={() => void install('ai-trend-radar')}>Install daily radar (disabled)</button>
      <button style={button} disabled={busy || installed.includes('creative-idea-briefing')} onClick={() => void install('creative-idea-briefing')}>Install creative draft agent (disabled)</button>
      <a style={{ color: '#93c5fd', fontSize: 12, padding: 6 }} href="?view=automations">Enable / manage schedule in Automations</a>
      {scans.length > 1 && <select aria-label="Trend snapshot history" style={{ ...input, width: 'auto' }} value={scan?.id} onChange={(e) => setSelectedId(e.target.value)}>
        {scans.map((item) => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString()}</option>)}
      </select>}
    </div>
    {error && <div role="alert" style={{ color: '#fca5a5', fontSize: 12, marginTop: 8 }}>{error}</div>}
    {!!installed.length && <p style={{ color: '#fbbf24', fontSize: 12 }}>Installed {installed.length} template(s), disabled until you enable them. Radar runs at 08:00 UTC; creative drafts at 08:30 UTC. The server must stay running. The draft agent needs a real configured LLM; the offline mock does not invent reports. No publishing, outreach, or spending occurs.</p>}
    {scan && <>
      <p style={{ color: '#888', fontSize: 11 }}>{new Date(scan.createdAt).toLocaleString()} · {scan.topics.join(', ')} · {scan.caveat}</p>
      {scan.errors.map((message, index) => <div role="alert" key={index} style={{ color: '#fca5a5', fontSize: 12 }}>{message}</div>)}
      {scan.videos.map((video, index) => <div key={video.url} style={{ fontSize: 12, padding: '7px 0', borderTop: '1px solid #242424' }}>
        {index + 1}. <a href={safeLink(video.url)} target="_blank" rel="noreferrer" style={{ color: '#93c5fd' }}>{video.title}</a>
        <div style={{ color: '#888', fontSize: 11 }}>{video.channel} · {video.published || 'Date unavailable'} · {video.views || 'Views unavailable'}</div>
      </div>)}
      {!!scan.links.length && <details style={{ marginTop: 10, fontSize: 12 }}><summary>Related public web signals ({scan.links.length})</summary>
        {scan.links.map((link, index) => <p key={`${link.url}-${index}`}><a style={{ color: '#93c5fd' }} href={safeLink(link.url)} target="_blank" rel="noreferrer">{link.title}</a><br /><span style={{ color: '#888' }}>{link.snippet}</span></p>)}
      </details>}
    </>}
  </section>
}

export function ReviewPanel({ reportId, index, review, onSaved }: { reportId: string; index: number; review?: SavedReview; onSaved: () => void }) {
  const [form, setForm] = useState<IdeaReview>(review || { status: 'new', creativity: 5, usefulness: 5, notes: '' })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => { setForm(review || { status: 'new', creativity: 5, usefulness: 5, notes: '' }); setMessage('') }, [reportId, index, review])
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage('')
    try { await request(`/api/idea-finder/${reportId}/reviews/${index}`, 'PUT', form); setMessage('Review saved'); onSaved() }
    catch (e) { setMessage(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  return <form onSubmit={save} style={{ display: 'grid', gap: 8, borderTop: '1px solid #333', marginTop: 12, paddingTop: 12 }}>
    <b style={{ fontSize: 12 }}>Your creativity review / experiment tracking</b>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 8 }}>
      <label style={field}>Decision<select style={input} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as IdeaReview['status'] })}>
        {(['new', 'shortlisted', 'testing', 'validated', 'rejected'] as const).map((value) => <option key={value} value={value}>{value === 'validated' ? 'validated (your evidence)' : value}</option>)}
      </select></label>
      <label style={field}>Creativity (your score, 1-10)<input style={input} type="number" min={1} max={10} required value={form.creativity} onChange={(e) => setForm({ ...form, creativity: Number(e.target.value) })} /></label>
      <label style={field}>Usefulness (your score, 1-10)<input style={input} type="number" min={1} max={10} required value={form.usefulness} onChange={(e) => setForm({ ...form, usefulness: Number(e.target.value) })} /></label>
    </div>
    <label style={field}>Feedback / experiment result / validation evidence<textarea style={input} maxLength={2000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} required={form.status === 'validated'} /></label>
    <div><button style={button} disabled={busy}>{busy ? 'Saving...' : 'Save review'}</button> <span role="status" style={{ color: '#fbbf24', fontSize: 12 }}>{message}</span></div>
  </form>
}
