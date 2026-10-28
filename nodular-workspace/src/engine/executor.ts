
import { apiFetch, errorText } from '../lib/api'

export type ExecutionResult = {
  nodeId: string
  type: string
  output: any
  durationMs: number
  error?: string
}

export type WorkflowExecution = {
  workflowId: string
  status: 'running' | 'success' | 'failed'
  results: Record<string, ExecutionResult>
  finalOutput?: { imageUrl?: string, html?: string }
  startedAt: number
  finishedAt?: number
}

// Topological sort
function topologicalSort(nodes: any[], edges: any[]): string[] {
  const inDegree: Record<string, number> = {}
  const adj: Record<string, string[]> = {}
  nodes.forEach((n: any) => { inDegree[n.id] = 0; adj[n.id] = [] })
  edges.forEach((e: any) => {
    if (inDegree[e.target] !== undefined) {
      inDegree[e.target]++
      adj[e.source]?.push(e.target)
    }
  })
  const q = nodes.filter((n: any) => inDegree[n.id] === 0).map((n: any) => n.id)
  const out: string[] = []
  while (q.length) {
    const id = q.shift()!
    out.push(id)
    adj[id]?.forEach((next: string) => {
      inDegree[next]--
      if (inDegree[next] === 0) q.push(next)
    })
  }
  return out
}

// Full executor - no stubs
export async function executeWorkflow(
  nodes: any[],
  edges: any[],
  options: { workflowId?: string, onStart?: (nodeId: string) => void, onProgress?: (r: ExecutionResult) => void } = {}
): Promise<WorkflowExecution> {
  const startedAt = Date.now()
  const sorted = topologicalSort(nodes, edges)
  const results: Record<string, ExecutionResult> = {}
  let finalOutput: any = {}

  console.log('[Executor] Running workflow:', options.workflowId, 'order:', sorted)

  for (const nodeId of sorted) {
    const node = nodes.find((n: any) => n.id === nodeId)
    if (!node) continue
    options.onStart?.(nodeId)
    const t0 = Date.now()
    let output: any = null
    let error: string | undefined = undefined

    try {
      // Resolve inputs from previous nodes
      const incomingEdges = edges.filter((e: any) => e.target === nodeId)
      const incomingOutputs = incomingEdges.map((e: any) => results[e.source]?.output).filter(Boolean)
      const lastImage = [...incomingOutputs].reverse().find((o: any) => o.imageUrl)?.imageUrl
      const lastText = [...incomingOutputs].reverse().find((o: any) => o.text)?.text

      if (node.type === 'llama' || node.type === 'llama-groq') {
        const prompt = node.data.prompt || lastText || 'UGC mirror selfie, iPhone flash'
        const res = await apiFetch('/api/llama', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt })
        })
        if (!res.ok) throw new Error('Llama API failed: ' + await errorText(res))
        output = await res.json()
      }

      else if (node.type === 'flux' || node.type === 'flux-schnell') {
        const prompt = lastText || node.data.prompt || 'mirror selfie'
        console.log('[Executor] FLUX prompt:', prompt)
        const res = await apiFetch('/api/flux', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, model: node.data.model || 'black-forest-labs/FLUX.1-schnell' })
        })
        if (!res.ok) throw new Error('FLUX failed: ' + await errorText(res))
        const blob = await res.blob()
        const imageUrl = URL.createObjectURL(blob)
        output = { imageUrl, prompt, blob }
      }

      else if (node.type === 'remover' || node.type === 'remover-birefnet') {
        const imageUrl = lastImage || node.data.imageUrl
        if (!imageUrl) throw new Error('Remover needs input image')
        const imageBlob = await fetch(imageUrl).then(r => r.blob())
        const form = new FormData()
        form.append('image', imageBlob)
        const res = await apiFetch('/api/remover', { method: 'POST', body: form })
        if (!res.ok) throw new Error('Remover failed: ' + await errorText(res))
        const outBlob = await res.blob()
        const outUrl = URL.createObjectURL(outBlob)
        output = { imageUrl: outUrl, originalUrl: imageUrl }
      }

      else if (node.type === 'upscaler' || node.type === 'upscaler-realesrgan') {
        const imageUrl = lastImage || node.data.imageUrl
        if (!imageUrl) throw new Error('Upscaler needs input image')
        const imageBlob = await fetch(imageUrl).then(r => r.blob())
        const form = new FormData()
        form.append('image', imageBlob)
        form.append('scale', String(node.data.scale || 4))
        const res = await apiFetch('/api/upscaler', { method: 'POST', body: form })
        if (!res.ok) throw new Error('Upscaler failed: ' + await errorText(res))
        const outBlob = await res.blob()
        const outUrl = URL.createObjectURL(outBlob)
        output = { imageUrl: outUrl, originalUrl: imageUrl, scale: node.data.scale || 4, size: res.headers.get('X-Upscale-To') }
      }

      else if (node.type === 'htmlPreview' || node.type === 'html-preview') {
        const imageUrl = lastImage
        const text = lastText || 'Workflow output'
        const html = `
          <div style="padding:24px;font-family:system-ui">
            <h3 style="margin:0 0 12px">Output - ${new Date().toLocaleTimeString()}</h3>
            ${imageUrl ? `<img src="${imageUrl}" style="max-width:100%;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.1)" />` : '<div style="padding:40px;background:#f5f5f5;border-radius:12px">No image yet - run workflow</div>'}
            <p style="color:#666;font-size:13px;margin-top:12px">${text}</p>
            <div style="margin-top:16px;padding:12px;background:#0a0a0a;color:#fff;border-radius:8px;font-family:monospace;font-size:11px">
              Deploy as: POST /api/workflows/${options.workflowId || 'demo'}/run<br/>
              Body: { "prompt": "your prompt" }
            </div>
          </div>
        `
        output = { html, imageUrl, text }
        finalOutput = output
      }

    } catch (e: any) {
      console.error('[Executor] Node failed', nodeId, e)
      error = e.message || String(e)
      output = { error }
    }

    const result: ExecutionResult = {
      nodeId,
      type: node.type,
      output,
      durationMs: Date.now() - t0,
      error
    }
    results[nodeId] = result
    options.onProgress?.(result)

    if (error && node.type !== 'htmlPreview') {
      // continue but mark failed - don't break chain completely
      console.warn('[Executor] Continuing after error in', nodeId)
    }
  }

  return {
    workflowId: options.workflowId || 'local',
    status: Object.values(results).some(r => r.error) ? 'failed' : 'success',
    results,
    finalOutput,
    startedAt,
    finishedAt: Date.now()
  }
}
