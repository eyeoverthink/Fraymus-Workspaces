import { existsSync, readFileSync } from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { registerTools } from './tools'
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

async function connect(def: ServerDef): Promise<Tool[]> {
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
  return listed.tools.map((t): Tool => ({
    name: `${def.name}__${t.name}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64),
    description: `[${def.name}] ${t.description || t.name}`.slice(0, 1000),
    risk: safe.has(t.name) ? 'safe' : 'approval',
    parameters: t.inputSchema || { type: 'object', properties: {} },
    async run(args: any) {
      return flatten(await client.callTool({ name: t.name, arguments: args || {} }, undefined, { timeout: 10 * 60_000 }))
    }
  }))
}

export async function initMcp(path = process.env.MCP_SERVERS_FILE || './config/mcp-servers.json') {
  state.length = 0
  if (!existsSync(path)) return state
  const defs: ServerDef[] = JSON.parse(readFileSync(path, 'utf8'))
  await Promise.all(defs.map(async (def) => {
    const missing = (def.requires || []).filter((k) => !process.env[k])
    if (def.disabled || missing.length) {
      state.push({ name: def.name, status: 'skipped', tools: 0, detail: def.disabled ? 'disabled' : `set ${missing.join(', ')}` })
      return
    }
    try {
      const tools = await connect(def)
      registerTools(tools)
      state.push({ name: def.name, status: 'connected', tools: tools.length })
    } catch (e: any) {
      state.push({ name: def.name, status: 'error', tools: 0, detail: String(e?.message || e).slice(0, 300) })
    }
  }))
  return state
}
