import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const host = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '')
const headers = { 'Content-Type': 'application/json' }
if (process.env.OLLAMA_BASIC_AUTH) headers.Authorization = `Basic ${Buffer.from(process.env.OLLAMA_BASIC_AUTH).toString('base64')}`
const request = async (path, body) => {
  const response = await fetch(host + path, { method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) })
  if (!response.ok) throw new Error(`Ollama ${path}: HTTP ${response.status}`)
  return response.json()
}
const inventory = await request('/api/tags')
if (!Array.isArray(inventory.models)) throw new Error('Invalid Ollama model list')
const names = inventory.models.map((model) => model.name)
const preferred = [...new Set([process.env.OLLAMA_MODEL, 'gpt-oss:20b', 'llama3.2:latest', 'qwen3:4b', 'gemma4:latest', ...names].filter(Boolean))]
const visionPreferred = [...new Set([process.env.IDEA_VISION_MODEL?.replace(/^ollama:/, ''), 'llava:latest', 'gemma3:latest', 'qwen3-vl:4b', ...names].filter(Boolean))]
const info = new Map()
const select = async (candidates, capability) => {
  for (const name of candidates) {
    if (!names.includes(name)) continue
    if (!info.has(name)) info.set(name, await request('/api/show', { model: name }))
    if (info.get(name).capabilities?.includes(capability)) return name
  }
  throw new Error(`No installed ${capability} model. Install a compatible model yourself in Ollama, then rerun. No automatic multi-GB download is attempted.`)
}
const agent = await select(preferred, 'tools')
const ideas = await select([process.env.IDEA_MODEL?.startsWith('ollama:') ? process.env.IDEA_MODEL.slice(7) : undefined, 'llama3.2:latest', agent].filter(Boolean), 'completion')
const vision = await select(visionPreferred, 'vision')
const envPath = resolve('.env')
let text = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '# Local-only model setup; do not commit this file.\n'
const values = { LLM_PROVIDERS: 'ollama', OLLAMA_HOST: host, OLLAMA_MODEL: agent, IDEA_MODEL: `ollama:${ideas}`, IDEA_VISION_MODEL: `ollama:${vision}` }
for (const [key, value] of Object.entries(values)) {
  const line = `${key}=${JSON.stringify(value)}`
  const pattern = new RegExp(`^${key}=.*$`, 'm')
  text = pattern.test(text) ? text.replace(pattern, () => line) : `${text.trimEnd()}\n${line}\n`
}
writeFileSync(envPath, text, { mode: 0o600 })
console.log(`Configured local-only agent model ${agent}, structured drafting model ${ideas} and vision model ${vision} in ignored .env. Existing unrelated settings were preserved.`)
console.log('Run npm run models:test, then restart npm run dev:all. No model weights or secrets are committed.')
