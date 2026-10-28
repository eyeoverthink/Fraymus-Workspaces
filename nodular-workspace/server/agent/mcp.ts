import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { registerTools, unregisterTools } from './tools'
import type { Tool } from './tools'

type ServerDef = {
  name: string
  description?: string
  url?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  headers?: Record<string, string>
  // Tools listed here run without approval; everything else asks first.
  safeTools?: string[]
  // Server is skipped unless every listed env var is set.
  requires?: string[]
  disabled?: boolean
}

export type McpState = { name: string; status: 'connected' | 'skipped' | 'error'; tools: number; detail?: string }
const state: McpState[] = []
export const mcpStatus = () => state

const subst = (s: string) => s.replace(/\$\{ENV:([A-Z0-9_]+)\}/g, (_m, k) => process.env[k] || '')
const withTimeout = <T>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, new Promise<T>((_r, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms}ms`)), ms))])

const MAX_INLINE = 200_000

function flatten(result: any): any {
  if (result?.isError) {
    const msg = (result.content || []).map((c: any) => c.text || '').join('\n') || 'tool error'
    throw new Error(msg.slice(0, 1000))
  }
  const parts = (result?.content || []).map((c: any) => {
    if (c.type === 'text') return c.text
    if (c.type === 'image' || c.type === 'audio') return `[${c.type} ${c.mimeType || ''} ${Math.round((c.data?.length || 0) * 0.75)} bytes omitted]`
    return JSON.stringify(c).slice(0, 500)
  })
  const text = parts.join('\n')
  if (text.length > MAX_INLINE) return text.slice(0, MAX_INLINE) + '…[truncated]'
  if (result?.structuredContent && !text) return result.structuredContent
  return text
}


const clients = new Map<string, Client>()
const defs = new Map<string, ServerDef & { imported?: boolean }>()
const importedFile = () => `${process.env.DATA_DIR || './data'}/mcp-servers.json`

async function connect(def: ServerDef): Promise<{ client: Client; tools: Tool[] }> {
  const client = new Client({ name: 'nodular-workspace', version: '1.0.0' })
  if (def.url) {
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(def.headers || {})) headers[k] = subst(v)
    await withTimeout(client.connect(new StreamableHTTPClientTransport(new URL(subst(def.url)), { requestInit: { headers } })), 15000, 'connect')
  } else if (def.command) {
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
    for (const [k, v] of Object.entries(def.env || {})) env[k] = subst(v)
    await withTimeout(client.connect(new StdioClientTransport({ command: subst(def.command), args: (def.args || []).map(subst), env, stderr: 'ignore' })), 30000, 'start')
  } else throw new Error('needs url or command')

  const listed = await withTimeout(client.listTools(), 15000, 'list tools')
  const safe = new Set(def.safeTools || [])
  const tools = listed.tools.map((t): Tool => ({
    name: `${def.name}__${t.name}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64),
    description: `[${def.name}] ${t.description || t.name}`.slice(0, 1000),
    risk: safe.has(t.name) ? 'safe' : 'approval',
    parameters: t.inputSchema || { type: 'object', properties: {} },
    async run(args: any) {
      return flatten(await client.callTool({ name: t.name, arguments: args || {} }, undefined, { timeout: 10 * 60_000 }))
    }
  }))
  return { client, tools }
}

async function start(def: ServerDef & { imported?: boolean }) {
  const missing = (def.requires || []).filter((k) => !process.env[k])
  const set = (s: McpState) => { const i = state.findIndex((x) => x.name === def.name); if (i >= 0) state[i] = s; else state.push(s) }
  defs.set(def.name, def)
  if (def.disabled || missing.length) return set({ name: def.name, status: 'skipped', tools: 0, detail: def.disabled ? 'disabled' : `set ${missing.join(', ')}` })
  try {
    const { client, tools } = await connect(def)
    clients.set(def.name, client)
    registerTools(tools)
    set({ name: def.name, status: 'connected', tools: tools.length })
  } catch (e: any) {
    set({ name: def.name, status: 'error', tools: 0, detail: String(e?.message || e).slice(0, 300) })
  }
}

function readFile(path: string): any[] {
  if (!existsSync(path)) return []
  try { return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) } catch { return [] }
}

export async function initMcp(path = process.env.MCP_SERVERS_FILE || './config/mcp-servers.json') {
  state.length = 0
  const base: ServerDef[] = readFile(path)
  const imported = readFile(importedFile()).map((d: ServerDef) => ({ ...d, imported: true }))
  await Promise.all([...base, ...imported].map(start))
  return state
}

export const mcpServers = () => state.map((s) => {
  const d = defs.get(s.name)
  return { ...s, transport: d?.url ? 'http' : 'stdio', target: d?.url || d?.command, imported: !!d?.imported }
})

const NAME_RE = /^[a-z][a-z0-9-]{0,30}$/

// Accepts either one server object or a Claude-Desktop style { mcpServers: { name: {...} } } document.
export function parseImport(input: any): ServerDef[] {
  const out: ServerDef[] = []
  const add = (name: string, d: any) => out.push({ name, description: d.description, url: d.url || d.serverUrl, command: d.command, args: Array.isArray(d.args) ? d.args.map(String) : undefined, env: d.env, headers: d.headers, safeTools: Array.isArray(d.safeTools) ? d.safeTools.map(String) : undefined })
  if (input?.mcpServers && typeof input.mcpServers === 'object') for (const [n, d] of Object.entries<any>(input.mcpServers)) add(n, d || {})
  else if (input?.name) add(String(input.name), input)
  else throw new Error('provide {name,url|command,...} or {mcpServers:{...}}')
  return out
}

export async function importServers(input: any) {
  const list = parseImport(input)
  const results: McpState[] = []
  for (const d of list) {
    if (!NAME_RE.test(d.name)) throw new Error(`invalid server name "${d.name}" (lowercase letters, digits, single dashes; max 31)`)
    if (!d.url && !d.command) throw new Error(`${d.name}: needs url or command`)
    if (d.url && !/^https?:\/\//i.test(subst(d.url))) throw new Error(`${d.name}: url must be http(s)`)
    if (d.command && process.env.ALLOW_STDIO_IMPORT !== '1') throw new Error(`${d.name}: importing a local command server is disabled; set ALLOW_STDIO_IMPORT=1 on the server to allow it`)
    if (defs.has(d.name) && !defs.get(d.name)!.imported) throw new Error(`${d.name}: name is used by a built-in config server`)
  }
  for (const d of list) {
    await removeServer(d.name, false)
    await start({ ...d, imported: true })
    results.push(state.find((s) => s.name === d.name)!)
  }
  persist()
  return results
}

function persist() {
  const keep = [...defs.values()].filter((d) => d.imported).map(({ imported, ...d }) => d)
  mkdirSync(process.env.DATA_DIR || './data', { recursive: true })
  writeFileSync(importedFile(), JSON.stringify(keep, null, 2), { mode: 0o600 })
}

export async function removeServer(name: string, save = true) {
  const d = defs.get(name)
  if (d && !d.imported) throw new Error('built-in config servers are removed by editing config/mcp-servers.json')
  unregisterTools(`${name}__`)
  const c = clients.get(name)
  clients.delete(name)
  defs.delete(name)
  const i = state.findIndex((s) => s.name === name)
  if (i >= 0) state.splice(i, 1)
  if (c) await c.close().catch(() => {})
  if (save) persist()
  return !!d
}
