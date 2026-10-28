import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { db, now } from './db'

export const SCOPES = ['read', 'run', 'admin'] as const
export type Scope = (typeof SCOPES)[number]
export type Principal = { userId: string; scopes: Scope[]; via: string }

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const cleanScopes = (s: any): Scope[] => {
  const list = (Array.isArray(s) ? s : String(s || 'read run').split(/[\s,]+/)).filter((x) => (SCOPES as readonly string[]).includes(x)) as Scope[]
  if (!list.length) throw new Error(`scopes must include one of: ${SCOPES.join(', ')}`)
  return [...new Set(list)]
}
const eq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y) }

export function createToken(userId: string, name: string, scopes: any, ttlSec?: number, kind = 'pat', clientId?: string) {
  const token = `nw_${randomBytes(32).toString('base64url')}`
  const id = randomUUID()
  db.prepare('insert into access_tokens(id,user_id,name,kind,client_id,hash,scopes,expires_at,created_at) values(?,?,?,?,?,?,?,?,?)')
    .run(id, userId, String(name || 'token').slice(0, 60), kind, clientId ?? null, sha(token), cleanScopes(scopes).join(' '), ttlSec ? now() + ttlSec * 1000 : null, now())
  return { id, token }
}

export function createClient(userId: string, name: string, scopes: any) {
  const clientId = `nwc_${randomBytes(9).toString('hex')}`
  const secret = `nws_${randomBytes(32).toString('base64url')}`
  db.prepare('insert into oauth_clients(client_id,user_id,name,secret_hash,scopes,created_at) values(?,?,?,?,?,?)')
    .run(clientId, userId, String(name || 'client').slice(0, 60), sha(secret), cleanScopes(scopes).join(' '), now())
  return { clientId, clientSecret: secret }
}

export function verifyBearer(header: string | undefined): Principal | null {
  const tok = String(header || '').replace(/^Bearer\s+/i, '').trim()
  if (!tok) return null
  const admin = process.env.MCP_ADMIN_TOKEN
  if (admin && admin.length >= 24 && eq(tok, admin)) return { userId: process.env.MCP_ADMIN_USER || 'local', scopes: [...SCOPES], via: 'env-admin-token' }
  const row = db.prepare('select id,user_id,name,scopes,expires_at from access_tokens where hash=?').get(sha(tok)) as any
  if (!row || (row.expires_at && row.expires_at < now())) return null
  db.prepare('update access_tokens set last_used=? where id=?').run(now(), row.id)
  return { userId: row.user_id, scopes: row.scopes.split(' ') as Scope[], via: row.name }
}

export const can = (p: Principal, s: Scope) => p.scopes.includes('admin') || p.scopes.includes(s)

const failures = new Map<string, { n: number; t: number }>()
const throttled = (ip: string) => { const f = failures.get(ip); return !!f && f.n >= 10 && now() - f.t < 60_000 }
const fail = (ip: string) => { const f = failures.get(ip); failures.set(ip, { n: f && now() - f.t < 60_000 ? f.n + 1 : 1, t: now() }) }

const issuer = (req: any) => process.env.PUBLIC_URL || `${req.protocol}://${req.headers.host}`

// Unauthenticated endpoints: discovery + the OAuth 2.0 client_credentials token endpoint.
export function registerOAuthRoutes(app: FastifyInstance) {
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    try { done(null, Object.fromEntries(new URLSearchParams(body as string))) } catch (e: any) { done(e) }
  })

  app.get('/.well-known/oauth-authorization-server', async (req) => ({
    issuer: issuer(req),
    token_endpoint: `${issuer(req)}/oauth/token`,
    grant_types_supported: ['client_credentials'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    scopes_supported: [...SCOPES],
    response_types_supported: []
  }))
  app.get('/.well-known/oauth-protected-resource', async (req) => ({
    resource: `${issuer(req)}/mcp`,
    authorization_servers: [issuer(req)],
    scopes_supported: [...SCOPES],
    bearer_methods_supported: ['header']
  }))

  app.post('/oauth/token', async (req, reply) => {
    const err = (code: number, error: string) => reply.status(code).header('Cache-Control', 'no-store').send({ error })
    if (throttled(req.ip)) return err(429, 'too_many_attempts')
    const b: any = req.body || {}
    if (b.grant_type !== 'client_credentials') return err(400, 'unsupported_grant_type')
    let id = b.client_id, secret = b.client_secret
    const basic = /^Basic\s+(.+)$/i.exec(String(req.headers.authorization || ''))
    if (basic) { const [i, ...s] = Buffer.from(basic[1], 'base64').toString().split(':'); id = decodeURIComponent(i); secret = decodeURIComponent(s.join(':')) }
    const c = id ? (db.prepare('select * from oauth_clients where client_id=?').get(String(id)) as any) : null
    if (!c || !secret || !eq(sha(String(secret)), c.secret_hash)) { fail(req.ip); return err(401, 'invalid_client') }
    const allowed = c.scopes.split(' ') as Scope[]
    const asked = b.scope ? String(b.scope).split(/\s+/).filter(Boolean) : allowed
    if (asked.some((s: string) => !allowed.includes(s as Scope))) return err(400, 'invalid_scope')
    const { token } = createToken(c.user_id, `oauth:${c.name}`, asked, 3600, 'oauth', c.client_id)
    return reply.header('Cache-Control', 'no-store').send({ access_token: token, token_type: 'Bearer', expires_in: 3600, scope: asked.join(' ') })
  })
}

// Management endpoints (mounted under /api so the normal user auth applies).
export function registerAccessRoutes(app: FastifyInstance) {
  const uid = (req: any) => req.userId as string
  const bad = (reply: any, e: any) => reply.status(400).send({ error: e.message || String(e) })

  app.get('/api/access', async (req) => ({
    tokens: db.prepare("select id,name,kind,scopes,expires_at,created_at,last_used from access_tokens where user_id=? and (kind='pat' or expires_at>?) order by created_at desc").all(uid(req), now()),
    clients: db.prepare('select client_id,name,scopes,created_at from oauth_clients where user_id=? order by created_at desc').all(uid(req)),
    envAdminToken: !!process.env.MCP_ADMIN_TOKEN
  }))
  app.post('/api/access/tokens', async (req, reply) => {
    try { const b: any = req.body || {}; return createToken(uid(req), b.name, b.scopes, b.ttlDays ? Math.min(Number(b.ttlDays), 365) * 86400 : undefined) } catch (e) { return bad(reply, e) }
  })
  app.post('/api/access/clients', async (req, reply) => {
    try { const b: any = req.body || {}; return createClient(uid(req), b.name, b.scopes) } catch (e) { return bad(reply, e) }
  })
  app.delete('/api/access/tokens/:id', async (req) => ({ ok: Number(db.prepare('delete from access_tokens where id=? and user_id=?').run((req.params as any).id, uid(req)).changes) > 0 }))
  app.delete('/api/access/clients/:id', async (req) => {
    const id = (req.params as any).id
    const r = db.prepare('delete from oauth_clients where client_id=? and user_id=?').run(id, uid(req))
    if (Number(r.changes)) db.prepare('delete from access_tokens where client_id=?').run(id)
    return { ok: Number(r.changes) > 0 }
  })
}
