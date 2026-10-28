import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { apiFetch, errorText } from '../lib/api'

type Task = { id: string; title: string; done: boolean; notes: string }
type Checklist = { tasks: Task[]; completed: number; total: number; progress: number }
const input = { background: '#0a0a0a', color: '#eee', border: '1px solid #333', borderRadius: 6, padding: 7, fontSize: 12 }
const button = { ...input, cursor: 'pointer' }
const saturday = () => {
  const date = new Date()
  date.setDate(date.getDate() + (date.getDay() === 0 ? -1 : 6 - date.getDay()))
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}
const request = async (url: string, method = 'GET', body?: unknown): Promise<Checklist> => {
  const response = await apiFetch(url, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  if (!response.ok) throw new Error(await errorText(response))
  return response.json()
}

export default function WeekendChecklist() {
  const [weekend, setWeekend] = useState(saturday)
  const [data, setData] = useState<Checklist | null>(null)
  const [title, setTitle] = useState('')
  const [editing, setEditing] = useState<Task | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const path = `/api/time-audit/weekend/${weekend}`
  const load = useCallback(async () => {
    setData(null)
    setEditing(null)
    setError('')
    try { setData(await request(path)) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [path])
  useEffect(() => { void load() }, [load])
  const mutate = async (url: string, method: string, body?: unknown) => {
    setBusy(true)
    setError('')
    try { setData(await request(url, method, body)); return true }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); return false }
    finally { setBusy(false) }
  }
  const add = async (event: FormEvent) => {
    event.preventDefault()
    if (await mutate(`${path}/tasks`, 'POST', { title })) setTitle('')
  }
  return <section style={{ background: '#111', border: '1px solid #222', borderRadius: 10, padding: 14, marginBottom: 12 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
      <h3 style={{ margin: 0 }}>Weekend checklist tracker</h3>
      <label style={{ fontSize: 12, color: '#aaa' }}>Saturday date <input aria-label="Weekend Saturday date" style={input} type="date" value={weekend} disabled={busy} onChange={(e) => setWeekend(e.target.value)} /></label>
    </div>
    <p style={{ color: '#999', fontSize: 12 }}>A separate saved checklist for each weekend. Complete the exercise, add your own steps, and record evidence in notes.</p>
    {error && <div role="alert" style={{ color: '#fca5a5', marginBottom: 8 }}>{error}</div>}
    {data && <>
      <div style={{ fontSize: 12, color: '#86efac', marginBottom: 8 }}>{data.completed}/{data.total} complete ({data.progress}%)</div>
      <progress aria-label="Weekend completion" value={data.progress} max={100} style={{ width: '100%', accentColor: '#22c55e' }} />
      {!data.tasks.length && <button style={button} disabled={busy} onClick={() => void mutate(`${path}/start`, 'POST')}>Start weekend exercise checklist</button>}
      {data.tasks.map((task) => <div key={task.id} style={{ borderTop: '1px solid #242424', padding: '9px 0', fontSize: 12 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <label style={{ flex: 1, display: 'flex', gap: 8, alignItems: 'center', textDecoration: task.done ? 'line-through' : 'none', color: task.done ? '#888' : '#ddd' }}>
            <input type="checkbox" checked={task.done} disabled={busy} onChange={(e) => void mutate(`${path}/tasks/${task.id}`, 'PUT', { ...task, done: e.target.checked })} />{task.title}
          </label>
          <button style={button} disabled={busy} onClick={() => setEditing({ ...task })}>Edit / notes</button>
          <button style={button} disabled={busy} onClick={() => { if (window.confirm(`Remove "${task.title}" from this weekend?`)) void mutate(`${path}/tasks/${task.id}`, 'DELETE') }}>Remove</button>
        </div>
        {task.notes && <p style={{ margin: '5px 0 0 24px', color: '#aaa', whiteSpace: 'pre-wrap' }}>{task.notes}</p>}
      </div>)}
      {editing && <form onSubmit={async (e) => { e.preventDefault(); if (await mutate(`${path}/tasks/${editing.id}`, 'PUT', editing)) setEditing(null) }} style={{ display: 'grid', gap: 8, marginTop: 10 }}>
        <input aria-label="Checklist task title" style={input} required maxLength={240} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
        <textarea aria-label="Checklist task evidence and notes" style={input} maxLength={2000} value={editing.notes} placeholder="What happened? Add evidence and next steps." onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
        <div><button style={button} disabled={busy}>Save task</button> <button type="button" style={button} onClick={() => setEditing(null)}>Cancel</button></div>
      </form>}
      <form onSubmit={add} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        <input style={{ ...input, flex: 1 }} aria-label="New weekend task" placeholder="Add a weekend task" value={title} required maxLength={240} onChange={(e) => setTitle(e.target.value)} />
        <button style={button} disabled={busy || !title.trim()}>Add task</button>
      </form>
    </>}
  </section>
}
