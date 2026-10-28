import { createHash, randomBytes } from 'node:crypto'
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

export interface Store {
  kind: string
  ensureUser(id: string): Promise<User>
  getUser(id: string): Promise<User | null>
  setStripeCustomer(id: string, customerId: string): Promise<void>
  consumeCredit(id: string): Promise<boolean>
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
const DEFAULT_CREDITS = Number(process.env.FREE_CREDITS || 100)
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
  `)
  const toWf = (r: any): WorkflowRow => ({ ...r, nodes: JSON.parse(r.nodes), edges: JSON.parse(r.edges), is_deployed: !!r.is_deployed })
  const self: Store = {
    kind: 'sqlite',
    async ensureUser(id) {
      db.prepare('insert or ignore into users (id) values (?)').run(id)
      return (await self.getUser(id))!
    },
    async getUser(id) { return (db.prepare('select * from users where id = ?').get(id) as any) || null },
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

function supabaseStore(): Store {
  const sb = supabaseAdmin!
  const must = async <T>(p: PromiseLike<{ data: T; error: any }>): Promise<T> => {
    const { data, error } = await p
    if (error) throw new Error(error.message)
    return data
  }
  const self: Store = {
    kind: 'supabase',
    async ensureUser(id) {
      await sb.from('users').upsert({ id, credits: DEFAULT_CREDITS }, { onConflict: 'id', ignoreDuplicates: true })
      return (await self.getUser(id))!
    },
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
