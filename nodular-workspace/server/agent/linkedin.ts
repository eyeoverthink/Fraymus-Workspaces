import { createHash, randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { db, now } from './db'
import { integrationEncryptionConfigured, openIntegrationSecret, sealIntegrationSecret } from './integration-secrets'
import { registerTools } from './tools'
import type { Tool } from './tools'

const AUTHORIZE = 'https://www.linkedin.com/oauth/v2/authorization'
const TOKEN = 'https://www.linkedin.com/oauth/v2/accessToken'
const API = 'https://api.linkedin.com'
const API_VERSION = '202610'
const SCOPES = ['openid', 'profile', 'w_member_social']
type LinkedInToken = { access_token: string }

const clientId = () => process.env.LINKEDIN_CLIENT_ID || ''
const clientSecret = () => process.env.LINKEDIN_CLIENT_SECRET || ''

function callbackUri(req: any) {
  if (process.env.NODE_ENV === 'production' && !process.env.PUBLIC_URL) throw new Error('PUBLIC_URL must be configured for LinkedIn OAuth in production')
  const origin = process.env.PUBLIC_URL || `${req.protocol}://${req.headers.host}`
  const url = new URL(origin)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('PUBLIC_URL must be an http(s) origin')
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('PUBLIC_URL must use HTTPS in production')
  return `${url.origin}/api/integrations/linkedin/callback`
}

function connection(userId: string) {
  return db.prepare('select token_cipher,person_urn,display_name,expires_at from linkedin_connections where user_id=?').get(userId) as { token_cipher: string; person_urn: string; display_name: string | null; expires_at: number } | undefined
}

async function responseJson(response: Response, provider: string) {
  const text = await response.text()
  let result: any = {}
  try { result = text ? JSON.parse(text) : {} } catch { result = { message: text.slice(0, 300) } }
  if (!response.ok) throw new Error(`${provider} API ${response.status}: ${String(result.message || result.error_description || result.error || 'request rejected').slice(0, 300)}`)
  return result
}

function bounded(value: unknown, name: string, max: number) {
  const result = String(value ?? '').trim()
  if (!result || result.length > max) throw new Error(`${name} must contain 1-${max} characters`)
  return result
}

const linkedInTools: Tool[] = [
  {
    name: 'linkedin_publish_text',
    risk: 'approval',
    description: 'Publish one text-only public post to the connected LinkedIn member profile. Requires confirmPublish=true and app approval. No scheduling, organization pages, images, video, or cross-posting.',
    parameters: { type: 'object', properties: { text: { type: 'string', minLength: 1, maxLength: 3000 }, confirmPublish: { type: 'boolean', description: 'Must be true to explicitly request publishing this one post.' } }, required: ['text', 'confirmPublish'] },
    async run(args, ctx) {
      if (args.confirmPublish !== true) throw new Error('confirmPublish=true is required to publish one LinkedIn post')
      const text = bounded(args.text, 'text', 3000)
      const row = connection(ctx.userId)
      if (!row) throw new Error('Connect LinkedIn in Connect settings first')
      if (row.expires_at <= now()) {
        db.prepare('delete from linkedin_connections where user_id=?').run(ctx.userId)
        throw new Error('LinkedIn access expired; reconnect the account')
      }
      const token = JSON.parse(openIntegrationSecret(row.token_cipher)) as LinkedInToken
      const response = await fetch(`${API}/rest/posts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          'LinkedIn-Version': API_VERSION,
          'X-Restli-Protocol-Version': '2.0.0',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          author: row.person_urn,
          commentary: text,
          visibility: 'PUBLIC',
          distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
          lifecycleState: 'PUBLISHED',
          isReshareDisabledByAuthor: false
        }),
        signal: AbortSignal.timeout(20000)
      })
      await responseJson(response, 'LinkedIn')
      return { published: true, postId: response.headers.get('x-restli-id'), visibility: 'PUBLIC', format: 'text' }
    }
  }
]

export function registerLinkedInTools() {
  registerTools(linkedInTools)
}

export function linkedinConfiguration() {
  const missing = [
    !clientId() && 'LINKEDIN_CLIENT_ID',
    !clientSecret() && 'LINKEDIN_CLIENT_SECRET',
    !integrationEncryptionConfigured() && 'INTEGRATION_ENCRYPTION_KEY (32+ characters)',
    process.env.NODE_ENV === 'production' && !process.env.PUBLIC_URL && 'PUBLIC_URL (HTTPS OAuth callback origin)'
  ].filter(Boolean) as string[]
  return { configured: missing.length === 0, missing }
}

export function linkedinIntegrationStatus(userId: string, req?: any) {
  const config = linkedinConfiguration()
  const account = connection(userId)
  return {
    name: 'linkedin',
    configured: config.configured,
    missing: config.missing,
    connected: !!account && account.expires_at > now() && integrationEncryptionConfigured(),
    credentialStored: !!account,
    displayName: account?.display_name || null,
    callbackUrl: req && (process.env.NODE_ENV !== 'production' || process.env.PUBLIC_URL) ? callbackUri(req) : null,
    capabilities: ['Publish one approved public text post to the connected member profile']
  }
}

export function registerLinkedInRoutes(app: FastifyInstance) {
  app.get('/api/integrations/linkedin', async (req) => linkedinIntegrationStatus((req as any).userId, req))
  app.post('/api/integrations/linkedin/connect', async (req, reply) => {
    const config = linkedinConfiguration()
    if (!config.configured) return reply.status(400).send({ error: `Configure ${config.missing.join(', ')} on the server first` })
    try {
      const state = randomBytes(32).toString('base64url')
      db.prepare('delete from linkedin_oauth_states where expires_at<?').run(now())
      db.prepare('insert into linkedin_oauth_states(state_hash,user_id,expires_at) values(?,?,?)')
        .run(createHash('sha256').update(state).digest('hex'), (req as any).userId, now() + 10 * 60_000)
      const url = new URL(AUTHORIZE)
      url.search = new URLSearchParams({
        client_id: clientId(), redirect_uri: callbackUri(req), response_type: 'code',
        scope: SCOPES.join(' '), state
      }).toString()
      return { authorizationUrl: url.toString() }
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : String(error) })
    }
  })
  app.get('/api/integrations/linkedin/callback', async (req, reply) => {
    const query = req.query as any
    const state = String(query.state || '')
    const stateHash = createHash('sha256').update(state).digest('hex')
    const row = state ? db.prepare('select user_id,expires_at from linkedin_oauth_states where state_hash=?').get(stateHash) as any : null
    const origin = (() => {
      try { return new URL(process.env.PUBLIC_URL || `${req.protocol}://${req.headers.host}`).origin } catch { return '' }
    })()
    if (!row || row.expires_at < now() || !origin) {
      if (row) db.prepare('delete from linkedin_oauth_states where state_hash=?').run(stateHash)
      return reply.redirect(`${origin || '/'}?view=connect&linkedin=error`)
    }
    db.prepare('delete from linkedin_oauth_states where state_hash=?').run(stateHash)
    if (query.error || !query.code) return reply.redirect(`${origin}/?view=connect&linkedin=error`)
    try {
      const tokenResponse = await fetch(TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: String(query.code),
          redirect_uri: callbackUri(req),
          client_id: clientId(),
          client_secret: clientSecret()
        }),
        signal: AbortSignal.timeout(15000)
      })
      const received = await responseJson(tokenResponse, 'LinkedIn OAuth')
      if (!received.access_token) throw new Error('LinkedIn did not return an access token')
      const profile = await responseJson(await fetch(`${API}/v2/userinfo`, {
        headers: { Authorization: `Bearer ${received.access_token}` },
        signal: AbortSignal.timeout(15000)
      }), 'LinkedIn profile lookup')
      if (!profile.sub) throw new Error('LinkedIn did not return a member identifier')
      const expiresAt = now() + Number(received.expires_in || 5184000) * 1000
      db.prepare('insert into linkedin_connections(user_id,token_cipher,person_urn,display_name,expires_at,updated_at) values(?,?,?,?,?,?) on conflict(user_id) do update set token_cipher=excluded.token_cipher,person_urn=excluded.person_urn,display_name=excluded.display_name,expires_at=excluded.expires_at,updated_at=excluded.updated_at')
        .run(row.user_id, sealIntegrationSecret(JSON.stringify({ access_token: String(received.access_token) })), `urn:li:person:${profile.sub}`, String(profile.name || '').slice(0, 200), expiresAt, now())
      return reply.redirect(`${origin}/?view=connect&linkedin=connected`)
    } catch (error) {
      console.error('[linkedin] OAuth callback failed:', error instanceof Error ? error.message : String(error))
      return reply.redirect(`${origin}/?view=connect&linkedin=error`)
    }
  })
  app.delete('/api/integrations/linkedin', async (req) => {
    const result = db.prepare('delete from linkedin_connections where user_id=?').run((req as any).userId)
    return { ok: true, disconnected: Number(result.changes) > 0, note: 'Local LinkedIn token removed. Revoke the app in LinkedIn if provider access should end.' }
  })
}
