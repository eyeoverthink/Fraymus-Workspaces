import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export type AgentDef = {
  id: string; name: string; role?: string; description?: string; greeting?: string
  systemPrompt: string; tools: '*' | string[]; model?: string; custom?: boolean; source?: 'default' | 'override'
}

// Shipped defaults live in ./agents (git-tracked). Edits made at runtime land in DATA_DIR/agents and win.
export const defaultsDir = () => resolve(process.env.AGENTS_DIR || './agents')
export const overrideDir = () => resolve(`${process.env.DATA_DIR || './data'}/agents`)

const FIELDS = ['id', 'name', 'role', 'description', 'greeting', 'model'] as const
export const validId = (id: string) => /^[a-z][a-z0-9_]{0,40}$/.test(id)
const oneLine = (s: unknown) => String(s ?? '').replace(/\s*[\r\n]+\s*/g, ' ').trim()

export function parseManifest(text: string, fallbackId = ''): AgentDef {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text.replace(/^\uFEFF/, ''))
  if (!m) throw new Error('manifest must start with a --- front-matter block')
  const meta: Record<string, string> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  const id = meta.id || fallbackId
  if (!validId(id)) throw new Error(`invalid agent id "${id}" (lowercase letters, digits, underscore)`)
  const systemPrompt = m[2].trim()
  if (!meta.name || !systemPrompt) throw new Error('name and a prompt body are required')
  const t = (meta.tools ?? '*').trim()
  const tools = t === '*' || t === '' ? '*' : t.split(',').map((x) => x.trim()).filter(Boolean)
  const a: AgentDef = { id, name: meta.name.slice(0, 60), systemPrompt: systemPrompt.slice(0, 8000), tools }
  for (const k of ['role', 'description', 'greeting', 'model'] as const) if (meta[k]) a[k] = meta[k]
  return a
}

export function serializeManifest(a: AgentDef): string {
  const lines = FIELDS.filter((k) => a[k]).map((k) => `${k}: ${oneLine(a[k])}`)
  lines.push(`tools: ${a.tools === '*' ? '*' : a.tools.map(oneLine).join(', ')}`)
  return `---\n${lines.join('\n')}\n---\n${a.systemPrompt.trim()}\n`
}

function readDir(dir: string, source: 'default' | 'override'): AgentDef[] {
  if (!existsSync(dir)) return []
  const out: AgentDef[] = []
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    try { out.push({ ...parseManifest(readFileSync(`${dir}/${f}`, 'utf8'), f.slice(0, -3)), source }) } catch (e: any) {
      console.warn(`[agents] skipping ${dir}/${f}: ${e.message}`)
    }
  }
  return out
}

// Read on every call so edits to the files (by hand, git pull, or an agent over MCP) apply immediately.
export function loadManifests(): AgentDef[] {
  const merged = new Map<string, AgentDef>()
  for (const a of [...readDir(defaultsDir(), 'default'), ...readDir(overrideDir(), 'override')]) merged.set(a.id, a)
  return [...merged.values()]
}

export function writeOverride(a: AgentDef) {
  mkdirSync(overrideDir(), { recursive: true })
  writeFileSync(`${overrideDir()}/${a.id}.md`, serializeManifest(a))
}

export function removeOverride(id: string): boolean {
  if (!validId(id)) return false
  const p = `${overrideDir()}/${id}.md`
  if (!existsSync(p)) return false
  rmSync(p)
  return true
}
