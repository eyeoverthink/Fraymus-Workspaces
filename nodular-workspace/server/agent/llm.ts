export type ToolCall = { id: string; name: string; arguments: Record<string, any> }
export type Msg = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_calls?: ToolCall[]; tool_call_id?: string; name?: string }
export type ToolSpec = { name: string; description: string; parameters: any }
export type LlmResult = { content: string; tool_calls: ToolCall[]; provider: string; model: string }

const specs = (tools: ToolSpec[]) => (tools.length ? tools.map((t) => ({ type: 'function', function: t })) : undefined)
const parseArgs = (a: any) => {
  if (typeof a !== 'string') return a || {}
  try { return JSON.parse(a) } catch { return {} }
}

const ollamaHost = () => (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '')
const ollamaHeaders = () => {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (process.env.OLLAMA_BASIC_AUTH) h.Authorization = 'Basic ' + Buffer.from(process.env.OLLAMA_BASIC_AUTH).toString('base64')
  return h
}

let ollamaProbe: { at: number; models: string[] } | null = null
async function ollamaModels(): Promise<string[]> {
  if (ollamaProbe && Date.now() - ollamaProbe.at < 20000) return ollamaProbe.models
  let models: string[] = []
  try {
    const r = await fetch(`${ollamaHost()}/api/tags`, { headers: ollamaHeaders(), signal: AbortSignal.timeout(1500) })
    if (r.ok) models = ((await r.json()) as any).models?.map((m: any) => m.name) || []
  } catch {}
  ollamaProbe = { at: Date.now(), models }
  return models
}

async function callOllama(messages: Msg[], tools: ToolSpec[], model?: string): Promise<LlmResult> {
  const available = await ollamaModels()
  const use = model || process.env.OLLAMA_MODEL || available[0]
  if (!use) throw new Error('no Ollama model available')
  const body = {
    model: use,
    stream: false,
    tools: specs(tools),
    messages: messages.map((m) =>
      m.role === 'assistant' && m.tool_calls?.length
        ? { role: 'assistant', content: m.content, tool_calls: m.tool_calls.map((c) => ({ function: { name: c.name, arguments: c.arguments } })) }
        : m.role === 'tool' ? { role: 'tool', content: m.content, tool_name: m.name } : { role: m.role, content: m.content })
  }
  const r = await fetch(`${ollamaHost()}/api/chat`, { method: 'POST', headers: ollamaHeaders(), body: JSON.stringify(body), signal: AbortSignal.timeout(180000) })
  if (!r.ok) throw new Error(`ollama ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const j: any = await r.json()
  const calls: ToolCall[] = (j.message?.tool_calls || []).map((c: any, i: number) => ({
    id: `call_${Date.now().toString(36)}_${i}`, name: c.function?.name, arguments: parseArgs(c.function?.arguments)
  }))
  return { content: j.message?.content || '', tool_calls: calls, provider: 'ollama', model: use }
}

async function callOpenAI(name: string, base: string, key: string, messages: Msg[], tools: ToolSpec[], model: string): Promise<LlmResult> {
  const body = {
    model,
    tools: specs(tools),
    messages: messages.map((m) =>
      m.role === 'assistant' && m.tool_calls?.length
        ? { role: 'assistant', content: m.content || null, tool_calls: m.tool_calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) }
        : m.role === 'tool' ? { role: 'tool', tool_call_id: m.tool_call_id, content: m.content } : { role: m.role, content: m.content })
  }
  const r = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key, ...(process.env.OPENAI_USER_AGENT ? { 'User-Agent': process.env.OPENAI_USER_AGENT } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000)
  })
  if (!r.ok) throw new Error(`${name} ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const j: any = await r.json()
  const m = j.choices?.[0]?.message
  if (!m) throw new Error(`${name}: empty response`)
  const calls: ToolCall[] = (m.tool_calls || []).map((c: any) => ({ id: c.id, name: c.function?.name, arguments: parseArgs(c.function?.arguments) }))
  return { content: m.content || '', tool_calls: calls, provider: name, model }
}

type Provider = { name: string; configured: () => boolean | Promise<boolean>; call: (m: Msg[], t: ToolSpec[], model?: string) => Promise<LlmResult> }

const providers: Provider[] = [
  { name: 'ollama', configured: async () => (await ollamaModels()).length > 0, call: callOllama },
  {
    name: 'groq', configured: () => !!process.env.GROQ_API_KEY,
    call: (m, t, model) => callOpenAI('groq', 'https://api.groq.com/openai/v1', process.env.GROQ_API_KEY!, m, t, model || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile')
  },
  {
    name: 'openai', configured: () => !!(process.env.OPENAI_BASE_URL && process.env.OPENAI_API_KEY),
    call: (m, t, model) => callOpenAI('openai', process.env.OPENAI_BASE_URL!, process.env.OPENAI_API_KEY!, m, t, model || process.env.OPENAI_MODEL || 'gpt-4o-mini')
  }
]

// Order is LLM_PROVIDERS (default: ollama,groq,openai): self-hosted first, hosted as fallback
const order = () => (process.env.LLM_PROVIDERS || 'ollama,groq,openai').split(',').map((s) => s.trim()).filter(Boolean)

export async function providerStatus() {
  const out: any[] = []
  for (const n of order()) {
    const p = providers.find((x) => x.name === n)
    if (p) out.push({ name: n, configured: await p.configured() })
  }
  return { providers: out, mockFallback: !out.some((o) => o.configured) }
}

// hint: "provider" or "provider:model"
export async function chat(messages: Msg[], tools: ToolSpec[], hint?: string): Promise<LlmResult> {
  const [hp, ...hm] = (hint || '').split(':')
  const hintedModel = hm.join(':') || undefined
  const names = order()
  if (hp && providers.some((p) => p.name === hp)) names.unshift(hp)
  const tried = new Set<string>()
  const errors: string[] = []
  let anyConfigured = false
  for (const n of names) {
    if (tried.has(n)) continue
    tried.add(n)
    const p = providers.find((x) => x.name === n)
    if (!p || !(await p.configured())) continue
    anyConfigured = true
    try {
      return await p.call(messages, tools, n === hp ? hintedModel : undefined)
    } catch (e: any) {
      errors.push(`${n}: ${e.message}`)
    }
  }
  if (anyConfigured) throw new Error('All LLM providers failed - ' + errors.join(' | '))
  return mockChat(messages, tools)
}

// Offline fallback, used only when no provider is configured. Deterministic so the tool loop is testable.
function mockChat(messages: Msg[], tools: ToolSpec[]): LlmResult {
  const has = (n: string) => tools.some((t) => t.name === n)
  const last = messages[messages.length - 1]
  const mk = (name: string, args: any): LlmResult => ({ content: '', tool_calls: [{ id: `mock_${Date.now().toString(36)}`, name, arguments: args }], provider: 'mock', model: 'mock' })
  if (last?.role === 'tool') return { content: `Done. Tool ${last.name} returned: ${last.content.slice(0, 400)}`, tool_calls: [], provider: 'mock', model: 'mock' }
  const text = last?.content || ''
  let m: RegExpMatchArray | null
  if (has('delegate_to_agent') && (m = text.match(/ask (\w+) to (.+)/i))) return mk('delegate_to_agent', { agentId: m[1], task: m[2] })
  if (has('memory_save') && (m = text.match(/remember (?:that )?(.+)/i))) return mk('memory_save', { text: m[1] })
  if (has('http_get') && (m = text.match(/fetch (https?:\/\/\S+)/i))) return mk('http_get', { url: m[1] })
  if (has('generate_image') && (m = text.match(/(?:image|picture|draw|generate) (?:of )?(.+)/i))) return mk('generate_image', { prompt: m[1] })
  if (has('web_search') && (m = text.match(/search (?:for )?(.+)/i))) return mk('web_search', { query: m[1] })
  return {
    content: `[mock model - no LLM configured] You said: "${text.slice(0, 200)}". Start Ollama or set GROQ_API_KEY / OPENAI_BASE_URL to get real answers.`,
    tool_calls: [], provider: 'mock', model: 'mock'
  }
}
