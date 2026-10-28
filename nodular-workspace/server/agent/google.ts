import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { db, now } from './db'
import { registerTools } from './tools'
import type { Tool } from './tools'

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'
const GOOGLE_API = 'https://gmail.googleapis.com/gmail/v1'
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.events'
]

type GoogleTokens = { access_token: string; refresh_token?: string; expires_at: number }
const key = () => {
  const secret = process.env.INTEGRATION_ENCRYPTION_KEY || ''
  if (secret.length < 32) throw new Error('INTEGRATION_ENCRYPTION_KEY must be at least 32 characters')
  return createHash('sha256').update(secret).digest()
}
const seal = (value: string) => {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url')
}
const unseal = (value: string) => {
  const data = Buffer.from(value, 'base64url')
  if (data.length < 29) throw new Error('invalid encrypted integration data')
  const decipher = createDecipheriv('aes-256-gcm', key(), data.subarray(0, 12))
  decipher.setAuthTag(data.subarray(12, 28))
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8')
}

const clientId = () => process.env.GOOGLE_CLIENT_ID || ''
const clientSecret = () => process.env.GOOGLE_CLIENT_SECRET || ''
export function googleConfiguration() {
  const missing = [
    !clientId() && 'GOOGLE_CLIENT_ID',
    !clientSecret() && 'GOOGLE_CLIENT_SECRET',
    (process.env.INTEGRATION_ENCRYPTION_KEY || '').length < 32 && 'INTEGRATION_ENCRYPTION_KEY (32+ characters)'
  ].filter(Boolean) as string[]
  return { configured: missing.length === 0, missing }
}

function requestOrigin(req: any) {
  if (process.env.NODE_ENV === 'production' && !process.env.PUBLIC_URL) throw new Error('PUBLIC_URL must be configured for Google OAuth in production')
  const value = process.env.PUBLIC_URL || `${req.protocol}://${req.headers.host}`
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('PUBLIC_URL must be an http(s) origin')
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('PUBLIC_URL must use HTTPS in production')
  return url.origin
}

export function googleRedirectUri(req: any) {
  return `${requestOrigin(req)}/api/integrations/google/callback`
}

function googleError(response: Response, label: string): Promise<never> {
  return response.text().then((text) => {
    let detail = ''
    try { const json = JSON.parse(text); detail = json.error?.message || json.error_description || '' } catch {}
    throw new Error(`${label} failed (${response.status})${detail ? `: ${detail.slice(0, 240)}` : ''}`)
  })
}

function connection(userId: string) {
  return db.prepare('select email,token_cipher from google_connections where user_id=?').get(userId) as { email: string; token_cipher: string } | undefined
}

async function tokensFor(userId: string): Promise<GoogleTokens> {
  const row = connection(userId)
  if (!row) throw new Error('Connect a Google account in Connect settings first')
  const tokens = JSON.parse(unseal(row.token_cipher)) as GoogleTokens
  if (tokens.expires_at > now() + 60_000) return tokens
  if (!tokens.refresh_token) throw new Error('Google connection expired; reconnect the account')
  const response = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId(), client_secret: clientSecret(), refresh_token: tokens.refresh_token, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(15000)
  })
  if (!response.ok) {
    if (response.status === 400 || response.status === 401) db.prepare('delete from google_connections where user_id=?').run(userId)
    return googleError(response, 'Google token refresh')
  }
  const refreshed = await response.json() as any
  const next: GoogleTokens = {
    access_token: String(refreshed.access_token),
    refresh_token: tokens.refresh_token,
    expires_at: now() + Number(refreshed.expires_in || 3600) * 1000
  }
  db.prepare('update google_connections set token_cipher=?,updated_at=? where user_id=?').run(seal(JSON.stringify(next)), now(), userId)
  return next
}

async function googleFetch(userId: string, url: string, init?: RequestInit) {
  const tokens = await tokensFor(userId)
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${tokens.access_token}`, ...(init?.headers || {}) },
    signal: init?.signal || AbortSignal.timeout(20000)
  })
  if (!response.ok) return googleError(response, 'Google API')
  return response
}

function boundedText(value: unknown, name: string, max: number) {
  const text = String(value ?? '').trim()
  if (!text || text.length > max) throw new Error(`${name} must contain 1-${max} characters`)
  return text
}

function gmailHeaders(payload: any) {
  return Object.fromEntries((payload?.headers || []).filter((h: any) => ['subject', 'from', 'to', 'date'].includes(String(h.name).toLowerCase())).map((h: any) => [String(h.name).toLowerCase(), h.value]))
}

async function gmailSearch(userId: string, query: string, maxResults: number) {
  const search = new URL(`${GOOGLE_API}/users/me/messages`)
  search.searchParams.set('q', query)
  search.searchParams.set('maxResults', String(maxResults))
  const listed = await googleFetch(userId, search.toString()).then((r) => r.json()) as any
  const messages = await Promise.all((listed.messages || []).slice(0, maxResults).map(async (item: any) => {
    const url = new URL(`${GOOGLE_API}/users/me/messages/${encodeURIComponent(item.id)}`)
    url.searchParams.set('format', 'metadata')
    for (const header of ['From', 'To', 'Subject', 'Date']) url.searchParams.append('metadataHeaders', header)
    const message = await googleFetch(userId, url.toString()).then((r) => r.json()) as any
    return { id: message.id, threadId: message.threadId, snippet: message.snippet, headers: gmailHeaders(message.payload), internalDate: message.internalDate }
  }))
  return { query, messages }
}

const googleTools: Tool[] = [
  {
    name: 'google_gmail_search', risk: 'safe',
    description: 'Search the connected user’s Gmail mailbox using Gmail search syntax. Returns message snippets and basic headers; never returns attachments.',
    parameters: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 256 }, maxResults: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['query'] },
    async run(args, ctx) {
      const query = boundedText(args.query, 'query', 256)
      const max = Math.min(Math.max(Number(args.maxResults) || 5, 1), 10)
      return gmailSearch(ctx.userId, query, max)
    }
  },
  {
    name: 'google_gmail_create_draft', risk: 'approval',
    description: 'Create a Gmail draft in the connected user’s account. Requires user approval; does not send.',
    parameters: { type: 'object', properties: { to: { type: 'string', maxLength: 320 }, subject: { type: 'string', maxLength: 998 }, body: { type: 'string', maxLength: 20000 } }, required: ['to', 'subject', 'body'] },
    async run(args, ctx) {
      const to = boundedText(args.to, 'to', 320)
      const subject = boundedText(args.subject, 'subject', 998)
      const body = boundedText(args.body, 'body', 20000)
      if (/[\r\n]/.test(to) || /[\r\n]/.test(subject) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error('to must be one valid email address; header newlines are not allowed')
      const raw = Buffer.from(`To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}`).toString('base64url')
      const response = await googleFetch(ctx.userId, `${GOOGLE_API}/users/me/drafts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: { raw } }) })
      const draft = await response.json() as any
      return { created: true, draftId: draft.id, messageId: draft.message?.id }
    }
  },
  {
    name: 'google_gmail_send', risk: 'approval',
    description: 'Send one user-reviewed email from Gmail after app approval. Requires explicit confirmSend=true and user approval; never use for bulk outreach.',
    parameters: { type: 'object', properties: { to: { type: 'string', maxLength: 320 }, subject: { type: 'string', maxLength: 998 }, body: { type: 'string', maxLength: 20000 }, confirmSend: { type: 'boolean', description: 'Must be true to explicitly request sending this single email.' } }, required: ['to', 'subject', 'body', 'confirmSend'] },
    async run(args, ctx) {
      if (args.confirmSend !== true) throw new Error('confirmSend=true is required to send a single reviewed email')
      const to = boundedText(args.to, 'to', 320)
      const subject = boundedText(args.subject, 'subject', 998)
      const body = boundedText(args.body, 'body', 20000)
      if (/[\r\n]/.test(to) || /[\r\n]/.test(subject) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error('to must be one valid email address; header newlines are not allowed')
      const raw = Buffer.from(`To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}`).toString('base64url')
      const response = await googleFetch(ctx.userId, `${GOOGLE_API}/users/me/messages/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }) })
      const message = await response.json() as any
      return { sent: true, messageId: message.id, threadId: message.threadId, recipient: to }
    }
  },
  {
    name: 'google_calendar_list_events', risk: 'safe',
    description: 'Read events from the connected user’s primary Google Calendar for an ISO date range (up to 31 days).',
    parameters: { type: 'object', properties: { timeMin: { type: 'string', description: 'ISO 8601 start; defaults to now.' }, timeMax: { type: 'string', description: 'ISO 8601 end; defaults to seven days from now.' }, maxResults: { type: 'integer', minimum: 1, maximum: 25 } } },
    async run(args, ctx) {
      const start = args.timeMin ? new Date(String(args.timeMin)) : new Date()
      const end = args.timeMax ? new Date(String(args.timeMax)) : new Date(start.getTime() + 7 * 86400000)
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || end.getTime() - start.getTime() > 31 * 86400000) throw new Error('provide a valid ISO date range no longer than 31 days')
      const url = new URL(`${CALENDAR_API}/calendars/primary/events`)
      url.searchParams.set('timeMin', start.toISOString())
      url.searchParams.set('timeMax', end.toISOString())
      url.searchParams.set('singleEvents', 'true')
      url.searchParams.set('orderBy', 'startTime')
      url.searchParams.set('maxResults', String(Math.min(Math.max(Number(args.maxResults) || 10, 1), 25)))
      const result = await googleFetch(ctx.userId, url.toString()).then((r) => r.json()) as any
      return { timeMin: start.toISOString(), timeMax: end.toISOString(), events: (result.items || []).map((event: any) => ({ id: event.id, summary: event.summary, description: event.description, start: event.start, end: event.end, htmlLink: event.htmlLink, attendees: event.attendees?.map((a: any) => ({ email: a.email, responseStatus: a.responseStatus })) })) }
    }
  },
  {
    name: 'google_calendar_create_event', risk: 'approval',
    description: 'Create one event on the connected user’s primary Google Calendar. Requires user approval before the event is written.',
    parameters: { type: 'object', properties: { summary: { type: 'string', maxLength: 200 }, description: { type: 'string', maxLength: 4000 }, start: { type: 'string', description: 'ISO 8601 date-time including offset or Z.' }, end: { type: 'string', description: 'ISO 8601 date-time including offset or Z.' }, timeZone: { type: 'string', description: 'IANA timezone, e.g. America/Los_Angeles.' } }, required: ['summary', 'start', 'end'] },
    async run(args, ctx) {
      const summary = boundedText(args.summary, 'summary', 200)
      const startText = String(args.start)
      const endText = String(args.end)
      const hasOffset = (value: string) => /(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
      const start = new Date(startText)
      const end = new Date(endText)
      if (!hasOffset(startText) || !hasOffset(endText) || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new Error('start and end must be ISO 8601 date-times with Z or an explicit UTC offset, and end must follow start')
      const timeZone = args.timeZone ? boundedText(args.timeZone, 'timeZone', 100) : undefined
      const event = {
        summary,
        description: args.description ? boundedText(args.description, 'description', 4000) : undefined,
        start: { dateTime: start.toISOString(), ...(timeZone ? { timeZone } : {}) },
        end: { dateTime: end.toISOString(), ...(timeZone ? { timeZone } : {}) }
      }
      const response = await googleFetch(ctx.userId, `${CALENDAR_API}/calendars/primary/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event) })
      const created = await response.json() as any
      return { created: true, id: created.id, summary: created.summary, start: created.start, end: created.end, htmlLink: created.htmlLink }
    }
  }
]

export function registerGoogleTools() {
  registerTools(googleTools)
}

export function googleIntegrationStatus(userId: string, req?: any) {
  const config = googleConfiguration()
  const connected = connection(userId)
  return {
    name: 'google',
    configured: config.configured,
    missing: config.missing,
    connected: !!connected,
    email: connected?.email || null,
    callbackUrl: req ? googleRedirectUri(req) : null,
    capabilities: ['Gmail search', 'Create reviewed Gmail drafts', 'Send one approved email', 'List primary calendar events', 'Create approved calendar events']
  }
}

export function registerGoogleRoutes(app: FastifyInstance) {
  app.get('/api/integrations/google', async (req) => googleIntegrationStatus((req as any).userId, req))

  app.post('/api/integrations/google/connect', async (req, reply) => {
    if (!googleConfiguration().configured) return reply.status(400).send({ error: `Configure ${googleConfiguration().missing.join(', ')} on the server first` })
    try {
      const state = randomBytes(32).toString('base64url')
      const verifier = randomBytes(32).toString('base64url')
      const challenge = createHash('sha256').update(verifier).digest('base64url')
      db.prepare('delete from google_oauth_states where expires_at<?').run(now())
      db.prepare('insert into google_oauth_states(state_hash,user_id,verifier_cipher,expires_at) values(?,?,?,?)')
        .run(createHash('sha256').update(state).digest('hex'), (req as any).userId, seal(verifier), now() + 10 * 60_000)
      const url = new URL(GOOGLE_AUTH)
      url.search = new URLSearchParams({
        client_id: clientId(),
        redirect_uri: googleRedirectUri(req),
        response_type: 'code',
        scope: SCOPES.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256'
      }).toString()
      return { authorizationUrl: url.toString() }
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  app.get('/api/integrations/google/callback', async (req, reply) => {
    const query = req.query as any
    const state = String(query.state || '')
    const stateHash = createHash('sha256').update(state).digest('hex')
    const row = state ? db.prepare('select user_id,verifier_cipher,expires_at from google_oauth_states where state_hash=?').get(stateHash) as any : null
    if (!row || row.expires_at < now()) {
      if (row) db.prepare('delete from google_oauth_states where state_hash=?').run(stateHash)
      return reply.redirect(`${requestOrigin(req)}/?view=connect&google=error`)
    }
    db.prepare('delete from google_oauth_states where state_hash=?').run(stateHash)
    if (query.error || !query.code) return reply.redirect(`${requestOrigin(req)}/?view=connect&google=error`)
    try {
      const tokenResponse = await fetch(GOOGLE_TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: String(query.code),
          client_id: clientId(),
          client_secret: clientSecret(),
          redirect_uri: googleRedirectUri(req),
          grant_type: 'authorization_code',
          code_verifier: unseal(row.verifier_cipher)
        }),
        signal: AbortSignal.timeout(15000)
      })
      if (!tokenResponse.ok) return await googleError(tokenResponse, 'Google authorization').catch(() => reply.redirect(`${requestOrigin(req)}/?view=connect&google=error`))
      const received = await tokenResponse.json() as any
      if (!received.access_token || !received.refresh_token) throw new Error('Google did not return offline access; reconnect and grant access')
      const profileResponse = await fetch(`${GOOGLE_API}/users/me/profile`, { headers: { Authorization: `Bearer ${received.access_token}` }, signal: AbortSignal.timeout(15000) })
      if (!profileResponse.ok) return await googleError(profileResponse, 'Gmail profile lookup').catch(() => reply.redirect(`${requestOrigin(req)}/?view=connect&google=error`))
      const profile = await profileResponse.json() as any
      if (!profile.emailAddress) throw new Error('Google did not return a Gmail address')
      const tokens: GoogleTokens = { access_token: String(received.access_token), refresh_token: String(received.refresh_token), expires_at: now() + Number(received.expires_in || 3600) * 1000 }
      db.prepare('insert into google_connections(user_id,email,token_cipher,updated_at) values(?,?,?,?) on conflict(user_id) do update set email=excluded.email,token_cipher=excluded.token_cipher,updated_at=excluded.updated_at')
        .run(row.user_id, String(profile.emailAddress), seal(JSON.stringify(tokens)), now())
      return reply.redirect(`${requestOrigin(req)}/?view=connect&google=connected`)
    } catch (error) {
      console.error('[google] OAuth callback failed:', error instanceof Error ? error.message : String(error))
      return reply.redirect(`${requestOrigin(req)}/?view=connect&google=error`)
    }
  })

  app.delete('/api/integrations/google', async (req, reply) => {
    const userId = (req as any).userId as string
    const row = connection(userId)
    if (!row) return { ok: true, disconnected: false }
    db.prepare('delete from google_connections where user_id=?').run(userId)
    let tokens: GoogleTokens
    try { tokens = JSON.parse(unseal(row.token_cipher)) as GoogleTokens }
    catch { return { ok: true, disconnected: true, warning: 'Local tokens were removed, but Google revocation could not be completed. Revoke Nodular access in Google Account settings.' } }
    try {
      const response = await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: tokens.refresh_token || tokens.access_token }),
        signal: AbortSignal.timeout(10000)
      })
      if (!response.ok) return reply.status(502).send({ error: 'Disconnected locally, but Google token revocation failed. Revoke Nodular access in your Google Account settings.' })
    } catch {
      return reply.status(502).send({ error: 'Disconnected locally, but Google token revocation could not be confirmed. Revoke Nodular access in your Google Account settings.' })
    }
    return { ok: true, disconnected: true }
  })
}
