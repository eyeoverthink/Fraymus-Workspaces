import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import { Server } from 'socket.io'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runLlama, runFlux, runRemover, runUpscaler } from './services'
import { createStore } from './store'
import shopifyWebhooks from './shopify'
import { registerBuyerRoutes } from './buyer'
import { createClerkClient } from '@clerk/backend'
import { runPipeline, outputsDir } from './pipeline'
import { authenticateClerk } from './lib/clerk'
import { reportRunUsage, createCheckout } from './billing'
import { registerAgentRoutes } from './agent/routes'
import { initAgents } from './agent/runtime'
import { initMcp } from './agent/mcp'
import { startScheduler } from './agent/automations'
import { registerOAuthRoutes, registerAccessRoutes } from './agent/auth'
import { registerMcpServer } from './agent/mcp-server'
import { registerMediaTools } from './agent/media'

const PORT = Number(process.env.PORT || 3001)
const fastify = Fastify({ logger: true })
await fastify.register(cors, { origin: process.env.CORS_ORIGIN?.split(',') || true })
await fastify.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } })
const store = await createStore()
const authRequired = !!process.env.CLERK_SECRET_KEY
const LOCAL_USER = 'local'

async function currentUser(req: any): Promise<string | null> {
  if (!authRequired) return LOCAL_USER
  const a = await authenticateClerk(req)
  return a.authenticated ? (a.userId as string) : null
}

// Every /api route except the deployed run endpoint needs a signed-in user when auth is configured
fastify.addHook('onRequest', async (req, reply) => {
  const path = req.url.split('?')[0]
  if (!path.startsWith('/api/') || /^\/api\/workflows\/[^/]+\/run$/.test(path)) return
  const uid = await currentUser(req)
  if (!uid) return reply.status(401).send({ error: 'Sign in required' })
  ;(req as any).userId = uid
})

const baseUrl = (req: any) => process.env.PUBLIC_URL || `${req.protocol}://${req.headers.host}`
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workflow'

async function readImageInput(req: any): Promise<{ buffer: Buffer | null; fields: Record<string, any> }> {
  if (req.isMultipart()) {
    const file = await req.file()
    if (!file) return { buffer: null, fields: {} }
    const buffer = await file.toBuffer()
    const fields: Record<string, any> = {}
    for (const [k, v] of Object.entries(file.fields || {})) {
      if (v && !Array.isArray(v) && (v as any).type === 'field') fields[k] = (v as any).value
    }
    return { buffer, fields }
  }
  const body: any = req.body || {}
  if (body.imageUrl) {
    const url = String(body.imageUrl)
    const res = await fetch(url.startsWith('/') ? `http://127.0.0.1:${PORT}${url}` : url)
    if (!res.ok) throw new Error('Could not fetch imageUrl')
    return { buffer: Buffer.from(await res.arrayBuffer()), fields: body }
  }
  return { buffer: null, fields: body }
}

fastify.get('/health', async () => ({ ok: true, store: store.kind }))

fastify.get('/outputs/:name', async (req, reply) => {
  const { name } = req.params as any
  const types: Record<string, string> = { png: 'image/png', mp4: 'video/mp4', webm: 'video/webm', gif: 'image/gif', wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg' }
  const ext = /^[\w-][\w.-]*\.(png|mp4|webm|gif|wav|mp3|ogg)$/.exec(name)?.[1]
  if (!ext || !existsSync(`${outputsDir}/${name}`)) return reply.status(404).send({ error: 'Not found' })
  return reply.header('Content-Type', types[ext]).header('Cache-Control', 'public, max-age=31536000, immutable').send(createReadStream(`${outputsDir}/${name}`))
})

// With Clerk, store the verified primary email so Shopify buyers are matched to the account (and pre-signup purchases merge in)
const clerk = process.env.CLERK_SECRET_KEY ? createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY }) : null
async function verifiedEmail(userId: string): Promise<string | null> {
  if (!clerk || userId === LOCAL_USER) return null
  try {
    const u = await clerk.users.getUser(userId)
    const p = u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId)
    return p && p.verification?.status === 'verified' ? p.emailAddress : null
  } catch { return null }
}
fastify.get('/api/me', async (req) => {
  const id = (req as any).userId
  const u = await store.ensureUser(id)
  if (store.kind === 'sqlite' && clerk && !u.email) {
    const email = await verifiedEmail(id)
    if (email) return store.linkEmail(id, email)
  }
  return u
})

await fastify.register(shopifyWebhooks, { store })
registerBuyerRoutes(fastify, store, { baseUrl })

// --- Node endpoints ---
fastify.post('/api/llama', async (req, reply) => {
  const { prompt, systemPrompt } = (req.body as any) || {}
  if (!prompt) return reply.status(400).send({ error: 'prompt required' })
  try {
    return await runLlama(String(prompt), systemPrompt)
  } catch (e: any) {
    return reply.status(500).send({ error: e.message, fallback: `Photorealistic ${prompt}, UGC style, iPhone flash, 4K` })
  }
})

fastify.post('/api/flux', async (req, reply) => {
  const { prompt } = (req.body as any) || {}
  if (!prompt) return reply.status(400).send({ error: 'prompt required' })
  try {
    const { png, mocked } = await runFlux(String(prompt))
    return reply.header('Content-Type', 'image/png').header('X-Mocked', String(mocked)).send(png)
  } catch (e: any) {
    return reply.status(500).send({ error: e.message })
  }
})

fastify.post('/api/remover', async (req, reply) => {
  try {
    const { buffer } = await readImageInput(req)
    if (!buffer) return reply.status(400).send({ error: 'No image file' })
    const { png, engine } = await runRemover(buffer)
    return reply.header('Content-Type', 'image/png').header('X-Remover', engine).send(png)
  } catch (e: any) {
    return reply.status(500).send({ error: e.message })
  }
})

fastify.post('/api/upscaler', async (req, reply) => {
  try {
    const { buffer, fields } = await readImageInput(req)
    if (!buffer) return reply.status(400).send({ error: 'No image' })
    const scale = Math.min(Math.max(parseInt(fields.scale) || 4, 1), 4)
    const { png, from, to, engine } = await runUpscaler(buffer, scale)
    return reply.header('Content-Type', 'image/png').header('X-Upscale-From', from).header('X-Upscale-To', to).header('X-Upscaler', engine).send(png)
  } catch (e: any) {
    return reply.status(500).send({ error: e.message })
  }
})

// --- REA - Realtime Editing Agent ---
fastify.post('/api/rea/suggest', async (req) => {
  const { nodes, edges } = (req.body as any) || {}
  const GROQ_KEY = process.env.GROQ_API_KEY
  const has = (s: string) => nodes?.some((n: any) => String(n.type).includes(s))

  let suggestion = '💡 REA: Chain looks good. Run it, then Deploy.'
  let codePatch = '// REA: Add error handling for free tier rate limits'

  if (nodes?.length === 1) {
    suggestion = '💡 REA: You have only brain. Add FLUX [schnell] node - Apache 2.0, 4 steps, FREE vs Nano Banana'
    codePatch = 'nodes.push({ type: "flux-schnell", data: { model: "black-forest-labs/FLUX.1-schnell" } })'
  } else if (nodes?.length === 2 && has('flux') && !has('remover')) {
    suggestion = '💡 REA: After FLUX, add BiRefNet Remover - makes product shots sellable. Free local WASM.'
    codePatch = 'nodes.push({ type: "remover-birefnet" }) // Free, no API key'
  } else if (has('remover') && !has('upscaler')) {
    suggestion = '💡 REA: Add 4x Upscaler - Sharp lanczos3 local, FREE. 1024 → 4096 for Etsy/Shopify listings.'
    codePatch = 'nodes.push({ type: "upscaler-realesrgan", data: { scale: 4 } })'
  } else if (nodes?.length >= 4 && !has('html')) {
    suggestion = '💡 REA: Final step - HTML Preview + Deploy. This turns workflow into POST /api/workflows/:id/run - your product moat.'
    codePatch = 'nodes.push({ type: "html-preview" }) // Deployable endpoint'
  } else if (nodes?.length >= 5) {
    suggestion = '💡 REA: Full 5-node workflow ready! Llama → FLUX → Remover → Upscaler → Deploy. This chain is your IP. Run it.'
    codePatch = '// Full chain executable - see executor.ts'
  }

  if (GROQ_KEY && nodes) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: 'You are REA, workflow architect. Given nodes+edges, suggest next high-leverage free node. Keep under 20 words. Mention free alternative.' },
            { role: 'user', content: JSON.stringify({ nodes: nodes.map((n: any) => ({ id: n.id, type: n.type })), edges }) }
          ],
          max_tokens: 100
        })
      })
      const data: any = await r.json()
      if (data.choices?.[0]?.message?.content) suggestion = '💡 REA: ' + data.choices[0].message.content
    } catch {}
  }

  // @ts-ignore
  fastify.io?.emit('rea:suggestion', { suggestion, codePatch, timestamp: Date.now() })
  return { suggestion, codePatch }
})

// --- Workflows: persistence, deploy as API ---
fastify.post('/api/workflows', async (req, reply) => {
  const userId = (req as any).userId as string
  const { nodes, edges, name } = (req.body as any) || {}
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return reply.status(400).send({ error: 'nodes and edges required' })
  const id = `${slug(name || 'workflow')}-${createHash('sha256').update(userId).digest('hex').slice(0, 6)}`
  await store.ensureUser(userId)
  const wf = await store.upsertWorkflow({ id, user_id: userId, name: name || id, nodes, edges })
  return { id: wf.id, url: `/api/workflows/${wf.id}/run`, deployUrl: `/api/workflows/${wf.id}/deploy` }
})

fastify.get('/api/workflows', async (req) => store.listWorkflows((req as any).userId))
fastify.get('/api/runs', async (req) => store.listRuns((req as any).userId, (req.query as any)?.workflowId))

fastify.post('/api/workflows/:id/deploy', async (req, reply) => {
  const userId = (req as any).userId as string
  const { id } = req.params as any
  const wf = await store.getWorkflow(id)
  if (!wf || wf.user_id !== userId) return reply.status(404).send({ error: 'Workflow not found' })
  const endpoint = `/api/workflows/${id}/run`
  const fullUrl = baseUrl(req) + endpoint
  const apiKey = await store.createApiKey(userId, id, 'deploy')
  await store.markDeployed(id, fullUrl)
  return {
    deployed: true,
    workflowId: id,
    endpoint,
    fullUrl,
    apiKey,
    curl: `curl -X POST ${fullUrl} -H "Content-Type: application/json" -H "x-api-key: ${apiKey}" -d '{"prompt":"your idea"}'`,
    note: 'The API key is shown once. Store it securely.'
  }
})

fastify.post('/api/workflows/:id/run', async (req, reply) => {
  const { id } = req.params as any
  const wf = await store.getWorkflow(id)
  if (!wf) return reply.status(404).send({ error: 'Workflow not found' })

  const header = String(req.headers['x-api-key'] || '').trim() || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  let authorized = false
  if (header.startsWith('nk_')) {
    const k = await store.findApiKey(header)
    authorized = !!k && k.workflow_id === id
  } else {
    authorized = (await currentUser(req)) === wf.user_id
  }
  if (!authorized) return reply.status(401).send({ error: 'Valid API key required (x-api-key)' })

  if (!(await store.consumeCredit(wf.user_id))) return reply.status(402).send({ error: 'Out of credits' })

  const { prompt } = (req.body as any) || {}
  let result
  try {
    result = await runPipeline(wf.nodes, wf.edges, { prompt: typeof prompt === 'string' ? prompt : undefined })
  } catch (e: any) {
    result = { status: 'failed' as const, results: { pipeline: { type: 'pipeline', durationMs: 0, error: e.message } }, durationMs: 0, imageUrl: undefined, html: undefined }
  }
  if (result.status !== 'success') await store.refundCredit(wf.user_id) // failed runs don't cost a credit
  const runId = await store.saveRun({
    workflow_id: id, user_id: wf.user_id, status: result.status, input_prompt: prompt ?? null,
    results: result.results, final_image_url: result.imageUrl ?? null, final_html: result.html ?? null, duration_ms: result.durationMs
  })
  if (result.status === 'success') await reportRunUsage(store, wf.user_id)

  const publicUrl = result.imageUrl?.startsWith('/') ? baseUrl(req) + result.imageUrl : result.imageUrl
  return reply.status(result.status === 'success' ? 200 : 502).send({
    runId, status: result.status, refunded: result.status !== 'success', imageUrl: publicUrl, html: result.html, durationMs: result.durationMs,
    errors: Object.entries(result.results).filter(([, r]) => r.error).map(([nodeId, r]) => ({ nodeId, error: r.error }))
  })
})

fastify.post('/api/billing/checkout', async (req, reply) => {
  try {
    return await createCheckout(store, (req as any).userId, process.env.PUBLIC_URL || baseUrl(req))
  } catch (e: any) {
    return reply.status(400).send({ error: e.message })
  }
})

registerMediaTools()
initAgents(store)
startScheduler()
initMcp().then((s) => s.forEach((x) => console.log(`[mcp] ${x.name}: ${x.status}${x.detail ? ' (' + x.detail + ')' : ''} tools=${x.tools}`)))
registerOAuthRoutes(fastify)
registerMcpServer(fastify)
registerAccessRoutes(fastify)
registerAgentRoutes(fastify)

// Serve the built frontend when present (production / Docker)
if (existsSync('./dist/index.html')) {
  const { default: fastifyStatic } = await import('@fastify/static')
  await fastify.register(fastifyStatic, { root: fileURLToPath(new URL('../dist/', import.meta.url)), wildcard: false })
  fastify.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Not found' })
    return reply.sendFile('index.html')
  })
}

await fastify.listen({ port: PORT, host: process.env.HOST || '0.0.0.0' })
const io = new Server(fastify.server, { cors: { origin: process.env.CORS_ORIGIN?.split(',') || true } })
// @ts-ignore
fastify.io = io

io.on('connection', (socket) => {
  socket.on('canvas:update', (data) => socket.broadcast.emit('canvas:update', data))
  socket.on('rea:request', () => io.emit('rea:suggestion', { suggestion: '💡 REA: Thinking...', timestamp: Date.now() }))
})

console.log(`NODULAR WORKSPACE on :${PORT} | store=${store.kind} | auth=${authRequired ? 'clerk' : 'open (local user)'}`)
