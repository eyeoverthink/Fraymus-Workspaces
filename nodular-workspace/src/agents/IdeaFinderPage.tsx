import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { apiFetch, errorText } from '../lib/api'
import { toast } from '../components/Toasts'
import type { IdeaReport } from '../../server/agent/idea-finder'
import type { LabReport } from '../../server/agent/idea-lab'
import { MissionPanel, ReviewPanel, TrendPanel, button, card, field, input, request, safeLink, type LabState } from './IdeaLabPanels'

type Report = IdeaReport & Partial<Pick<LabReport, 'sources' | 'mission' | 'query' | 'generation'>> & { id: string }

export default function IdeaFinderPage({ initialImage, onImageReceived }: { initialImage?: File | null; onImageReceived?: () => void }) {
  const [audience, setAudience] = useState('')
  const [pain, setPain] = useState('')
  const [query, setQuery] = useState('')
  const [notes, setNotes] = useState('')
  const [urls, setUrls] = useState('')
  const [duns, setDuns] = useState('')
  const [imageDescription, setImageDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState('')
  const [imageConsent, setImageConsent] = useState(false)
  const [imageMessage, setImageMessage] = useState('')
  const [imageBusy, setImageBusy] = useState(false)
  const [includeResearch, setIncludeResearch] = useState(false)
  const [includeYoutube, setIncludeYoutube] = useState(false)
  const [fetchSources, setFetchSources] = useState(false)
  const [useAi, setUseAi] = useState(false)
  const [count, setCount] = useState<3 | 10>(10)
  const [lab, setLab] = useState<LabState | null>(null)
  const [reports, setReports] = useState<Report[]>([])
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [labError, setLabError] = useState('')
  useEffect(() => {
    if (!initialImage) return
    setFile(initialImage); setImageConsent(false); setImageMessage('Screenshot received locally. Review it and explicitly allow model analysis below.')
    onImageReceived?.()
  }, [initialImage, onImageReceived])

  const loadLab = useCallback(async () => {
    try { setLab(await request('/api/idea-finder/lab')); setLabError('') }
    catch (e) { setLabError(e instanceof Error ? e.message : String(e)) }
  }, [])
  useEffect(() => {
    void loadLab()
    void request('/api/idea-finder').then((data) => setReports(data.reports || [])).catch((e) => setError(e.message))
  }, [loadLab])
  useEffect(() => {
    if (!file) { setImagePreview(''); return }
    const url = URL.createObjectURL(file)
    setImagePreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const describeImage = async () => {
    if (!file || !imageConsent) return
    setImageBusy(true); setImageMessage('')
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error('Image must be at most 8 MiB')
      const body = new FormData()
      body.append('analyze', 'true')
      body.append('image', file)
      const response = await apiFetch('/api/idea-finder/image', { method: 'POST', body })
      if (!response.ok) throw new Error(await errorText(response))
      const result = await response.json()
      if (result.description) setImageDescription(result.description)
      setImageMessage(`${result.metadata.width} x ${result.metadata.height} ${result.metadata.format}. ${result.note}`)
    } catch (e) { setImageMessage(e instanceof Error ? e.message : String(e)) }
    finally { setImageBusy(false) }
  }
  const generate = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); setError('')
    try {
      const data = await request('/api/idea-finder', 'POST', {
        audience, pain, query, notes, urls: urls.split(/\r?\n/).map((url) => url.trim()).filter(Boolean),
        duns: duns.replace(/[-\s]/g, ''), imageDescription, count, includeResearch, includeYoutube, fetchSources, useAi
      })
      setReport(data)
      setReports((items) => [data, ...items.filter((item) => item.id !== data.id)].slice(0, 20))
    } catch (e) { const message = e instanceof Error ? e.message : String(e); setError(message); toast('error', message) }
    finally { setLoading(false) }
  }
  const preset = () => {
    setQuery('Find ten unusual ways to earn revenue from AI agents, AI agencies, agentic workflows, AI businesses, AI careers, AI employees and practical AI skills. Combine sources into concrete small experiments, not generic hype.')
    if (!audience) setAudience('small businesses and independent professionals')
  }
  return <div style={{ height: '100%', overflow: 'auto', padding: 18, boxSizing: 'border-box' }}>
    <div style={{ maxWidth: 1050, margin: '0 auto' }}>
      <h2 style={{ margin: '0 0 5px' }}>Idea Finder / creative research lab</h2>
      <p style={{ color: '#999', fontSize: 12 }}>Combine natural language, business URLs, GitHub profiles, permitted social content, D-U-N-S context, images and your time audit into testable ideas. Free-first local combinations work without a model; configured AI can synthesize more original options.</p>
      {labError && <div role="alert" style={{ ...card, color: '#fca5a5' }}>Could not load mission and monitoring: {labError} <button style={button} onClick={() => void loadLab()}>Retry</button></div>}
      {lab && <details style={card}><summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>Mission, moonshot goals and creativity monitoring</summary><div style={{ marginTop: 12 }}><MissionPanel lab={lab} onSaved={() => void loadLab()} /></div></details>}
      <section style={card}>
        <h3 style={{ margin: '0 0 10px' }}>Combine inputs / ask in your own words</h3>
        <form onSubmit={generate} style={{ display: 'grid', gap: 12 }}>
          <label style={field}>Natural-language search / creative brief<textarea style={{ ...input, minHeight: 75 }} value={query} maxLength={1000} onChange={(e) => setQuery(e.target.value)} placeholder="Combine this business with what this GitHub project can do. What service could I prototype this weekend?" /></label>
          <div><button type="button" style={button} onClick={preset}>Load ten AI money / career / agency angles</button></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))', gap: 10 }}>
            <label style={field}>Target customer / audience<input style={input} required value={audience} maxLength={120} onChange={(e) => setAudience(e.target.value)} placeholder="e.g. independent real-estate agents" /></label>
            <label style={field}>Optional focus pain<input style={input} value={pain} maxLength={300} onChange={(e) => setPain(e.target.value)} placeholder="Or use your brief, pasted evidence or time audit" /></label>
          </div>
          <label style={field}>Paste business info, permitted Instagram text, D&amp;B report excerpts, observations, or keywords<textarea style={{ ...input, minHeight: 100 }} value={notes} maxLength={12000} onChange={(e) => setNotes(e.target.value)} placeholder="Use only information you are authorized to share. Private paid reports are not fetched automatically." /></label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))', gap: 10 }}>
            <label style={field}>Public HTTPS business / GitHub / Instagram / D&amp;B links (one per line, up to 5)<textarea style={{ ...input, minHeight: 80 }} value={urls} onChange={(e) => setUrls(e.target.value)} placeholder={'https://example.com\nhttps://github.com/owner/project'} /></label>
            <label style={field}>Optional D-U-N-S identifier<input style={input} value={duns} maxLength={11} onChange={(e) => setDuns(e.target.value)} placeholder="Nine digits; context only, no database verification" /><span style={{ fontSize: 11 }}>Instagram links are recorded but not scraped. Paste permitted content. No proprietary Dun &amp; Bradstreet API access is claimed.</span></label>
          </div>
          <details open={file ? true : undefined} style={{ border: '1px solid #333', borderRadius: 6, padding: 10 }}><summary style={{ cursor: 'pointer', fontSize: 12 }}>Add an image or screenshot</summary>
            <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
              <input aria-label="Idea evidence image" type="file" accept="image/png,image/jpeg,image/webp" disabled={imageBusy} onChange={(e) => { setFile(e.target.files?.[0] || null); setImageMessage(''); setImageConsent(false) }} />
              {imagePreview && <img alt="Selected idea evidence preview" src={imagePreview} style={{ maxWidth: '100%', maxHeight: 200, objectFit: 'contain' }} />}
              <label style={{ fontSize: 12, color: '#aaa' }}><input type="checkbox" checked={imageConsent} onChange={(e) => setImageConsent(e.target.checked)} /> Allow this image to be analyzed by the configured vision model (may be hosted). No image bytes are saved.</label>
              <div><button type="button" style={button} disabled={!file || !imageConsent || imageBusy} onClick={() => void describeImage()}>{imageBusy ? 'Analyzing...' : 'Analyze image / check local support'}</button></div>
              {imageMessage && <div role="status" style={{ color: '#fbbf24', fontSize: 12 }}>{imageMessage}</div>}
              <label style={field}>Image description / readable text (review model output, or enter manually)<textarea style={input} value={imageDescription} maxLength={4000} onChange={(e) => setImageDescription(e.target.value)} /></label>
              <span style={{ color: '#888', fontSize: 11 }}>Manual descriptions work offline. Automatic analysis requires IDEA_VISION_MODEL and a genuinely vision-capable configured model. Only the reviewed description goes into the report.</span>
            </div>
          </details>
          <div style={{ display: 'grid', gap: 8, fontSize: 12, color: '#aaa' }}>
            <label><input type="checkbox" checked={fetchSources} onChange={(e) => setFetchSources(e.target.checked)} /> Fetch the public source URLs above (contacts those sites; no login bypass).</label>
            <label><input type="checkbox" checked={includeResearch} onChange={(e) => setIncludeResearch(e.target.checked)} /> Search public web discussion using the brief / audience. Do not include sensitive information in a search.</label>
            <label><input type="checkbox" checked={includeYoutube} onChange={(e) => setIncludeYoutube(e.target.checked)} /> Search YouTube for up to ten video signals (titles / channels only, not watched or verified).</label>
            <label><input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} /> Use configured AI for synthesis. Sends collected evidence, time-audit summary, saved mission and review feedback to the configured model chain (local or hosted). Leave off for local deterministic combinations.</label>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ ...field, gridAutoFlow: 'column', alignItems: 'center' }}>Ideas<select style={{ ...input, width: 'auto' }} value={count} onChange={(e) => setCount(Number(e.target.value) === 3 ? 3 : 10)}><option value={3}>3 focused</option><option value={10}>10 divergent</option></select></label>
            <button style={button} disabled={loading || imageBusy || !audience.trim()}>{loading ? 'Researching and combining...' : `Create ${count} testable ideas`}</button>
            {!!reports.length && <select aria-label="Saved idea reports" style={{ ...input, width: 'auto', maxWidth: '100%' }} value={report?.id || ''} onChange={(e) => setReport(reports.find((item) => item.id === e.target.value) || null)}>
              <option value="">Choose a saved report</option>{reports.map((item) => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString()} - {item.audience}</option>)}
            </select>}
          </div>
        </form>
      </section>
      {error && <div role="alert" style={{ ...card, color: '#fca5a5' }}>{error}</div>}
      {report && <>
        <section style={card}>
          <h3 style={{ margin: '0 0 8px' }}>Evidence and generation mode</h3>
          <div style={{ fontSize: 12, color: '#aaa' }}>{report.evidence.auditedBlocks} self-reported blocks / {report.evidence.trackedHours}h. Focus: "{report.evidence.focus.pain}".</div>
          <p style={{ fontSize: 12, color: '#86efac' }}>{report.generation?.mode === 'llm' ? `AI synthesis: ${report.generation.provider} / ${report.generation.model}` : report.generation?.mode === 'agent-draft' ? 'Agent-authored draft saved for human review (source claims remain unverified)' : 'Local evidence combinator (deterministic, not LLM-authored)'}</p>
          {report.generation?.error && <div role="status" style={{ color: '#fbbf24', fontSize: 12 }}>{report.generation.error}</div>}
          {report.sources?.filter((source) => source.status === 'failed' || source.status === 'blocked').map((source) => <p role="alert" key={source.id} style={{ color: '#fbbf24', fontSize: 12 }}>{source.id} / {source.kind}: {source.error || 'Source unavailable; inspect the ledger below.'}</p>)}
          {report.mission && <p style={{ fontSize: 12, color: '#aaa' }}>Mission snapshot: {report.mission.mission} Stretch goal: ${report.mission.revenueGoal.toLocaleString()} over {report.mission.horizonDays} days; not a forecast.</p>}
          {!!report.sources?.length && <details><summary style={{ cursor: 'pointer', fontSize: 12 }}>Source ledger ({report.sources.length}) - access limits and failures included</summary>
            {report.sources.map((source) => <div key={source.id} style={{ borderTop: '1px solid #333', padding: '9px 0', fontSize: 12 }}>
              <b>{source.id} / {source.kind} / {source.status}</b> - {safeLink(source.url) ? <a href={safeLink(source.url)} target="_blank" rel="noreferrer" style={{ color: '#93c5fd' }}>{source.title}</a> : source.title}
              <div style={{ color: '#888', fontSize: 11 }}>{new Date(source.fetchedAt).toLocaleString()}</div>
              {source.error && <div style={{ color: '#fbbf24' }}>{source.error}</div>}
              {source.text && <p style={{ color: '#aaa', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{source.text}</p>}
            </div>)}
          </details>}
        </section>
        {report.ideas.map((idea, index) => <article key={`${report.id}-${index}`} style={card}>
          <div style={{ fontSize: 10, color: '#22c55e', letterSpacing: 1 }}>HYPOTHESIS {index + 1} / {idea.format.toUpperCase()}</div>
          <h3 style={{ margin: '5px 0 8px' }}>{idea.title}</h3>
          <p style={{ color: '#ccc', fontSize: 12 }}>{idea.problem}</p>
          <div style={{ display: 'grid', gap: 8, fontSize: 12, color: '#aaa' }}>
            <div><b>Evidence:</b> {idea.evidence}</div><div><b>12-hour MVP:</b> {idea.twelveHourMvp}</div>
            <div><b>Validation experiment:</b> {idea.validation}</div><div><b>Risks:</b> {idea.risks.join(' ')}</div>
            {'sourceIds' in idea && Array.isArray(idea.sourceIds) && <div><b>Source citations:</b> {idea.sourceIds.join(', ') || 'User problem / audit only'}</div>}
          </div>
          <ReviewPanel reportId={report.id} index={index} review={lab?.reviews.find((review) => review.reportId === report.id && review.ideaIndex === index)} onSaved={() => void loadLab()} />
        </article>)}
        <section style={card}>
          <b style={{ fontSize: 12 }}>Revenue math is not a forecast</b>
          <p style={{ color: '#aaa', fontSize: 12 }}>{report.pricingMath.example}. {report.pricingMath.caveat}</p>
          {report.caveats.map((text) => <p key={text} style={{ color: '#888', fontSize: 11 }}>{text}</p>)}
        </section>
      </>}
      {lab && <TrendPanel scans={lab.scans} onSaved={() => void loadLab()} />}
    </div>
  </div>
}
