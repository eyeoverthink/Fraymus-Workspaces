import { useEffect, useState, type FormEvent } from 'react'
import type { MegaPack } from '../../server/agent/mega'
import { apiFetch, errorText } from '../lib/api'
import { button, card, field, input, request } from './IdeaLabPanels'

function download(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function PackCard({ url, index }: { url: string; index: number }) {
  const [image, setImage] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true, objectUrl = ''
    void apiFetch(url).then(async (response) => {
      if (!response.ok) throw new Error(await errorText(response))
      objectUrl = URL.createObjectURL(await response.blob())
      if (active) setImage(objectUrl); else URL.revokeObjectURL(objectUrl)
    }).catch((e) => { if (active) setError(e.message) })
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [url])
  return <div>{error ? <p role="alert" style={{ color: '#fca5a5' }}>{error}</p> : image && <a href={image} download={`draft-card-${index + 1}.png`}><img src={image} alt={`Download draft text card ${index + 1}`} style={{ width: '100%', maxHeight: 320, objectFit: 'contain' }} /></a>}</div>
}
type History = { id: string; createdAt: number; status: string; audience: string; mode: string; error?: string }
type ApprovalThread = { run: { status: string; error?: string }; approvals: { id: string; tool: string; args: Record<string, unknown> }[] }

export default function MegaPage() {
  const [transcript, setTranscript] = useState('')
  const [audience, setAudience] = useState('')
  const [useAi, setUseAi] = useState(false)
  const [allowModel, setAllowModel] = useState(false)
  const [variants, setVariants] = useState<10 | 100>(10)
  const [pack, setPack] = useState<MegaPack | null>(null)
  const [history, setHistory] = useState<History[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(false)
  const [threadId, setThreadId] = useState('')
  const [approval, setApproval] = useState<ApprovalThread | null>(null)
  const [whisper, setWhisper] = useState<{ configured: boolean; missing: string[] } | null>(null)
  const reload = async () => setHistory(await request('/api/mega/packs'))
  useEffect(() => {
    void reload().catch((e) => setError(e.message))
    void request('/api/mega/health').then((data) => setWhisper(data.whisper)).catch((e) => setError(e.message))
  }, [])
  useEffect(() => {
    if (!threadId) return
    let active = true
    const poll = async () => {
      try {
        const result: ApprovalThread = await request(`/api/agent/threads/${threadId}`)
        if (!active) return
        setApproval(result)
        if (result.run.status === 'done' || result.run.status === 'error') {
          if (pack) setPack(await request(`/api/mega/packs/${pack.id}`))
          clearInterval(timer)
        }
      } catch (e) { if (active) { setError(e instanceof Error ? e.message : String(e)); clearInterval(timer) } }
    }
    const timer = setInterval(() => void poll(), 2000)
    void poll()
    return () => { active = false; clearInterval(timer) }
  }, [threadId, pack?.id])
  const generate = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setPreview(false); setThreadId(''); setApproval(null)
    try { setPack(await request('/api/mega/run', 'POST', { transcript, audience, useAi, allowModel, variants })); await reload() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); await reload().catch(() => {}) }
    finally { setBusy(false) }
  }
  const transcribe = async (file?: File) => {
    if (!file) return
    setBusy(true); setError('')
    try {
      const body = new FormData(); body.append('audio', file)
      const response = await apiFetch('/api/integrations/whisper/transcribe', { method: 'POST', body })
      if (!response.ok) throw new Error(await errorText(response))
      const result = await response.json()
      if (result.text.length > 10000) throw new Error('Transcript exceeds 10,000 characters; trim it in Connect before creating a pack.')
      setTranscript(result.text)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const queueRender = async () => {
    if (!pack) return
    setBusy(true); setError('')
    try { const result = await request(`/api/mega/packs/${pack.id}/render`, 'POST'); setThreadId(result.threadId) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const decide = async (id: string, approve: boolean) => {
    setBusy(true); setError('')
    try { await request(`/api/agent/approvals/${id}`, 'POST', { approve }); setApproval(await request(`/api/agent/threads/${threadId}`)); if (pack) setPack(await request(`/api/mega/packs/${pack.id}`)) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  return <div style={{ height: '100%', overflow: 'auto', padding: 18, boxSizing: 'border-box' }}><div style={{ maxWidth: 1050, margin: '0 auto' }}>
    <h2>Mega / one-button content draft pack</h2>
    <p style={{ color: '#aaa', fontSize: 13 }}>Brief or genuine transcript → ten hooks and CTAs → ten native portrait PNG cards → narration script → 15-second HTML composition → 10 or 100 draft combinations. No fake transcription, voice, video cloning, revenue promises or automatic publishing.</p>
    <form style={{ ...card, display: 'grid', gap: 12 }} onSubmit={generate}>
      <label style={field}>Who is this for?<input style={input} value={audience} onChange={(e) => setAudience(e.target.value)} required maxLength={120} /></label>
      <label style={field}>Your idea, evidence, or pasted transcript<textarea style={{ ...input, minHeight: 150 }} value={transcript} onChange={(e) => setTranscript(e.target.value)} required minLength={20} maxLength={10000} placeholder="Describe a real problem and an experiment. Claims will still need human review." /></label>
      <label style={field}>Optional local Whisper transcript (16-bit PCM WAV, up to 50 MiB)<input type="file" accept=".wav,audio/wav" disabled={busy || !whisper?.configured} onChange={(e) => void transcribe(e.target.files?.[0])} /><span style={{ fontSize: 11, color: '#888' }}>{whisper?.configured ? 'Transcribes locally; inspect the text before generating.' : `Unavailable: ${whisper?.missing.join(', ') || 'checking configuration...'}. Paste a transcript instead.`}</span></label>
      <label style={{ fontSize: 12 }}><input type="checkbox" checked={useAi} onChange={(e) => { setUseAi(e.target.checked); setAllowModel(false) }} /> Use the configured AI model for original draft copy (otherwise honest local templates)</label>
      {useAi && <label style={{ fontSize: 12, color: '#fbbf24' }}><input type="checkbox" required checked={allowModel} onChange={(e) => setAllowModel(e.target.checked)} /> Send this brief to the server's configured model. Depending on setup, it may be hosted. I will review all claims before use.</label>}
      <label style={field}>Draft hook/CTA combinations<select style={input} value={variants} onChange={(e) => setVariants(e.target.value === '100' ? 100 : 10)}><option value="10">10 paired drafts</option><option value="100">100 combinations (10 hooks x 10 CTAs, not 100 rendered videos)</option></select></label>
      <button style={button} disabled={busy || (useAi && !allowModel)}>{busy ? 'Working...' : 'Run native draft chain'}</button>
    </form>
    {error && <p role="alert" style={{ color: '#fca5a5' }}>{error}</p>}
    {pack && <section style={card}>
      <h3>Pack: {pack.status} / {pack.generation.mode}{pack.generation.model && ` / ${pack.generation.model}`}</h3>
      <p style={{ fontSize: 11, color: '#888' }}>{pack.id} · {new Date(pack.createdAt).toLocaleString()}</p>
      {pack.error && <p role="alert" style={{ color: '#fca5a5' }}>{pack.error}</p>}
      {pack.stages.map((stage) => <p key={stage.step} style={{ fontSize: 12, color: stage.status === 'done' ? '#86efac' : stage.status === 'failed' ? '#fca5a5' : '#fbbf24' }}><b>{stage.step}: {stage.status}</b> — {stage.detail}</p>)}
      {pack.copy && <><p>{pack.copy.summary}</p><details><summary>Hooks, CTAs and narration script</summary>{pack.copy.hooks.map((hook, index) => <p key={index}><b>{index + 1}. {hook}</b><br />{pack.copy!.ctas[index]}</p>)}<p>{pack.copy.narration}</p></details></>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
        <button style={button} onClick={() => download(JSON.stringify(pack, null, 2), `mega-${pack.id}.json`, 'application/json')}>Download full draft JSON</button>
        {pack.composition && <><button style={button} onClick={() => download(pack.composition!, `mega-${pack.id}.html`, 'text/html')}>Download HTML composition</button><button style={button} onClick={() => setPreview(!preview)}>{preview ? 'Close preview' : 'Preview HTML (loads GSAP from CDN)'}</button><button style={button} disabled={busy || !!approval?.approvals.length || approval?.run.status === 'running'} onClick={() => void queueRender()}>Request exact MP4 render approval</button></>}
      </div>
      {preview && pack.composition && <iframe title="Sandboxed draft composition (not a rendered video)" sandbox="allow-scripts" srcDoc={pack.composition.replace('paused:true', 'paused:false')} style={{ width: 360, height: 640, border: '1px solid #444' }} />}
      {approval && <div style={{ ...card, borderColor: '#a16207' }}>
        <b>Render run: {approval.run.status}</b>
        {approval.run.error && <p role="alert">{approval.run.error}</p>}
        {approval.approvals.map((action) => <div key={action.id}><p>{action.tool}: {JSON.stringify(action.args)}</p><p style={{ fontSize: 12 }}>Approving allows HyperFrames execution and possible tooling/CDN downloads. Requires Chrome and FFmpeg. This is not publishing.</p><button style={button} disabled={busy} onClick={() => void decide(action.id, true)}>Approve this render</button> <button style={button} disabled={busy} onClick={() => void decide(action.id, false)}>Reject</button></div>)}
      </div>}
      {pack.render && <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{JSON.stringify(pack.render, null, 2)}</pre>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8 }}>{pack.cards.map((image) => <PackCard key={image.index} {...image} />)}</div>
      <p style={{ color: '#888', fontSize: 11 }}>Click a card to download. All {pack.variants.length} draft combinations are included in JSON. Cards and packs are saved under the server's DATA_DIR; screen captures are not.</p>
    </section>}
    <section style={card}><h3>Saved packs / failed runs</h3>{!history.length && <p style={{ color: '#888' }}>No packs yet.</p>}{history.map((item) => <div key={item.id} style={{ margin: '8px 0' }}><button style={button} disabled={busy} onClick={() => { setPreview(false); setThreadId(''); setApproval(null); void request(`/api/mega/packs/${item.id}`).then(setPack).catch((e) => setError(e.message)) }}>{item.audience} · {item.status} · {item.mode} · {new Date(item.createdAt).toLocaleString()}</button>{item.error && <p style={{ color: '#fca5a5', fontSize: 12 }}>{item.error}</p>}</div>)}</section>
  </div></div>
}
