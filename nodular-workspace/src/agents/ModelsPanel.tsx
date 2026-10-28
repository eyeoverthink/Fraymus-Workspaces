import { useEffect, useState } from 'react'
import { button, card, request } from './IdeaLabPanels'

type Diagnostics = { selected: { agent: string; ideas: string; vision: string; order: string }; ollama: { reachable: boolean; error: string | null; checks: { model: string; installed: boolean; capabilities: string[]; error: string | null }[] }; note: string }
export default function ModelsPanel() {
  const [data, setData] = useState<Diagnostics | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [test, setTest] = useState<{ capability: string; ok: boolean; model?: string; error?: string }[]>([])
  const load = () => request('/api/models').then(setData).catch((e) => setError(e.message))
  useEffect(() => { void load() }, [])
  const run = async () => {
    setBusy(true); setError(''); setTest([])
    try { const result = await request('/api/models/test', 'POST'); setTest(result.results); await load() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  return <section style={card}>
    <h3 style={{ margin: '0 0 8px' }}>Models: real text, tools and image understanding</h3>
    <p style={{ color: '#aaa', fontSize: 12 }}>Run <code>npm run models:configure</code> in the app folder to select installed local Ollama models and preserve them in ignored <code>.env</code>. Restart the server after changing settings. No model download or external key is required if compatible models are already installed.</p>
    {data && <div style={{ fontSize: 12, color: '#aaa' }}>
      <div>Agent model: <b>{data.selected.agent}</b> · Ideas/content: <b>{data.selected.ideas}</b></div>
      <div>Vision: <b>{data.selected.vision}</b> · Provider order: <b>{data.selected.order}</b></div>
      {data.ollama.checks.map((check) => <div key={check.model} style={{ color: check.installed ? '#86efac' : '#fca5a5', marginTop: 6 }}>{check.model}: {check.installed ? check.capabilities.join(', ') : check.error}</div>)}
      {data.ollama.error && <div role="alert" style={{ color: '#fbbf24' }}>Ollama: {data.ollama.error}</div>}
      <p>{data.note}</p>
    </div>}
    <button style={button} disabled={busy} onClick={() => void run()}>{busy ? 'Testing models (may take several minutes)...' : 'Test configured models with synthetic inputs'}</button>
    <span style={{ fontSize: 11, color: '#888', marginLeft: 8 }}>Tests may call configured providers; no notes or screenshots are sent.</span>
    {error && <p role="alert" style={{ color: '#fca5a5' }}>{error}</p>}
    {test.map((item) => <p key={item.capability} style={{ color: item.ok ? '#86efac' : '#fca5a5', fontSize: 12 }}>{item.ok ? 'PASS' : 'FAIL'} {item.capability}: {item.model || item.error}</p>)}
  </section>
}
