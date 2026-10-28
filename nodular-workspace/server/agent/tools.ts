import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { existsSync, readFileSync } from 'node:fs'
import { db, now } from './db'
import { runFlux, runRemover, runUpscaler } from '../services'
import { saveImage, outputsDir, runPipeline } from '../pipeline'
import type { Store } from '../store'
import type { ToolSpec } from './llm'

export type ToolCtx = {
  userId: string; agentId: string; threadId: string; depth: number; store: Store
  delegate: (agentId: string, task: string) => Promise<string>
}
export type Tool = ToolSpec & { risk: 'safe' | 'approval'; run: (args: any, ctx: ToolCtx) => Promise<any> }

const isPrivateIp = (ip: string): boolean => {
  if (ip.startsWith('::ffff:')) return isPrivateIp(ip.slice(7))
  if (isIP(ip) === 6) return ip === '::1' || ip === '::' || /^f[cd]/i.test(ip) || /^fe[89ab]/i.test(ip)
  const [a, b] = ip.split('.').map(Number)
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
}

// Blocks loopback/private/metadata targets (also across redirects) unless ALLOW_PRIVATE_FETCH=1
export async function safeFetch(url: string, init: RequestInit = {}, hops = 0): Promise<Response> {
  const u = new URL(url)
  if (!/^https?:$/.test(u.protocol)) throw new Error('only http(s) URLs are allowed')
  if (process.env.ALLOW_PRIVATE_FETCH !== '1') {
    const host = u.hostname.replace(/^\[|\]$/g, '')
    const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true })
    if (addrs.some((a) => isPrivateIp(a.address))) throw new Error('blocked: private or local address')
  }
  const res = await fetch(u, { ...init, redirect: 'manual', signal: AbortSignal.timeout(20000) })
  if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
    if (hops >= 3) throw new Error('too many redirects')
    return safeFetch(new URL(res.headers.get('location')!, u).toString(), init, hops + 1)
  }
  return res
}

async function loadImage(url: string): Promise<Buffer> {
  const m = url.match(/^\/outputs\/([\w.-]+\.png)$/)
  if (m) {
    const p = `${outputsDir}/${m[1]}`
    if (!existsSync(p)) throw new Error('image not found')
    return readFileSync(p)
  }
  const res = await safeFetch(url)
  if (!res.ok) throw new Error(`image fetch failed: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

const clip = (s: string, n = 8000) => (s.length > n ? s.slice(0, n) + '…[truncated]' : s)
const stripHtml = (h: string) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()

async function webSearch(query: string) {
  if (process.env.SEARXNG_URL) {
    const r = await safeFetch(`${process.env.SEARXNG_URL.replace(/\/$/, '')}/search?format=json&q=${encodeURIComponent(query)}`)
    if (!r.ok) throw new Error(`searxng ${r.status}`)
    return ((await r.json()) as any).results.slice(0, 6).map((x: any) => ({ title: x.title, url: x.url, snippet: x.content }))
  }
  const r = await safeFetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NodularAgent/1.0)' } })
  if (!r.ok) throw new Error(`search failed: ${r.status}`)
  const html = await r.text()
  const out: any[] = []
  const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) && out.length < 6) {
    const href = m[1].startsWith('//') ? 'https:' + m[1] : m[1]
    const target = new URL(href).searchParams.get('uddg') || href
    out.push({ title: stripHtml(m[2]), url: decodeURIComponent(target), snippet: stripHtml(m[3]) })
  }
  return out
}

export const builtinTools: Tool[] = [
  {
    name: 'memory_save', risk: 'safe', description: 'Save a durable fact or preference about the user or their work so it is remembered in future conversations.',
    parameters: { type: 'object', properties: { text: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['text'] },
    async run(a, c) {
      const text = String(a.text || '').trim().slice(0, 2000)
      if (!text) throw new Error('text required')
      db.prepare('insert into memories(user_id,agent_id,text,tags,created_at) values(?,?,?,?,?)').run(c.userId, c.agentId, text, JSON.stringify(a.tags || []), now())
      return { saved: true }
    }
  },
  {
    name: 'memory_search', risk: 'safe', description: 'Search saved memories by keywords.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    async run(a, c) { return { memories: searchMemories(c.userId, String(a.query || ''), 8) } }
  },
  {
    name: 'web_search', risk: 'safe', description: 'Search the web. Returns titles, URLs and snippets.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    async run(a) { return { results: await webSearch(String(a.query || '')) } }
  },
  {
    name: 'http_get', risk: 'approval', description: 'Fetch a public web page or JSON endpoint and return its text. Requires user approval.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    async run(a) {
      const r = await safeFetch(String(a.url), { headers: { 'User-Agent': 'NodularAgent/1.0' } })
      const ct = r.headers.get('content-type') || ''
      const body = await r.text()
      return { status: r.status, contentType: ct, text: clip(ct.includes('html') ? stripHtml(body) : body) }
    }
  },
  {
    name: 'generate_image', risk: 'safe', description: 'Generate an image from a text prompt (FLUX). Returns an imageUrl.',
    parameters: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] },
    async run(a) {
      const { png, mocked } = await runFlux(String(a.prompt || ''))
      return { imageUrl: await saveImage(png), placeholder: mocked }
    }
  },
  {
    name: 'remove_background', risk: 'safe', description: 'Remove the background from an image URL. Returns a transparent PNG imageUrl.',
    parameters: { type: 'object', properties: { imageUrl: { type: 'string' } }, required: ['imageUrl'] },
    async run(a) {
      const { png, engine } = await runRemover(await loadImage(String(a.imageUrl)))
      return { imageUrl: await saveImage(png), engine }
    }
  },
  {
    name: 'upscale_image', risk: 'safe', description: 'Upscale an image URL by 2-4x. Returns imageUrl.',
    parameters: { type: 'object', properties: { imageUrl: { type: 'string' }, scale: { type: 'integer', minimum: 1, maximum: 4 } }, required: ['imageUrl'] },
    async run(a) {
      const { png, from, to, engine } = await runUpscaler(await loadImage(String(a.imageUrl)), Math.min(Math.max(parseInt(a.scale) || 4, 1), 4))
      return { imageUrl: await saveImage(png), from, to, engine }
    }
  },
  {
    name: 'list_workflows', risk: 'safe', description: "List the user's saved nodular workflows.",
    parameters: { type: 'object', properties: {} },
    async run(_a, c) { return { workflows: (await c.store.listWorkflows(c.userId)).map((w) => ({ id: w.id, name: w.name, deployed: w.is_deployed, nodes: w.nodes.length })) } }
  },
  {
    name: 'run_workflow', risk: 'approval', description: "Run one of the user's saved nodular workflows (costs 1 credit). Requires approval.",
    parameters: { type: 'object', properties: { workflowId: { type: 'string' }, prompt: { type: 'string' } }, required: ['workflowId'] },
    async run(a, c) {
      const wf = await c.store.getWorkflow(String(a.workflowId))
      if (!wf || wf.user_id !== c.userId) throw new Error('workflow not found')
      if (!(await c.store.consumeCredit(c.userId))) throw new Error('out of credits')
      const r = await runPipeline(wf.nodes, wf.edges, { prompt: a.prompt ? String(a.prompt) : undefined })
      await c.store.saveRun({ workflow_id: wf.id, user_id: c.userId, status: r.status, input_prompt: a.prompt ?? null, results: r.results, final_image_url: r.imageUrl ?? null, final_html: r.html ?? null, duration_ms: r.durationMs })
      return { status: r.status, imageUrl: r.imageUrl, durationMs: r.durationMs, errors: Object.entries(r.results).filter(([, v]: any) => v.error).map(([k, v]: any) => ({ nodeId: k, error: v.error })) }
    }
  },
  {
    name: 'delegate_to_agent', risk: 'safe', description: 'Hand a self-contained task to another specialist agent and get its answer. Use list of agent ids from the system prompt.',
    parameters: { type: 'object', properties: { agentId: { type: 'string' }, task: { type: 'string' } }, required: ['agentId', 'task'] },
    async run(a, c) {
      if (c.depth >= 2) throw new Error('delegation depth limit reached')
      return { answer: await c.delegate(String(a.agentId), String(a.task)) }
    }
  }
]

export function searchMemories(userId: string, query: string, limit: number) {
  const words = [...new Set(query.toLowerCase().match(/[a-z0-9]{3,}/g) || [])]
  const rows = db.prepare('select id,agent_id,text,tags,created_at from memories where user_id=? order by id desc limit 500').all(userId) as any[]
  return rows
    .map((r) => ({ r, score: words.reduce((s, w) => s + (r.text.toLowerCase().includes(w) ? 1 : 0), 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.r.id - a.r.id)
    .slice(0, limit)
    .map((x) => ({ id: x.r.id, text: x.r.text, agent: x.r.agent_id }))
}

// Declarative HTTP tools: wire any self-hosted service (Fraynix engine, Hermes, TTS...) without code.
// A tool is skipped unless every env var it references is set.
type HttpToolDef = {
  name: string; description: string; risk?: 'safe' | 'approval'; method?: 'GET' | 'POST'; url: string
  headers?: Record<string, string>; parameters?: any
}
const envRefs = (s: string) => [...s.matchAll(/\$\{ENV:([A-Z0-9_]+)\}/g)].map((m) => m[1])
const subst = (s: string) => s.replace(/\$\{ENV:([A-Z0-9_]+)\}/g, (_m, k) => process.env[k] || '')

export function loadHttpTools(path = process.env.HTTP_TOOLS_FILE || './config/http-tools.json'): Tool[] {
  if (!existsSync(path)) return []
  const defs: HttpToolDef[] = JSON.parse(readFileSync(path, 'utf8'))
  return defs
    .filter((d) => [d.url, ...Object.values(d.headers || {})].flatMap(envRefs).every((k) => !!process.env[k]))
    .map((d) => ({
      name: d.name, description: d.description, risk: d.risk || 'approval',
      parameters: d.parameters || { type: 'object', properties: {} },
      async run(args: any) {
        const method = d.method || 'POST'
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        for (const [k, v] of Object.entries(d.headers || {})) headers[k] = subst(v)
        let url = subst(d.url)
        if (method === 'GET') url += (url.includes('?') ? '&' : '?') + new URLSearchParams(Object.entries(args).map(([k, v]) => [k, String(v)]))
        const r = await fetch(url, { method, headers, body: method === 'POST' ? JSON.stringify(args) : undefined, signal: AbortSignal.timeout(60000) })
        const text = await r.text()
        let body: any = text
        try { body = JSON.parse(text) } catch {}
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${clip(text, 500)}`)
        return body
      }
    }))
}

let cache: Tool[] | null = null
const extra: Tool[] = []
export function registerTools(tools: Tool[]) {
  for (const t of tools) if (!extra.some((e) => e.name === t.name) && !builtinTools.some((b) => b.name === t.name)) extra.push(t)
}
export function unregisterTools(prefix: string) {
  for (let i = extra.length - 1; i >= 0; i--) if (extra[i].name.startsWith(prefix)) extra.splice(i, 1)
}
export const allTools = () => [...(cache ||= [...builtinTools, ...loadHttpTools()]), ...extra]
export const matchesTool = (allow: string[], name: string) => allow.some((p) => p === name || (p.endsWith('*') && name.startsWith(p.slice(0, -1))))
export const getTool = (n: string) => allTools().find((t) => t.name === n)
export const toolSpec = (t: Tool): ToolSpec => ({ name: t.name, description: t.description, parameters: t.parameters })
export const resultText = (v: any) => clip(typeof v === 'string' ? v : JSON.stringify(v))
