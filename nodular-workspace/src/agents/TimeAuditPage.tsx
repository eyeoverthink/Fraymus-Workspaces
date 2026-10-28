import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { apiFetch, errorText } from '../lib/api'
import { toast } from '../components/Toasts'

type Activity = { activity: string; slots: number; minutes: number; averageEnergy: number; valueUsd: number }
type Entry = { id: number; started_at: number; activity: string; energy: number; value_usd: number; complaint: string }
type Summary = { slots: number; trackedMinutes: number; coveragePercent: number; valueUsd: number; lowEnergySlots: number; activities: Activity[] }
type Form = { id?: number; startedAt: string; activity: string; energy: number; valueUsd: number; complaint: string }

const localSlot = () => {
  const date = new Date()
  date.setMinutes(date.getMinutes() < 30 ? 0 : 30, 0, 0)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
const newForm = (): Form => ({ startedAt: localSlot(), activity: '', energy: 5, valueUsd: 0, complaint: '' })
const panel = { background: '#111', border: '1px solid #222', borderRadius: 10, padding: 14, marginBottom: 12 } as const
const field = { display: 'grid', gap: 4, color: '#aaa', fontSize: 11 } as const
const input = { background: '#0a0a0a', color: '#e5e5e5', border: '1px solid #333', borderRadius: 6, padding: '7px 9px', font: 'inherit', fontSize: 12, width: '100%', boxSizing: 'border-box' as const }
const button = { background: '#1a1a1a', color: '#eee', border: '1px solid #333', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 11 }
const json = (body: unknown) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export default function TimeAuditPage() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [form, setForm] = useState<Form>(newForm())
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const response = await apiFetch('/api/time-audit')
      if (!response.ok) throw new Error(await errorText(response))
      const data = await response.json()
      setEntries(data.entries)
      setSummary(data.summary)
      setError('')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      const path = form.id ? `/api/time-audit/${form.id}` : '/api/time-audit'
      const response = await apiFetch(path, { method: form.id ? 'PUT' : 'POST', ...json({ ...form, startedAt: new Date(form.startedAt).toISOString() }) })
      if (!response.ok) throw new Error(await errorText(response))
      toast('success', form.id ? 'Time-audit entry updated' : 'Time-audit entry saved')
      setForm(newForm())
      await load()
    } catch (e) { toast('error', e instanceof Error ? e.message : String(e)) }
    finally { setSaving(false) }
  }

  const edit = (entry: Entry) => setForm({
    id: entry.id,
    startedAt: new Date(entry.started_at - new Date(entry.started_at).getTimezoneOffset() * 60_000).toISOString().slice(0, 16),
    activity: entry.activity, energy: entry.energy, valueUsd: entry.value_usd, complaint: entry.complaint
  })

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 18, boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 1050, margin: '0 auto' }}>
        <h2 style={{ margin: '0 0 5px' }}>Two-day time audit</h2>
        <div style={{ color: '#999', fontSize: 12, marginBottom: 14 }}>
          Log each 30-minute block yourself: activity, energy (1–10), estimated business value, and what you complained about. This page does not monitor your device.
        </div>
        <section style={panel}>
          <h3 style={{ margin: '0 0 10px' }}>Log a 30-minute block</h3>
          <form onSubmit={save} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <label style={field}>Block start (your local time)<input style={input} type="datetime-local" value={form.startedAt} required onChange={(e) => setForm({ ...form, startedAt: e.target.value })} /></label>
            <label style={field}>What did you do?<input style={input} value={form.activity} maxLength={240} required onChange={(e) => setForm({ ...form, activity: e.target.value })} /></label>
            <label style={field}>Energy (1–10)<input style={input} type="number" min={1} max={10} step={1} value={form.energy} required onChange={(e) => setForm({ ...form, energy: Number(e.target.value) })} /></label>
            <label style={field}>Estimated value ($)<input style={input} type="number" min={0} step="0.01" value={form.valueUsd} required onChange={(e) => setForm({ ...form, valueUsd: Number(e.target.value) })} /></label>
            <label style={{ ...field, gridColumn: '1 / -1' }}>What did you complain about or wish were easier?<textarea style={{ ...input, minHeight: 65, resize: 'vertical' }} value={form.complaint} maxLength={1000} onChange={(e) => setForm({ ...form, complaint: e.target.value })} /></label>
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
              <button style={button} disabled={saving}>{saving ? 'Saving…' : form.id ? 'Update entry' : 'Save entry'}</button>
              {form.id && <button type="button" style={button} onClick={() => setForm(newForm())}>Cancel edit</button>}
            </div>
          </form>
        </section>
        {error && <div role="alert" style={{ ...panel, color: '#fca5a5' }}>Could not load time audit: {error}</div>}
        <section style={panel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>Last 48 hours</h3>
            <button style={button} onClick={() => void load()} disabled={loading}>Refresh</button>
          </div>
          {summary && <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', color: '#aaa', fontSize: 12, margin: '12px 0' }}>
            <span>{summary.slots} blocks · {summary.trackedMinutes / 60} hours tracked</span>
            <span>{summary.coveragePercent}% coverage</span>
            <span>${summary.valueUsd.toFixed(2)} estimated value</span>
            <span>{summary.lowEnergySlots} low-energy blocks (1–3)</span>
          </div>}
          {summary?.activities.map((activity) => (
            <div key={activity.activity} style={{ borderTop: '1px solid #242424', padding: '8px 0', fontSize: 11 }}>
              <strong>{activity.activity}</strong> · {activity.minutes / 60}h · avg energy {activity.averageEnergy} · ${activity.valueUsd.toFixed(2)}
            </div>
          ))}
          {!loading && !entries.length && <div style={{ color: '#888', fontSize: 12, marginTop: 8 }}>No blocks logged yet.</div>}
        </section>
        <section style={panel}>
          <h3 style={{ margin: '0 0 8px' }}>Entries</h3>
          {entries.map((entry) => (
            <article key={entry.id} style={{ borderTop: '1px solid #242424', padding: '9px 0', display: 'flex', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap', fontSize: 11 }}>
              <div>
                <strong>{entry.activity}</strong> · {new Date(entry.started_at).toLocaleString()} · energy {entry.energy}/10 · ${Number(entry.value_usd).toFixed(2)}
                {entry.complaint && <div style={{ color: '#888', marginTop: 3 }}>{entry.complaint}</div>}
              </div>
              <button style={button} onClick={() => edit(entry)}>Edit</button>
            </article>
          ))}
        </section>
      </div>
    </div>
  )
}
