import { mkdirSync } from 'node:fs'

const dir = process.env.DATA_DIR || './data'
mkdirSync(dir, { recursive: true })
const { DatabaseSync } = await import('node:sqlite')
export const db = new DatabaseSync(`${dir}/agent.db`)

db.exec(`
create table if not exists threads(id text primary key, user_id text not null, agent_id text not null, title text, created_at integer, updated_at integer);
create table if not exists messages(id integer primary key autoincrement, thread_id text not null, run_id text, role text not null, content text, tool_calls text, tool_call_id text, name text, created_at integer);
create index if not exists idx_msg_thread on messages(thread_id, id);
create table if not exists runs(id text primary key, thread_id text not null, user_id text, status text, error text, provider text, model text, steps integer default 0, created_at integer, updated_at integer);
create table if not exists approvals(id text primary key, run_id text, thread_id text, user_id text, call_id text, tool text, args text, status text, created_at integer, decided_at integer);
create table if not exists memories(id integer primary key autoincrement, user_id text, agent_id text, text text, tags text, created_at integer);
create index if not exists idx_mem_user on memories(user_id, id);
create table if not exists custom_agents(id text primary key, user_id text, json text, created_at integer);
create table if not exists automations(id text primary key, user_id text not null, name text not null, cron text not null, kind text not null, agent_id text, tool text, payload text, enabled integer default 1, last_minute integer, created_at integer);
create table if not exists automation_runs(id text primary key, automation_id text not null, user_id text, trigger text, status text, thread_id text, output text, error text, started_at integer, finished_at integer);
create index if not exists idx_arun on automation_runs(automation_id, started_at);
create table if not exists access_tokens(id text primary key, user_id text not null, name text, kind text, client_id text, hash text unique not null, scopes text not null, expires_at integer, created_at integer, last_used integer);
create table if not exists oauth_clients(client_id text primary key, user_id text not null, name text, secret_hash text not null, scopes text not null, created_at integer);
`)

export const now = () => Date.now()
