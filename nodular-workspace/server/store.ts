import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { supabaseAdmin } from './lib/supabase'

export type User = { id: string; email?: string | null; plan: string; credits: number; stripe_customer_id?: string | null }
export type WorkflowRow = {
  id: string; user_id: string; name: string; nodes: any[]; edges: any[]
  is_deployed: boolean; deploy_url: string | null; runs: number; created_at?: string; updated_at?: string
}
export type RunRow = {
  workflow_id: string; user_id: string; status: 'success' | 'failed'; input_prompt?: string | null
  results: any; final_image_url?: string | null; final_html?: string | null; duration_ms: number
}

export type GrantResult = { granted: boolean; userId: string | null; credits: number }
export type RevokeResult = { revoked: number; clawedBack: number; shortfall: number; duplicate?: boolean }
export type CodeCheck = 'ok' | 'bad' | 'expired' | 'locked'

export interface Store {
  kind: string
  ensureUser(id: string, email?: string | null): Promise<User>
  getUser(id: string): Promise<User | null>
  setStripeCustomer(id: string, customerId: string): Promise<void>
  consumeCredit(id: string): Promise<boolean>
  refundCredit(id: string): Promise<void>
  // --- Shopify fulfillment + buyer access (SQLite only; Option B single Fly machine) ---
  getUserByEmail(email: string): Promise<User | null>
  linkEmail(userId: string, email: string): Promise<User>
  markEvent(key: string): Promise<boolean>
  grantOrder(g: { orderId: string; email: string; credits: number; orderName?: string }): Promise<GrantResult>
  revokeOrder(orderId: string, credits: number | null): Promise<RevokeResult>
  getGrant(orderId: string): Promise<any | null>
  saveLoginCode(email: string, codeHash: string, ttlMs: number): Promise<void>
  checkLoginCode(email: string, codeHash: string): Promise<CodeCheck>
  createSession(userId: string, tokenHash: string, ttlMs: number): Promise<void>
  getSession(tokenHash: string): Promise<string | null>
  upsertWorkflow(w: Pick<WorkflowRow, 'id' | 'user_id' | 'name' | 'nodes' | 'edges'>): Promise<WorkflowRow>
  getWorkflow(id: string): Promise<WorkflowRow | null>
  listWorkflows(userId: string): Promise<WorkflowRow[]>
  markDeployed(id: string, url: string): Promise<void>
  createApiKey(userId: string, workflowId: string, name: string): Promise<string>
  findApiKey(raw: string): Promise<{ user_id: string; workflow_id: string } | null>
  saveRun(r: RunRow): Promise<string>
  listRuns(userId: string, workflowId?: string): Promise<any[]>
}

export const hashKey = (raw: string) => createHash('sha256').update(raw).digest('hex')
// Paid packs are the product, so new accounts start at 0 unless FREE_CREDITS says otherwise.
const DEFAULT_CREDITS = Number(process.env.FREE_CREDITS || 0)
export const normEmail = (e: unknown) => String(e || '').trim().toLowerCase()
export const buyerIdFor = (email: string) => 'buyer_' + createHash('sha256').update(normEmail(email)).digest('hex').slice(0, 24)
const newKey = () => 'nk_' + randomBytes(24).toString('hex')

async function sqliteStore(): Promise<Store> {
  const { DatabaseSync } = await import('node:sqlite')
  const dir = process.env.DATA_DIR || './data'
  mkdirSync(dir, { recursive: true })
  const db = new DatabaseSync(`${dir}/nodular.db`)
  db.exec(`
    create table if not exists users (id text primary key, email text, plan text default 'free', credits integer default ${DEFAULT_CREDITS}, stripe_customer_id text, created_at text default current_timestamp);
    create table if not exists workflows (id text primary key, user_id text not null, name text not null, nodes text not null, edges text not null, is_deployed integer default 0, deploy_url text, runs integer default 0, created_at text default current_timestamp, updated_at text default current_timestamp);
    create table if not exists workflow_runs (id integer primary key autoincrement, workflow_id text, user_id text, status text, input_prompt text, results text, final_image_url text, final_html text, duration_ms integer, created_at text default current_timestamp);
    create table if not exists api_keys (id integer primary key autoincrement, user_id text, key_hash text unique not null, key_prefix text, name text, workflow_id text, last_used_at text, created_at text default current_timestamp);
    create index if not exists idx_users_email on users(email);
    create table if not exists credit_grants (order_id text primary key, order_name text, email text not null, user_id text not null, credits integer not null, revoked integer not null default 0, status text not null default 'granted', created_at text default current_timestamp, updated_at text default current_timestamp);
    create index if not exists idx_grants_email on credit_grants(email);
    create table if not exists webhook_events (event_key text primary key, created_at text default current_timestamp);
    create table if not exists login_codes (email text primary key, code_hash text not null, expires_at integer not null, attempts integer not null default 0);
    create table if not exists buyer_sessions (token_hash text primary key, user_id text not null, expires_at integer not null, created_at text default current_timestamp);
  `)
  const tx = <T>(fn: () => T): T => {
    db.exec('begin immediate')
    try { const r = fn(); db.exec('commit'); return r } catch (e) { db.exec('rollback'); throw e }
  }
  const toWf = (r: any): WorkflowRow => ({ ...r, nodes: JSON.parse(r.nodes), edges: JSON.parse(r.edges), is_deployed: !!r.is_deployed })
  const self: Store = {
    kind: 'sqlite',
    async ensureUser(id, email) {
      db.prepare('insert or ignore into users (id, credits) values (?, ?)').run(id, DEFAULT_CREDITS)
      if (email) return self.linkEmail(id, email)
      return (await self.getUser(id))!
    },
    async getUser(id) { return (db.prepare('select * from users where id = ?').get(id) as any) || null },
    async getUserByEmail(email) {
      const e = normEmail(email)
      if (!e) return null
      // Prefer a real (Clerk) account over the placeholder buyer account
      return (db.prepare("select * from users where email = ? order by (id like 'buyer\\_%' escape '\\') asc, created_at asc limit 1").get(e) as any) || null
    },
    async linkEmail(userId, email) {
      const e = normEmail(email)
      tx(() => {
        db.prepare('update users set email = ? where id = ?').run(e, userId)
        // A buyer who paid before signing in: fold the placeholder account (credits + grants) into this one
        const ph = buyerIdFor(e)
        if (ph !== userId) {
          const p: any = db.prepare('select credits from users where id = ?').get(ph)
          if (p) {
            db.prepare('update users set credits = credits + ? where id = ?').run(p.credits, userId)
            db.prepare('update credit_grants set user_id = ? where user_id = ?').run(userId, ph)
            db.prepare('update buyer_sessions set user_id = ? where user_id = ?').run(userId, ph)
            db.prepare('delete from users where id = ?').run(ph)
          }
        }
      })
      return (await self.getUser(userId))!
    },
    async refundCredit(id) { db.prepare('update users set credits = credits + 1 where id = ?').run(id) },
    async markEvent(key) {
      return db.prepare('insert or ignore into webhook_events (event_key) values (?)').run(key).changes > 0
    },
    async grantOrder({ orderId, email, credits, orderName }) {
      const e = normEmail(email)
      return tx(() => {
        if (db.prepare('select 1 from credit_grants where order_id = ?').get(orderId)) return { granted: false, userId: null, credits: 0 }
        const existing: any = db.prepare("select id from users where email = ? order by (id like 'buyer\\_%' escape '\\') asc, created_at asc limit 1").get(e)
        const userId = existing?.id || buyerIdFor(e)
        db.prepare('insert or ignore into users (id, email, credits) values (?, ?, 0)').run(userId, e)
        db.prepare('insert into credit_grants (order_id, order_name, email, user_id, credits) values (?,?,?,?,?)').run(orderId, orderName ?? null, e, userId, credits)
        db.prepare('update users set credits = credits + ? where id = ?').run(credits, userId)
        return { granted: true, userId, credits }
      })
    },
    async revokeOrder(orderId, credits) {
      return tx(() => {
        const g: any = db.prepare('select * from credit_grants where order_id = ?').get(orderId)
        if (!g) return { revoked: 0, clawedBack: 0, shortfall: 0 }
        const remaining = g.credits - g.revoked
        const take = Math.max(0, Math.min(credits ?? remaining, remaining))
        const bal: any = db.prepare('select credits from users where id = ?').get(g.user_id)
        const clawedBack = Math.min(take, Math.max(0, bal?.credits ?? 0))
        db.prepare('update users set credits = credits - ? where id = ?').run(clawedBack, g.user_id)
        db.prepare("update credit_grants set revoked = revoked + ?, status = ?, updated_at = current_timestamp where order_id = ?")
          .run(take, take >= remaining ? 'revoked' : 'partially_revoked', orderId)
        return { revoked: take, clawedBack, shortfall: take - clawedBack }
      })
    },
    async getGrant(orderId) { return (db.prepare('select * from credit_grants where order_id = ?').get(orderId) as any) || null },
    async saveLoginCode(email, codeHash, ttlMs) {
      db.prepare('insert into login_codes (email, code_hash, expires_at, attempts) values (?,?,?,0) on conflict(email) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0')
        .run(normEmail(email), codeHash, Date.now() + ttlMs)
    },
    async checkLoginCode(email, codeHash) {
      const e = normEmail(email)
      const r: any = db.prepare('select * from login_codes where email = ?').get(e)
      if (!r) return 'bad'
      if (r.expires_at < Date.now()) { db.prepare('delete from login_codes where email = ?').run(e); return 'expired' }
      if (r.attempts >= 5) return 'locked'
      const a = Buffer.from(r.code_hash, 'hex'), b = Buffer.from(codeHash, 'hex')
      if (a.length === b.length && timingSafeEqual(a, b)) { db.prepare('delete from login_codes where email = ?').run(e); return 'ok' }
      db.prepare('update login_codes set attempts = attempts + 1 where email = ?').run(e)
      return 'bad'
    },
    async createSession(userId, tokenHash, ttlMs) {
      db.prepare('delete from buyer_sessions where expires_at < ?').run(Date.now())
      db.prepare('insert into buyer_sessions (token_hash, user_id, expires_at) values (?,?,?)').run(tokenHash, userId, Date.now() + ttlMs)
    },
    async getSession(tokenHash) {
      const r: any = db.prepare('select user_id, expires_at from buyer_sessions where token_hash = ?').get(tokenHash)
      return r && r.expires_at > Date.now() ? r.user_id : null
    },
    async setStripeCustomer(id, c) { db.prepare('update users set stripe_customer_id = ? where id = ?').run(c, id) },
    async consumeCredit(id) {
      return db.prepare('update users set credits = credits - 1 where id = ? and credits > 0').run(id).changes > 0
    },
    async upsertWorkflow(w) {
      db.prepare(`insert into workflows (id, user_id, name, nodes, edges) values (?,?,?,?,?)
        on conflict(id) do update set nodes = excluded.nodes, edges = excluded.edges, name = excluded.name, updated_at = current_timestamp`)
        .run(w.id, w.user_id, w.name, JSON.stringify(w.nodes), JSON.stringify(w.edges))
      return (await self.getWorkflow(w.id))!
    },
    async getWorkflow(id) {
      const r = db.prepare('select * from workflows where id = ?').get(id)
      return r ? toWf(r) : null
    },
    async listWorkflows(userId) {
      return db.prepare('select * from workflows where user_id = ? order by updated_at desc').all(userId).map(toWf)
    },
    async markDeployed(id, url) { db.prepare('update workflows set is_deployed = 1, deploy_url = ? where id = ?').run(url, id) },
    async createApiKey(userId, workflowId, name) {
      const raw = newKey()
      db.prepare('insert into api_keys (user_id, key_hash, key_prefix, name, workflow_id) values (?,?,?,?,?)')
        .run(userId, hashKey(raw), raw.slice(0, 8), name, workflowId)
      return raw
    },
    async findApiKey(raw) {
      const r: any = db.prepare('select user_id, workflow_id from api_keys where key_hash = ?').get(hashKey(raw))
      if (r) db.prepare('update api_keys set last_used_at = current_timestamp where key_hash = ?').run(hashKey(raw))
      return r || null
    },
    async saveRun(r) {
      const info = db.prepare('insert into workflow_runs (workflow_id, user_id, status, input_prompt, results, final_image_url, final_html, duration_ms) values (?,?,?,?,?,?,?,?)')
        .run(r.workflow_id, r.user_id, r.status, r.input_prompt ?? null, JSON.stringify(r.results), r.final_image_url ?? null, r.final_html ?? null, r.duration_ms)
      db.prepare('update workflows set runs = runs + 1 where id = ?').run(r.workflow_id)
      return String(info.lastInsertRowid)
    },
    async listRuns(userId, workflowId) {
      const rows = workflowId
        ? db.prepare('select id, workflow_id, status, input_prompt, final_image_url, duration_ms, created_at from workflow_runs where user_id = ? and workflow_id = ? order by id desc limit 50').all(userId, workflowId)
        : db.prepare('select id, workflow_id, status, input_prompt, final_image_url, duration_ms, created_at from workflow_runs where user_id = ? order by id desc limit 50').all(userId)
      return rows as any[]
    }
  }
  return self
}

// Shopify fulfillment and buyer sessions are implemented for SQLite only (hosting option B: one Fly machine + volume).
const unsupported = async (): Promise<never> => { throw new Error('Shopify credits/buyer login need the SQLite store (unset SUPABASE_URL)') }

function supabaseStore(): Store {
  const sb = supabaseAdmin!
  const must = async <T>(p: PromiseLike<{ data: T; error: any }>): Promise<T> => {
    const { data, error } = await p
    if (error) throw new Error(error.message)
    return data
  }
  const self: Store = {
    kind: 'supabase',
    async ensureUser(id, email) {
      await sb.from('users').upsert({ id, credits: DEFAULT_CREDITS }, { onConflict: 'id', ignoreDuplicates: true })
      if (email) await sb.from('users').update({ email: normEmail(email) }).eq('id', id)
      return (await self.getUser(id))!
    },
    async refundCredit(id) { await sb.rpc('refund_credit', { uid: id }) },
    async getUserByEmail(email) { return await must(sb.from('users').select('*').eq('email', normEmail(email)).limit(1).maybeSingle() as any) },
    async linkEmail(id, email) { await sb.from('users').update({ email: normEmail(email) }).eq('id', id); return (await self.getUser(id))! },
    markEvent: unsupported, grantOrder: unsupported, revokeOrder: unsupported, getGrant: unsupported,
    saveLoginCode: unsupported, checkLoginCode: unsupported, createSession: unsupported, getSession: unsupported,
    async getUser(id) { return await must(sb.from('users').select('*').eq('id', id).maybeSingle() as any) },
    async setStripeCustomer(id, c) { await must(sb.from('users').update({ stripe_customer_id: c }).eq('id', id) as any) },
    async consumeCredit(id) {
      const { data } = await sb.rpc('consume_credit', { uid: id })
      return data === true
    },
    async upsertWorkflow(w) {
      return await must(sb.from('workflows').upsert({ ...w, updated_at: new Date().toISOString() }).select().single() as any)
    },
    async getWorkflow(id) { return await must(sb.from('workflows').select('*').eq('id', id).maybeSingle() as any) },
    async listWorkflows(userId) {
      return await must(sb.from('workflows').select('*').eq('user_id', userId).order('updated_at', { ascending: false }) as any)
    },
    async markDeployed(id, url) { await must(sb.from('workflows').update({ is_deployed: true, deploy_url: url }).eq('id', id) as any) },
    async createApiKey(userId, workflowId, name) {
      const raw = newKey()
      await must(sb.from('api_keys').insert({ user_id: userId, workflow_id: workflowId, name, key_hash: hashKey(raw), key_prefix: raw.slice(0, 8) }) as any)
      return raw
    },
    async findApiKey(raw) {
      return await must(sb.from('api_keys').select('user_id, workflow_id').eq('key_hash', hashKey(raw)).maybeSingle() as any)
    },
    async saveRun(r) {
      const row: any = await must(sb.from('workflow_runs').insert(r).select('id').single() as any)
      await sb.rpc('increment_workflow_runs', { wf_id: r.workflow_id })
      return String(row.id)
    },
    async listRuns(userId, workflowId) {
      let q = sb.from('workflow_runs').select('id, workflow_id, status, input_prompt, final_image_url, duration_ms, created_at').eq('user_id', userId)
      if (workflowId) q = q.eq('workflow_id', workflowId)
      return await must(q.order('created_at', { ascending: false }).limit(50) as any)
    }
  }
  return self
}

export async function createStore(): Promise<Store> {
  return supabaseAdmin ? supabaseStore() : sqliteStore()
}
