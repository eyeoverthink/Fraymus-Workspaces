import { mkdirSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { runLlama, runFlux, runRemover, runUpscaler } from './services'
import { uploadImage } from './lib/supabase'

const OUT_DIR = `${process.env.DATA_DIR || './data'}/outputs`

export async function saveImage(png: Buffer): Promise<string> {
  const name = `${Date.now()}-${randomBytes(4).toString('hex')}.png`
  const remote = await uploadImage(png, name)
  if (remote) return remote
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(`${OUT_DIR}/${name}`, png)
  return `/outputs/${name}`
}
export const outputsDir = OUT_DIR

const kind = (t: string) =>
  t.includes('llama') ? 'llama' : t.includes('flux') ? 'flux' : t.includes('remover') ? 'remover'
    : t.includes('upscaler') ? 'upscaler' : t.includes('html') ? 'html' : 'unknown'

export function topoSort(nodes: any[], edges: any[]): string[] {
  const inDeg: Record<string, number> = {}
  const adj: Record<string, string[]> = {}
  nodes.forEach((n) => { inDeg[n.id] = 0; adj[n.id] = [] })
  edges.forEach((e) => {
    if (inDeg[e.target] === undefined || !adj[e.source]) return
    inDeg[e.target]++
    adj[e.source].push(e.target)
  })
  const q = nodes.filter((n) => inDeg[n.id] === 0).map((n) => n.id)
  const out: string[] = []
  while (q.length) {
    const id = q.shift()!
    out.push(id)
    for (const nx of adj[id]) if (--inDeg[nx] === 0) q.push(nx)
  }
  if (out.length !== nodes.length) throw new Error('Workflow graph has a cycle')
  return out
}

export type PipelineResult = {
  status: 'success' | 'failed'
  results: Record<string, { type: string; durationMs: number; error?: string; text?: string; imageUrl?: string }>
  imageUrl?: string
  html?: string
  durationMs: number
}

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string))

export async function runPipeline(nodes: any[], edges: any[], opts: { prompt?: string; image?: Buffer } = {}): Promise<PipelineResult> {
  const t0 = Date.now()
  const order = topoSort(nodes, edges)
  const buffers: Record<string, Buffer> = {}
  const texts: Record<string, string> = {}
  const results: PipelineResult['results'] = {}
  let imageUrl: string | undefined
  let html: string | undefined
  let failed = false

  for (const id of order) {
    const node = nodes.find((n) => n.id === id)!
    const k = kind(node.type)
    const start = Date.now()
    const incoming = edges.filter((e) => e.target === id).map((e) => e.source)
    const upstreamImg = incoming.map((s) => buffers[s]).filter(Boolean).pop() || (k === 'remover' || k === 'upscaler' ? opts.image : undefined)
    const upstreamText = incoming.map((s) => texts[s]).filter(Boolean).pop()
    const r: PipelineResult['results'][string] = { type: node.type, durationMs: 0 }
    try {
      if (incoming.some((s) => results[s]?.error)) throw new Error('Skipped: upstream node failed')
      if (k === 'llama') {
        const prompt = opts.prompt || node.data?.prompt || 'UGC mirror selfie, iPhone flash'
        const out = await runLlama(prompt, node.data?.systemPrompt)
        texts[id] = r.text = out.text
      } else if (k === 'flux') {
        const prompt = upstreamText || opts.prompt || node.data?.prompt || 'mirror selfie'
        const { png } = await runFlux(prompt)
        buffers[id] = png
        r.imageUrl = await saveImage(png)
      } else if (k === 'remover') {
        if (!upstreamImg) throw new Error('Remover needs an input image')
        const { png } = await runRemover(upstreamImg)
        buffers[id] = png
        r.imageUrl = await saveImage(png)
      } else if (k === 'upscaler') {
        if (!upstreamImg) throw new Error('Upscaler needs an input image')
        const { png } = await runUpscaler(upstreamImg, Number(node.data?.scale) || 4)
        buffers[id] = png
        r.imageUrl = await saveImage(png)
      } else if (k === 'html') {
        const src = incoming.map((s) => results[s]?.imageUrl).filter(Boolean).pop()
        imageUrl = src
        html = `<div style="padding:24px;font-family:system-ui">${src ? `<img src="${esc(src)}" style="max-width:100%;border-radius:12px"/>` : ''}<p style="color:#666;font-size:13px">${esc(upstreamText || '')}</p></div>`
      } else {
        throw new Error(`Unknown node type: ${node.type}`)
      }
      if (k !== 'html' && r.imageUrl) imageUrl = r.imageUrl
      if (k === 'llama' && r.text) texts[id] = r.text
    } catch (e: any) {
      r.error = e.message || String(e)
      failed = true
    }
    r.durationMs = Date.now() - start
    results[id] = r
  }
  return { status: failed ? 'failed' : 'success', results, imageUrl, html, durationMs: Date.now() - t0 }
}
