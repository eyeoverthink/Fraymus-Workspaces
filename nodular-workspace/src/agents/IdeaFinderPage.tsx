import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { apiFetch, errorText } from '../lib/api'
import { toast } from '../components/Toasts'

type Idea = { title: string; format: string; problem: string; evidence: string; twelveHourMvp: string; validation: string; risks: string[] }
type Report = {
  id: string; audience: string; createdAt: number
  evidence: {
    auditedBlocks: number; trackedHours: number
    topActivity: { activity: string; hours: number; averageEnergy: number } | null
    complaintGroups: { complaint: string; slots: number; lowEnergySlots: number }[]
    focus: { pain: string; source: string; matchingBlocks: number; matchingLowEnergyBlocks: number }
  }
  ideas: Idea[]
  pricingMath: { example: string; caveat: string }
  caveats: string[]
  research?: { status: string; query?: string; error?: string; result?: { results?: { title: string; url: string; snippet?: string }[] } }
}

const card = { background: '#111', border: '1px solid #222', borderRadius: 10, padding: 14, marginBottom: 12 } as const
const input = { background: '#0a0a0a', color: '#e5e5e5', border: '1px solid #333', borderRadius: 6, padding: '7px 9px', font: 'inherit', fontSize: 12, width: '100%', boxSizing: 'border-box' as const }
const button = { background: '#1a1a1a', color: '#eee', border: '1px solid #333', borderRadius: 6, padding: '7px 12px', cursor: 'pointer', fontSize: 11 }
const request = async (url: string, init?: RequestInit) => {
  const response = await apiFetch(url, init)
  if (!response.ok) throw new Error(await errorText(response))
  return response.json()
}

export default function IdeaFinderPage() {
  const [audience, setAudience] = useState('')
  const [pain, setPain] = useState('')
  const [includeResearch, setIncludeResearch] = useState(false)
  const [reports, setReports] = useState<Report[]>([])
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await request('/api/idea-finder')
      setReports(data.reports || [])
      setError('')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [])
  useEffect(() => { void load() }, [load])

  const generate = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      const data = await request('/api/idea-finder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audience, pain, includeResearch })
      })
      setReport(data)
      setReports((items) => [data, ...items.filter((item) => item.id !== data.id)].slice(0, 20))
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
      toast('error', message)
    } finally { setLoading(false) }
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 18, boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 1050, margin: '0 auto' }}>
        <h2 style={{ margin: '0 0 5px' }}>Weekend Idea Finder</h2>
        <div style={{ color: '#999', fontSize: 12, marginBottom: 14 }}>
          Turn self-reported time leaks and complaints into three testable business hypotheses. The app does not monitor your activity, and “million-dollar” is not a forecast.
        </div>
        <section style={card}>
          <h3 style={{ margin: '0 0 8px' }}>Start with evidence</h3>
          <div style={{ color: '#aaa', fontSize: 11, marginBottom: 10 }}>
            Uses your manually logged blocks from the last 48 hours. Add a focus pain if you want to explore something different from the most repeated complaint.
          </div>
          <form onSubmit={generate} style={{ display: 'grid', gap: 10 }}>
            <label style={{ display: 'grid', gap: 4, color: '#aaa', fontSize: 11 }}>
              Who is the target customer? (niche or audience)
              <input style={input} value={audience} onChange={(e) => setAudience(e.target.value)} maxLength={120} required placeholder="e.g. independent real-estate agents" />
            </label>
            <label style={{ display: 'grid', gap: 4, color: '#aaa', fontSize: 11 }}>
              Optional: what problem should the ideas focus on?
              <textarea style={{ ...input, minHeight: 55, resize: 'vertical' }} value={pain} onChange={(e) => setPain(e.target.value)} maxLength={300} placeholder="Leave blank to use your most repeated audit complaint" />
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: '#aaa', fontSize: 11 }}>
              <input type="checkbox" checked={includeResearch} onChange={(e) => setIncludeResearch(e.target.checked)} />
              Search the public web for related discussion. This sends the audience and a short pain summary to the configured search service; leave off for private or sensitive notes.
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button style={button} disabled={loading || !audience.trim()}>{loading ? 'Building hypotheses…' : 'Find 3 testable ideas'}</button>
              {reports.length > 0 && (
                <select style={{ ...input, width: 'auto', maxWidth: 340 }} value={report?.id || ''} onChange={(e) => setReport(reports.find((item) => item.id === e.target.value) || null)}>
                  <option value="">Choose a saved report</option>
                  {reports.map((item) => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString()} · {item.audience}</option>)}
                </select>
              )}
            </div>
          </form>
        </section>
        {error && <div role="alert" style={{ ...card, color: '#fca5a5' }}>{error}</div>}
        {report && (
          <>
            <section style={card}>
              <h3 style={{ margin: '0 0 8px' }}>What your audit actually says</h3>
              <div style={{ fontSize: 12, color: '#aaa', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <span>{report.evidence.auditedBlocks} self-reported blocks · {report.evidence.trackedHours}h logged</span>
                {report.evidence.topActivity && <span>Largest time use: {report.evidence.topActivity.activity} ({report.evidence.topActivity.hours}h, energy {report.evidence.topActivity.averageEnergy}/10)</span>}
                <span>Focus: “{report.evidence.focus.pain}” · {report.evidence.focus.source.replace(/-/g, ' ')}</span>
              </div>
              {!report.evidence.auditedBlocks && <div style={{ color: '#fbbf24', fontSize: 11, marginTop: 8 }}>No time blocks are logged yet. These ideas use only the pain you entered; log two days for better evidence.</div>}
              {!!report.evidence.complaintGroups.length && (
                <div style={{ marginTop: 10, fontSize: 11 }}>
                  <strong>Repeated complaints</strong>
                  {report.evidence.complaintGroups.map((item) => <div key={item.complaint} style={{ color: '#aaa', paddingTop: 4 }}>“{item.complaint}” · {item.slots} block(s) · {item.lowEnergySlots} low-energy</div>)}
                </div>
              )}
            </section>
            {report.ideas.map((idea, index) => (
              <article key={idea.title} style={card}>
                <div style={{ fontSize: 10, color: '#22c55e', letterSpacing: 1 }}>HYPOTHESIS {index + 1} · {idea.format.toUpperCase()}</div>
                <h3 style={{ margin: '5px 0 8px' }}>{idea.title}</h3>
                <p style={{ fontSize: 12, color: '#ccc', margin: '0 0 8px' }}>{idea.problem}</p>
                <div style={{ display: 'grid', gap: 8, fontSize: 11, color: '#aaa' }}>
                  <div><b style={{ color: '#ddd' }}>Evidence:</b> {idea.evidence}</div>
                  <div><b style={{ color: '#ddd' }}>12-hour MVP:</b> {idea.twelveHourMvp}</div>
                  <div><b style={{ color: '#ddd' }}>Smallest validation:</b> {idea.validation}</div>
                  <div><b style={{ color: '#ddd' }}>Risks:</b> {idea.risks.join(' ')}</div>
                </div>
              </article>
            ))}
            <section style={card}>
              <b style={{ fontSize: 12 }}>Revenue math is not a forecast</b>
              <div style={{ color: '#aaa', fontSize: 12, marginTop: 5 }}>{report.pricingMath.example}</div>
              <div style={{ color: '#888', fontSize: 11, marginTop: 3 }}>{report.pricingMath.caveat}</div>
              {report.research?.status === 'complete' && (
                <div style={{ marginTop: 12, fontSize: 11 }}>
                  <b>Public search results — signals only, not validation</b>
                  {(report.research.result?.results || []).map((item) => <div key={item.url} style={{ marginTop: 6 }}><a href={item.url} target="_blank" rel="noreferrer" style={{ color: '#93c5fd' }}>{item.title}</a><div style={{ color: '#888' }}>{item.snippet}</div></div>)}
                </div>
              )}
              {report.research?.status === 'failed' && <div role="alert" style={{ color: '#fca5a5', fontSize: 11, marginTop: 8 }}>Public research failed: {report.research.error}</div>}
              {report.caveats.map((item) => <div key={item} style={{ color: '#777', fontSize: 10, marginTop: 5 }}>{item}</div>)}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
