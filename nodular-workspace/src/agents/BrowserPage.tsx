import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { browserUrl, captureScreenshot } from '../lib/screen-capture'
import { button, card, input } from './IdeaLabPanels'

export default function BrowserPage({ onUseScreenshot }: { onUseScreenshot: (file: File) => void }) {
  const [address, setAddress] = useState('https://example.com')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [redactions, setRedactions] = useState(0)
  const [ready, setReady] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const capture = useRef<AbortController | null>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => () => capture.current?.abort(), [])
  useEffect(() => {
    setReady(false)
    if (!file) return
    const objectUrl = URL.createObjectURL(file)
    let active = true
    const image = new Image()
    image.onload = () => {
      if (!active || !canvas.current) return
      canvas.current.width = image.naturalWidth
      canvas.current.height = image.naturalHeight
      const context = canvas.current.getContext('2d')
      if (!context) { setError('Screenshot preview is unavailable.'); return }
      context.drawImage(image, 0, 0)
      setRedactions(0)
      setReady(true)
    }
    image.onerror = () => { if (active) setError('Screenshot preview failed to load.') }
    image.src = objectUrl
    return () => { active = false; URL.revokeObjectURL(objectUrl) }
  }, [file])
  const navigate = () => {
    try { setUrl(browserUrl(address.trim(), window.location.origin)); setError('') }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  const takeScreenshot = async () => {
    setError(''); setBusy(true)
    const controller = new AbortController()
    capture.current = controller
    try {
      const screenshot = await captureScreenshot(controller.signal)
      if (!controller.signal.aborted) { setReady(false); setFile(screenshot) }
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e))
    } finally { if (!controller.signal.aborted) setBusy(false); capture.current = null }
  }
  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(event.currentTarget.width, (event.clientX - bounds.left) * event.currentTarget.width / bounds.width)),
      y: Math.max(0, Math.min(event.currentTarget.height, (event.clientY - bounds.top) * event.currentTarget.height / bounds.height))
    }
  }
  const redact = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drag.current) return
    const end = point(event)
    const start = drag.current
    drag.current = null
    const context = event.currentTarget.getContext('2d')
    if (!context) { setError('Redaction failed. Do not send this screenshot.'); return }
    context.fillStyle = '#000000'
    const width = Math.abs(end.x - start.x), height = Math.abs(end.y - start.y)
    if (width < 2 || height < 2) return
    context.fillRect(Math.min(start.x, end.x), Math.min(start.y, end.y), width, height)
    setRedactions((count) => count + 1)
  }
  const useReviewed = () => {
    if (!ready || busy) return
    canvas.current?.toBlob((blob) => {
      if (!blob) { setError('Screenshot export failed.'); return }
      onUseScreenshot(new File([blob], `reviewed-screen-${Date.now()}.png`, { type: 'image/png' }))
    }, 'image/png')
  }
  return <div style={{ height: '100%', overflow: 'auto', padding: 18, boxSizing: 'border-box' }}>
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <h2>Browser / capture what you choose to share</h2>
      <p style={{ color: '#aaa', fontSize: 13 }}>Browse an embeddable public page, or open a site in your own tab and sign in there. Choose the tab/window in your browser's permission picker. Nodular does not obtain your cookies, crawl logged-in pages, bypass site restrictions, or capture in the background.</p>
      <section style={card}>
        <form onSubmit={(event) => { event.preventDefault(); navigate() }} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <input style={{ ...input, flex: 1, minWidth: 250 }} type="url" aria-label="Browser website address" value={address} onChange={(event) => setAddress(event.target.value)} required placeholder="https://example.com" />
          <button style={button}>Browse in panel</button>
          <button type="button" style={button} onClick={() => { try { const target = browserUrl(address.trim(), window.location.origin); window.open(target, '_blank', 'noopener,noreferrer') } catch (e) { setError(e instanceof Error ? e.message : String(e)) } }}>Open your own tab</button>
        </form>
        <p style={{ color: '#fbbf24', fontSize: 12 }}>Some sites prohibit embedding or need normal-tab login/storage. A blank/refused panel is not success: use Open your own tab, then capture that tab. The app cannot detect or read a cross-origin panel's contents.</p>
        {url && <iframe title="User-requested website (may refuse embedding)" src={url} sandbox="allow-scripts allow-forms allow-popups" referrerPolicy="no-referrer" style={{ width: '100%', height: 480, border: '1px solid #444', background: '#fff' }} />}
        <button style={{ ...button, marginTop: 10 }} disabled={busy} onClick={() => void takeScreenshot()}>{busy ? 'Waiting for selected screen...' : 'Capture selected tab / window'}</button>
        <p style={{ color: '#888', fontSize: 12 }}>Capture stops immediately after one frame. Review and redact before sharing; avoid passwords, payment details, private messages, and content you are not allowed to share. Nothing is sent to the server or a model during capture.</p>
      </section>
      {error && <p role="alert" style={{ color: '#fca5a5' }}>{error}</p>}
      {file && <section style={card}>
        <h3>Review screenshot locally</h3>
        <p style={{ color: '#aaa', fontSize: 12 }}>Drag a rectangle over any sensitive area to cover it in black. {redactions} redaction(s). Sending uses only this visible, redacted image; the original is not uploaded.</p>
        <canvas aria-label="Screenshot preview; drag to redact" ref={canvas} onPointerDown={(event) => { drag.current = point(event); event.currentTarget.setPointerCapture(event.pointerId) }} onPointerUp={redact} onPointerCancel={() => { drag.current = null }} style={{ display: 'block', maxWidth: '100%', height: 'auto', cursor: 'crosshair', touchAction: 'none', border: '1px solid #555' }} />
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button style={button} disabled={!ready || busy} onClick={useReviewed}>Use reviewed screenshot in Idea Finder</button>
          <button style={button} onClick={() => { setFile(null); drag.current = null }}>Discard screenshot</button>
        </div>
        <p style={{ color: '#888', fontSize: 11 }}>Idea Finder asks separately for permission to send the image to its configured vision model. A screenshot is supplied evidence, not proof of the page's authenticity or a financial claim.</p>
      </section>}
    </div>
  </div>
}
