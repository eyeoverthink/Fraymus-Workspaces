import { createHash, randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { db, now } from './db'
import { integrationEncryptionConfigured, openIntegrationSecret, sealIntegrationSecret } from './integration-secrets'
import { registerTools } from './tools'
import type { Tool } from './tools'

const API = 'https://api.canva.com/rest/v1'
const AUTHORIZE = 'https://www.canva.com/api/oauth/authorize'
const TOKEN = `${API}/oauth/token`
const SCOPES = ['design:meta:read', 'design:content:read', 'design:content:write']
type CanvaTokens = { access_token: string; refresh_token: string; expires_at: number }

const clientId = () => process.env.CANVA_CLIENT_ID || ''
const clientSecret = () => process.env.CANVA_CLIENT_SECRET || ''

function callbackUri(req: any) {
  if (process.env.NODE_ENV === 'production' && !process.env.PUBLIC_URL) throw new Error('PUBLIC_URL must be configured for Canva OAuth in production')
  const origin = process.env.PUBLIC_URL || `${req.protocol}://${req.headers.host}`
  const url = new URL(origin)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('PUBLIC_URL must be an http(s) origin')
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('PUBLIC_URL must use HTTPS in production')
  return `${url.origin}/api/integrations/canva/callback`
}

function connection(userId: string) {
  return db.prepare('select token_cipher,expires_at from canva_connections where user_id=?').get(userId) as { token_cipher: string; expires_at: number } | undefined
}

async function responseJson(response: Response, label: string) {
  const text = await response.text()
  let result: any = {}
  try { result = text ? JSON.parse(text) : {} } catch { result = { message: text.slice(0, 300) } }
  if (!response.ok) throw new Error(`${label} failed (${response.status}): ${String(result.message || result.error || text || 'request rejected').slice(0, 300)}`)
  return result
}

async function exchangeToken(body: URLSearchParams) {
  const credentials = Buffer.from(`${clientId()}:${clientSecret()}`).toString('base64')
  return responseJson(await fetch(TOKEN, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000)
  }), 'Canva token exchange')
}

async function tokensFor(userId: string): Promise<CanvaTokens> {
  const row = connection(userId)
  if (!row) throw new Error('Connect Canva in Connect settings first')
  const tokens = JSON.parse(openIntegrationSecret(row.token_cipher)) as CanvaTokens
  if (Number(tokens.expires_at) > now() + 120000) return tokens
  const refreshed = await exchangeToken(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }))
  if (!refreshed.access_token || !refreshed.refresh_token) throw new Error('Canva did not return rotated OAuth tokens; reconnect the account')
  const next = {
    access_token: String(refreshed.access_token),
    refresh_token: String(refreshed.refresh_token),
    expires_at: now() + Number(refreshed.expires_in || 14400) * 1000
  }
  db.prepare('update canva_connections set token_cipher=?,expires_at=?,updated_at=? where user_id=?')
    .run(sealIntegrationSecret(JSON.stringify(next)), next.expires_at, now(), userId)
  return next
}

async function canvaRequest(userId: string, path: string, init?: RequestInit) {
  const tokens = await tokensFor(userId)
  return responseJson(await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${tokens.access_token}`, ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers || {}) },
    signal: init?.signal || AbortSignal.timeout(20000)
  }), 'Canva API')
}

function bounded(value: unknown, name: string, max: number) {
  const result = String(value ?? '').trim()
  if (!result || result.length > max) throw new Error(`${name} must contain 1-${max} characters`)
  return result
}

const canvaTools: Tool[] = [
  {
    name: 'canva_list_designs',
    risk: 'safe',
    description: 'List up to 20 Canva designs the connected user owns or can access. Returns design metadata and edit URLs, not design contents.',
    parameters: { type: 'object', properties: {     query: { type: 'string', maxLength: 255 },
    continuation: { type: 'string', maxLength: 1000 }, limit: { type: 'integer', minimum: 1, maximum: 20 } } },
    async run(args, ctx) {
      const query = args.query ? bounded(args.query, 'query', 255) : ''
      const continuation = args.continuation ? bounded(args.continuation, 'continuation', 1000) : ''
      const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 20)
      const url = new URL('/rest/v1/designs', API)
      url.searchParams.set('limit', String(limit))
      if (query) url.searchParams.set('query', query)
      if (continuation) url.searchParams.set('continuation', continuation)
      const result = await canvaRequest(ctx.userId, `/designs${url.search}`)
      if (!Array.isArray(result.items)) throw new Error('Canva API returned an invalid design-list response')
      return {
        designs: result.items.slice(0, limit).map((design: any) => ({
          id: design.id, title: design.title, url: design.urls?.edit_url || null,
          thumbnailUrl: design.thumbnail?.url || null, updatedAt: design.updated_at || null
        })),
        continuation: result.continuation || null
      }
    }
  },
  {
    name: 'canva_create_design',
    risk: 'approval',
    description: 'Create a blank Canva design for the user to edit. Canva automatically deletes blank designs that remain unedited for seven days. Requires app approval.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 100 },
        preset: { type: 'string', enum: ['doc', 'email', 'presentation', 'whiteboard'] }
      },
      required: ['title', 'preset']
    },
    async run(args, ctx) {
      const title = bounded(args.title, 'title', 100)
      const preset = bounded(args.preset, 'preset', 20)
      if (!['doc', 'email', 'presentation', 'whiteboard'].includes(preset)) throw new Error('preset must be doc, email, presentation, or whiteboard')
      const result = await canvaRequest(ctx.userId, '/designs', {
        method: 'POST',
        body: JSON.stringify({ design_type: { type: 'preset', name: preset }, title })
      })
      if (typeof result.design?.id !== 'string') throw new Error('Canva API returned an invalid design response')
      return {
        created: true,
        designId: result.design?.id,
        title: result.design?.title || title,
        editUrl: result.design?.urls?.edit_url || null,
        warning: 'Blank designs not edited within seven days are permanently deleted by Canva.'
      }
    }
  },
  {
    name: 'canva_create_export_job',
    risk: 'approval',
    description: 'Start a Canva design export job in the selected format. The app approval is required; downloadable URLs expire after 24 hours.',
    parameters: { type: 'object', properties: { designId: { type: 'string', minLength: 1, maxLength: 200 }, format: { type: 'string', enum: ['png', 'jpg', 'pdf', 'mp4', 'gif', 'pptx'] } }, required: ['designId', 'format'] },
    async run(args, ctx) {
      const designId = bounded(args.designId, 'designId', 200)
      const format = bounded(args.format, 'format', 10)
      if (!['png', 'jpg', 'pdf', 'mp4', 'gif', 'pptx'].includes(format)) throw new Error('unsupported Canva export format')
      const result = await canvaRequest(ctx.userId, '/exports', { method: 'POST', body: JSON.stringify({ design_id: designId, format: { type: format } }) })
      if (typeof result.job?.id !== 'string' || typeof result.job?.status !== 'string') throw new Error('Canva API returned an invalid export-job response')
      return { started: true, jobId: result.job.id, status: result.job.status }
    }
  },
  {
    name: 'canva_get_export_job',
    risk: 'safe',
    description: 'Check the status of a Canva export job. Completed download URLs expire after 24 hours.',
    parameters: { type: 'object', properties: { jobId: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['jobId'] },
    async run(args, ctx) {
      const jobId = bounded(args.jobId, 'jobId', 200)
      const result = await canvaRequest(ctx.userId, `/exports/${encodeURIComponent(jobId)}`)
      const job = result.job || {}
      if (typeof job.status !== 'string') throw new Error('Canva API returned an invalid export-job status response')
      return { jobId, status: job.status, urls: job.urls || [], error: job.error || null }
    }
  }
]

export function registerCanvaTools() {
  registerTools(canvaTools)
}

export function canvaConfiguration() {
  const missing = [
    !clientId() && 'CANVA_CLIENT_ID',
    !clientSecret() && 'CANVA_CLIENT_SECRET',
    !integrationEncryptionConfigured() && 'INTEGRATION_ENCRYPTION_KEY (32+ characters)',
    process.env.NODE_ENV === 'production' && !process.env.PUBLIC_URL && 'PUBLIC_URL (HTTPS OAuth callback origin)'
  ].filter(Boolean) as string[]
  return { configured: missing.length === 0, missing }
}

export function canvaIntegrationStatus(userId: string, req?: any) {
  const config = canvaConfiguration()
  const account = connection(userId)
  return {
    name: 'canva',
    configured: config.configured,
    missing: config.missing,
    connected: !!account && integrationEncryptionConfigured(),
    credentialStored: !!account,
    callbackUrl: req && (process.env.NODE_ENV !== 'production' || process.env.PUBLIC_URL) ? callbackUri(req) : null,
    capabilities: ['List design metadata', 'Create an approved blank design', 'Create an approved export job and read its status']
  }
}

export function registerCanvaRoutes(app: FastifyInstance) {
  app.get('/api/integrations/canva', async (req) => canvaIntegrationStatus((req as any).userId, req))
  app.post('/api/integrations/canva/connect', async (req, reply) => {
    const config = canvaConfiguration()
    if (!config.configured) return reply.status(400).send({ error: `Configure ${config.missing.join(', ')} on the server first` })
    try {
      const state = randomBytes(32).toString('base64url')
      const verifier = randomBytes(32).toString('base64url')
      const challenge = createHash('sha256').update(verifier).digest('base64url')
      db.prepare('delete from canva_oauth_states where expires_at<?').run(now())
      db.prepare('insert into canva_oauth_states(state_hash,user_id,verifier_cipher,expires_at) values(?,?,?,?)')
        .run(createHash('sha256').update(state).digest('hex'), (req as any).userId, sealIntegrationSecret(verifier), now() + 10 * 60_000)
      const url = new URL(AUTHORIZE)
      url.search = new URLSearchParams({
        client_id: clientId(), redirect_uri: callbackUri(req), response_type: 'code',
        scope: SCOPES.join(' '), state, code_challenge: challenge, code_challenge_method: 's256'
      }).toString()
      return { authorizationUrl: url.toString() }
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : String(error) })
    }
  })
  app.get('/api/integrations/canva/callback', async (req, reply) => {
    const query = req.query as any
    const state = String(query.state || '')
    const stateHash = createHash('sha256').update(state).digest('hex')
    const row = state ? db.prepare('select user_id,verifier_cipher,expires_at from canva_oauth_states where state_hash=?').get(stateHash) as any : null
    const origin = (() => {
      try { return new URL(process.env.PUBLIC_URL || `${req.protocol}://${req.headers.host}`).origin } catch { return '' }
    })()
    if (!row || row.expires_at < now() || !origin) {
      if (row) db.prepare('delete from canva_oauth_states where state_hash=?').run(stateHash)
      return reply.redirect(`${origin || '/'}?view=connect&canva=error`)
    }
    db.prepare('delete from canva_oauth_states where state_hash=?').run(stateHash)
    if (query.error || !query.code) return reply.redirect(`${origin}/?view=connect&canva=error`)
    try {
      const received = await exchangeToken(new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(query.code),
        code_verifier: openIntegrationSecret(row.verifier_cipher),
        redirect_uri: callbackUri(req)
      }))
      if (!received.access_token || !received.refresh_token) throw new Error('Canva did not return refreshable OAuth tokens')
      const tokens: CanvaTokens = {
        access_token: String(received.access_token),
        refresh_token: String(received.refresh_token),
        expires_at: now() + Number(received.expires_in || 14400) * 1000
      }
      db.prepare('insert into canva_connections(user_id,token_cipher,expires_at,updated_at) values(?,?,?,?) on conflict(user_id) do update set token_cipher=excluded.token_cipher,expires_at=excluded.expires_at,updated_at=excluded.updated_at')
        .run(row.user_id, sealIntegrationSecret(JSON.stringify(tokens)), tokens.expires_at, now())
      return reply.redirect(`${origin}/?view=connect&canva=connected`)
    } catch (error) {
      console.error('[canva] OAuth callback failed:', error instanceof Error ? error.message : String(error))
      return reply.redirect(`${origin}/?view=connect&canva=error`)
    }
  })
  app.delete('/api/integrations/canva', async (req) => {
    const result = db.prepare('delete from canva_connections where user_id=?').run((req as any).userId)
    return { ok: true, disconnected: Number(result.changes) > 0, note: 'Local Canva tokens removed. Revoke the app in Canva if provider access should end.' }
  })
}
