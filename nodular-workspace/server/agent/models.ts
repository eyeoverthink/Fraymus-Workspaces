import type { FastifyInstance } from 'fastify'
import { chat, chatVision } from './llm'
import sharp from 'sharp'

export async function modelDiagnostics() {
  const host = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (process.env.OLLAMA_BASIC_AUTH) headers.Authorization = `Basic ${Buffer.from(process.env.OLLAMA_BASIC_AUTH).toString('base64')}`
  const selected = {
    agent: process.env.OLLAMA_MODEL || '(first installed Ollama model)',
    ideas: process.env.IDEA_MODEL || '(provider default)',
    vision: process.env.IDEA_VISION_MODEL || '(not configured)',
    order: process.env.LLM_PROVIDERS || 'ollama,groq,openai'
  }
  try {
    const response = await fetch(`${host}/api/tags`, { headers, signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`)
    const data = await response.json() as { models?: { name: string; size: number }[] }
    if (!Array.isArray(data.models)) throw new Error('Ollama returned an invalid model inventory')
    const checks = await Promise.all([...new Set([process.env.OLLAMA_MODEL, process.env.IDEA_MODEL?.startsWith('ollama:') ? process.env.IDEA_MODEL.slice(7) : undefined, process.env.IDEA_VISION_MODEL?.startsWith('ollama:') ? process.env.IDEA_VISION_MODEL.slice(7) : undefined].filter((value): value is string => !!value))].map(async (model) => {
      try {
        const result = await fetch(`${host}/api/show`, { method: 'POST', headers, body: JSON.stringify({ model }), signal: AbortSignal.timeout(5000) })
        if (!result.ok) throw new Error(`HTTP ${result.status}`)
        const info = await result.json() as { capabilities?: string[] }
        return { model, installed: true, capabilities: info.capabilities || [], error: null }
      } catch (error) { return { model, installed: false, capabilities: [], error: error instanceof Error ? error.message : String(error) } }
    }))
    return { selected, ollama: { reachable: true, models: data.models.map(({ name, size }) => ({ name, size })), checks, error: null }, note: 'Installed/capability metadata is not an inference test. Use Test configured models for a synthetic, non-private text/tool/vision request.' }
  } catch (error) {
    return { selected, ollama: { reachable: false, models: [], checks: [], error: error instanceof Error ? error.message : String(error) }, note: 'Run npm run models:configure with Ollama available, or configure a hosted provider on the server.' }
  }
}

export async function testConfiguredModels() {
  const results: { capability: string; ok: boolean; provider?: string; model?: string; error?: string }[] = []
  for (const capability of ['structured-text', 'agent-tools', 'vision'] as const) {
    try {
      if (capability === 'vision') {
        if (!process.env.IDEA_VISION_MODEL) throw new Error('IDEA_VISION_MODEL is not configured')
        const png = await sharp({ create: { width: 96, height: 96, channels: 3, background: '#ff0000' } }).jpeg().toBuffer()
        const result = await chatVision([{ role: 'user', content: 'What is the dominant color? Reply with one color word.', images: [png.toString('base64')] }], process.env.IDEA_VISION_MODEL)
        if (!/\bred\b/i.test(result.content)) throw new Error('Vision did not identify the synthetic red test image')
        results.push({ capability, ok: true, provider: result.provider, model: result.model })
      } else if (capability === 'agent-tools') {
        const result = await chat([{ role: 'user', content: 'Call model_setup_probe with value READY. Do not respond in text.' }], [
          { name: 'model_setup_probe', description: 'Synthetic setup test. Call with the value READY.', parameters: { type: 'object', properties: { value: { type: 'string', enum: ['READY'] } }, required: ['value'] } }
        ])
        if (result.provider === 'mock' || !result.tool_calls.some((call) => call.name === 'model_setup_probe' && call.arguments.value === 'READY')) throw new Error('The model did not return the required synthetic tool call')
        results.push({ capability, ok: true, provider: result.provider, model: result.model })
      } else {
        const result = await chat([{ role: 'user', content: 'Return JSON {"ready":true}. This is a setup test, not a financial claim.' }], [], process.env.IDEA_MODEL, {
          jsonSchema: { type: 'object', properties: { ready: { type: 'boolean', const: true } }, required: ['ready'] }, maxTokens: 100
        })
        if (result.provider === 'mock' || JSON.parse(result.content).ready !== true) throw new Error('No real structured-text response received')
        results.push({ capability, ok: true, provider: result.provider, model: result.model })
      }
    } catch (error) { results.push({ capability, ok: false, error: error instanceof Error ? error.message : String(error) }) }
  }
  return { ok: results.every((result) => result.ok), results, testedAt: Date.now() }
}

export function registerModelRoutes(app: FastifyInstance) {
  app.get('/api/models', async () => modelDiagnostics())
  let running = false
  app.post('/api/models/test', async (_req, reply) => {
    if (running) return reply.status(409).send({ error: 'A model test is already running on this server' })
    running = true
    try { return await testConfiguredModels() }
    finally { running = false }
  })
}
