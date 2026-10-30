// Buyer access: email + one-time code -> short-lived session -> spend own credits on the fixed enhancement graph.
import { createHash, randomBytes, randomInt } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import { normEmail, type Store } from './store'
import { runPipeline, ENHANCE_GRAPH } from './pipeline'

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const CODE_TTL = 10 * 60 * 1000
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/
const devEcho = () => process.env.BUYER_CODE_DEV_ECHO === '1' && process.env.NODE_ENV !== 'production'

// In-memory throttle (single Fly machine)
const hits = new Map<string, number[]>()
function limited(key: string, max: number, windowMs: number) {
  const now = Date.now()
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs)
  arr.push(now); hits.set(key, arr)
  return arr.length > max
}

async function sendCode(email: string, code: string) {
  const key = process.env.RESEND_API_KEY
  const from = process.env.MAIL_FROM
  if (!key || !from) throw new Error('email sender not configured')
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      from, to: [email], subject: `Your FRAYMUS sign-in code: ${code}`,
      text: `Your sign-in code is ${code}. It expires in 10 minutes.\n\nIf you didn't request it, ignore this email.`
    })
  })
  if (!r.ok) throw new Error(`email send failed ${r.status}`)
}

export function registerBuyerRoutes(app: FastifyInstance, store: Store, opts: { baseUrl: (req: any) => string }) {
  const page = readFileSync(new URL('./buyer-page.html', import.meta.url), 'utf8')
  app.get('/enhance', async (_req, reply) =>
    reply.header('Content-Type', 'text/html; charset=utf-8')
      .header('Content-Security-Policy', "default-src 'self'; img-src 'self' https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'")
      .send(page))

  // Always the same answer, so the endpoint can't be used to learn who bought.
  app.post('/buyer/login/start', async (req, reply) => {
    const email = normEmail((req.body as any)?.email)
    if (!EMAIL_RE.test(email)) return reply.status(400).send({ error: 'Enter a valid email' })
    if (limited(`ip:${req.ip}`, 20, 3600_000) || limited(`em:${email}`, 5, 3600_000)) return reply.status(429).send({ error: 'Too many requests, try later' })
    const generic = { ok: true, message: 'If that email has a purchase, a code is on its way.' }
    const user = await store.getUserByEmail(email)
    if (!user) return generic
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    await store.saveLoginCode(email, sha(`${email}:${code}`), CODE_TTL)
    if (devEcho()) return { ...generic, devCode: code }
    try { await sendCode(email, code) } catch (e: any) {
      req.log.error({ err: e.message }, 'buyer code email failed')
      return reply.status(503).send({ error: 'Sign-in email is not available right now' })
    }
    return generic
  })

  app.post('/buyer/login/verify', async (req, reply) => {
    const email = normEmail((req.body as any)?.email)
    const code = String((req.body as any)?.code || '').trim()
    if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) return reply.status(400).send({ error: 'Email and 6-digit code required' })
    if (limited(`vip:${req.ip}`, 30, 3600_000)) return reply.status(429).send({ error: 'Too many attempts' })
    const res = await store.checkLoginCode(email, sha(`${email}:${code}`))
    if (res !== 'ok') return reply.status(401).send({ error: res === 'expired' ? 'Code expired' : res === 'locked' ? 'Too many wrong codes, request a new one' : 'Wrong code' })
    const user = await store.getUserByEmail(email)
    if (!user) return reply.status(401).send({ error: 'No purchase found' })
    const token = 'bs_' + randomBytes(32).toString('hex')
    await store.createSession(user.id, sha(token), SESSION_TTL)
    return { token, credits: user.credits, expiresInDays: 7 }
  })

  const buyer = async (req: any) => {
    const t = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!t.startsWith('bs_')) return null
    const id = await store.getSession(sha(t))
    return id ? store.getUser(id) : null
  }

  app.get('/buyer/me', async (req, reply) => {
    const u = await buyer(req)
    if (!u) return reply.status(401).send({ error: 'Sign in' })
    return { email: u.email, credits: u.credits }
  })

  app.post('/buyer/enhance', async (req, reply) => {
    const u = await buyer(req)
    if (!u) return reply.status(401).send({ error: 'Sign in' })
    const prompt = String((req.body as any)?.prompt || '').trim().slice(0, 500)
    if (!prompt) return reply.status(400).send({ error: 'prompt required' })
    if (!(await store.consumeCredit(u.id))) return reply.status(402).send({ error: 'Out of credits' })
    const strict = process.env.BUYER_PIPELINE_STRICT !== '0' // paid runs must not return placeholders
    let result
    try {
      result = await runPipeline(ENHANCE_GRAPH.nodes, ENHANCE_GRAPH.edges, { prompt, strict })
    } catch (e: any) {
      result = { status: 'failed' as const, results: { pipeline: { type: 'pipeline', durationMs: 0, error: e.message } }, durationMs: 0 }
    }
    if (result.status !== 'success') await store.refundCredit(u.id)
    await store.saveRun({
      workflow_id: 'buyer-enhance', user_id: u.id, status: result.status, input_prompt: prompt,
      results: result.results, final_image_url: (result as any).imageUrl ?? null, final_html: null, duration_ms: result.durationMs
    })
    const after = await store.getUser(u.id)
    const img = (result as any).imageUrl
    return reply.status(result.status === 'success' ? 200 : 502).send({
      status: result.status, refunded: result.status !== 'success', credits: after?.credits ?? 0,
      imageUrl: img?.startsWith('/') ? opts.baseUrl(req) + img : img,
      steps: Object.entries(result.results).map(([id, r]: any) => ({ id, engine: r.engine, mocked: !!r.mocked, error: r.error, ms: r.durationMs }))
    })
  })
}
