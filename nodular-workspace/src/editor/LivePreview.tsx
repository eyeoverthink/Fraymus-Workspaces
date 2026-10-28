
import { useWorkflowStore } from '../store/useWorkflowStore'
import { useState } from 'react'

export default function LivePreview() {
  const { previewHtml, nodes } = useWorkflowStore() as any
  const [copied, setCopied] = useState(false)
  const finalImage = (nodes as any).find((n: any) => n.data?.lastOutput?.imageUrl)?.data.lastOutput.imageUrl || (nodes as any[]).slice().reverse().find((n: any) => n.data?.lastOutput?.imageUrl)?.data.lastOutput?.imageUrl

  const copyCurl = () => {
    const curl = `curl -X POST http://localhost:3001/api/workflows/ugc-mirror-selfie-v1/run -H "Content-Type: application/json" -d '{"prompt":"mirror selfie, vintage denim"}'`
    navigator.clipboard.writeText(curl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={{ height: '100%', background: '#fff', color: '#000', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 12px', background: '#f5f5f5', borderBottom: '1px solid #ddd', fontSize: 11, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 700 }}>Live Preview + Deploy</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={copyCurl} style={{ fontSize: 10, padding: '4px 8px', borderRadius: 6, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' }}>{copied ? 'Copied!' : 'Copy cURL'}</button>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {finalImage && <div style={{ padding: 12 }}><img src={finalImage} style={{ width: '100%', borderRadius: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} /><div style={{ fontSize: 10, color: '#666', marginTop: 6 }}>Final 4K output after FLUX → Remover → Upscaler chain</div></div>}
        <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
      </div>
      <div style={{ padding: 12, background: '#0a0a0a', color: '#fff', fontSize: 10, fontFamily: 'monospace' }}>
        <div style={{ color: '#888', marginBottom: 4 }}>DEPLOY AS API ENDPOINT (Your Product):</div>
        <div>POST /api/workflows/ugc-mirror-selfie-v1/run</div>
        <div style={{ color: '#22c55e', marginTop: 4 }}>{`{ "prompt": "mirror selfie" } → { imageUrl, html }`}</div>
        <div style={{ color: '#666', marginTop: 6 }}>This endpoint is the moat. System prompt chain is IP, not model.</div>
      </div>
    </div>
  )
}
