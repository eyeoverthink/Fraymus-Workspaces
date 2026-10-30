// Fraymus Portal bridge: lets agents (Genesis, Director, ...) call the Fraymus OS One studio
// through the portal's JSON API (Fraymus-OS-One branch fraymus-portal, `node portal/src/server.js --http`).
//
//   PORTAL_URL      default http://127.0.0.1:4191  (the portal only binds to loopback)
//   PORTAL_TOKEN    optional; sent as Authorization: Bearer <token>
//   PORTAL_SAFE_TOOLS  optional comma list overriding which portal tools run without approval
//   PORTAL_ENABLED=0   hide the bridge tools entirely
//
// The URL comes from the server's environment only, never from agent arguments, so this does not
// reopen the private-address hole that safeFetch closes for http_get.
import http from 'node:http'
import https from 'node:https'
import type { Tool } from './tools'

// Read-only (or dry-run) portal tools. Everything else (project_create, site_publish, export_zip,
// opeg_execute, pixel_*, brain_cortex_chat, brain_think with persist=true) goes through portal_call_write,
// which needs user approval.
const DEFAULT_SAFE = ['studio_health', 'brain_status', 'brain_memory_get', 'brain_think', 'opeg_protocol', 'project_list', 'project_get', 'mail_list']
export const portalSafe = () => (process.env.PORTAL_SAFE_TOOLS ? process.env.PORTAL_SAFE_TOOLS.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_SAFE)
export const portalBase = () => (process.env.PORTAL_URL || 'http://127.0.0.1:4191').replace(/\/$/, '')

const TOOL_RE = /^[a-z_]{1,64}$/

// Uses node:http(s) rather than fetch(): it works on any PORTAL_URL port, including ones on the
// WHATWG fetch "bad ports" list (e.g. the portal's old default 4190), which fetch() refuses.
function request(url: URL, method: string, headers: Record<string, string>, body: string | undefined, timeout: number) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http
    const req = mod.request(url, { method, headers: body !== undefined ? { ...headers, 'Content-Length': String(Buffer.byteLength(body)) } : headers, timeout }, (res) => {
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (c: Buffer) => {
        size += c.length
        if (size > 30 * 1024 * 1024) { req.destroy(new Error('portal response too large')); return }
        chunks.push(c)
      })
      res.on('end', () => resolve({ status: res.statusCode || 0, text: Buffer.concat(chunks).toString('utf8') }))
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(Object.assign(new Error(`timed out after ${timeout}ms`), { code: 'ETIMEDOUT' })))
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

async function portalFetch(path: string, init: { method?: string; body?: any; timeout?: number } = {}) {
  const url = new URL(portalBase() + path)
  if (!/^https?:$/.test(url.protocol)) throw new Error('PORTAL_URL must be http(s)')
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  if (process.env.PORTAL_TOKEN) headers.Authorization = `Bearer ${process.env.PORTAL_TOKEN}`
  let r: { status: number; text: string }
  try {
    r = await request(url, init.method || 'GET', headers, init.body !== undefined ? JSON.stringify(init.body) : undefined, init.timeout || 120000)
  } catch (e: any) {
    const why = e?.code || e?.message || 'network error'
    throw new Error(`Fraymus Portal unreachable at ${portalBase()} (${why}). Start it with \`node portal/src/server.js --http\` in Fraymus-OS-One (branch fraymus-portal) and the studio on 127.0.0.1:4177, or set PORTAL_URL.`)
  }
  let body: any = r.text
  try { body = JSON.parse(r.text) } catch {}
  if (r.status === 401) throw new Error('Fraymus Portal rejected the token: set PORTAL_TOKEN to the value the portal was started with')
  if (r.status === 403) throw new Error(`Fraymus Portal refused the request (403: ${body?.error || 'forbidden'}). PORTAL_URL must use 127.0.0.1/localhost or a host listed in the portal's PORTAL_ALLOWED_HOSTS`)
  if (r.status >= 300 && r.status < 400) throw new Error(`Fraymus Portal answered with a redirect (${r.status}); PORTAL_URL should point straight at the portal`)
  return { status: r.status, body }
}

// Drop inline base64 images so they don't flood the model context; keep size + mime.
function shape(body: any) {
  if (body && typeof body === 'object' && body.image?.data) {
    const { image, ...rest } = body
    return { ...rest, image: { mimeType: image.mimeType, bytes: Math.round(String(image.data).length * 0.75), note: 'inline image omitted; see result for the saved file path' } }
  }
  return body
}

async function call(tool: string, args: any) {
  if (!TOOL_RE.test(tool)) throw new Error('tool must be a portal tool name like "brain_think" (see portal_list_tools)')
  const { status, body } = await portalFetch(`/tools/${tool}`, { method: 'POST', body: args && typeof args === 'object' ? args : {}, timeout: 10 * 60_000 })
  if (status === 404) throw new Error(`unknown portal tool "${tool}" (see portal_list_tools)`)
  if (status === 400) throw new Error(`bad arguments for ${tool}: ${JSON.stringify(body?.error ?? body).slice(0, 800)}`)
  // 502 = the tool ran but the studio/Ollama/converter failed; pass the real error and receipt back.
  return { tool, httpStatus: status, ...shape(body) }
}

// Compact arg list ("goal: string (required)") so 16 tools fit in one tool result (results are clipped at 8k chars).
const argSummary = (schema: any) => {
  const req = new Set(schema?.required || [])
  return Object.fromEntries(Object.entries<any>(schema?.properties || {}).map(([k, v]) => [k, `${v.type || (v.anyOf ? 'any' : 'object')}${req.has(k) ? ' (required)' : ''}`]))
}

export const portalTools = (): Tool[] => (process.env.PORTAL_ENABLED === '0' ? [] : [
  {
    name: 'portal_list_tools', risk: 'safe',
    description: 'List the Fraymus OS One studio tools available through the Fraymus Portal (8-bit pixel art, talking seals, site publish, zip export, OPEG, the symbolic Think loop, local mail). Shows each tool\'s input schema and whether it runs freely (portal_call) or needs approval (portal_call_write).',
    parameters: { type: 'object', properties: {} },
    async run() {
      const [{ body: health }, { status, body }] = await Promise.all([portalFetch('/health', { timeout: 10000 }), portalFetch('/tools', { timeout: 10000 })])
      if (status !== 200) throw new Error(`portal /tools returned ${status}`)
      const safe = new Set(portalSafe())
      return {
        portal: portalBase(), studio: health?.studio, auth: health?.auth,
        tools: (body.tools || []).map((t: any) => ({ name: t.name, via: safe.has(t.name) ? 'portal_call' : 'portal_call_write (approval)', description: String(t.description || '').slice(0, 220), args: argSummary(t.inputSchema) }))
      }
    }
  },
  {
    name: 'portal_call', risk: 'safe',
    description: 'Call a read-only Fraymus Portal tool: studio_health, brain_status, brain_memory_get, brain_think (dry run: integer goals like "8 / 2", "remember x = 5"), opeg_protocol, project_list, project_get, mail_list. Returns {ok, result, receipt} where receipt.hash is a SHA-256 chained proof of the call. For tools that create files, publish or call models use portal_call_write.',
    parameters: { type: 'object', properties: { tool: { type: 'string', description: 'portal tool name, e.g. brain_think' }, args: { type: 'object', description: 'tool arguments, e.g. {"goal":"8 / 2"}' } }, required: ['tool'] },
    async run(a) {
      const tool = String(a.tool || '')
      if (!portalSafe().includes(tool)) throw new Error(`${tool} is not a read-only portal tool; use portal_call_write (needs user approval)`)
      const args = { ...(a.args || {}) }
      if (tool === 'brain_think' && args.persist) throw new Error('brain_think with persist=true changes the saved mind; use portal_call_write')
      return call(tool, args)
    }
  },
  {
    name: 'portal_call_write', risk: 'approval',
    description: 'Call any Fraymus Portal tool, including ones with side effects: project_create, site_publish, export_zip, pixel_render (photo to 8-bit art via Hugging Face), pixel_convert / pixel_video (macOS only), opeg_execute, brain_cortex_chat (local Ollama), brain_think with persist=true. Requires user approval.',
    parameters: { type: 'object', properties: { tool: { type: 'string' }, args: { type: 'object' } }, required: ['tool'] },
    async run(a) { return call(String(a.tool || ''), a.args || {}) }
  }
])
