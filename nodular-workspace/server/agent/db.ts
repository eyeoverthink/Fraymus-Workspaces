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
create table if not exists agent_action_log(id integer primary key autoincrement, user_id text not null, agent_id text not null, run_id text, thread_id text, action text not null, status text not null, created_at integer not null);
create index if not exists idx_action_user on agent_action_log(user_id, id desc);
create table if not exists time_audit_entries(id integer primary key autoincrement, user_id text not null, started_at integer not null, activity text not null, energy integer not null, value_usd real not null, complaint text not null default '', created_at integer not null, unique(user_id, started_at));
create index if not exists idx_time_audit_user on time_audit_entries(user_id, started_at desc);
create table if not exists weekend_tasks(id text not null, user_id text not null, weekend text not null, title text not null, done integer not null default 0, notes text not null default '', updated_at integer not null, primary key(user_id,weekend,id));
create table if not exists idea_lab_settings(user_id text primary key, settings_json text not null, updated_at integer not null);
create table if not exists idea_reviews(user_id text not null, report_id text not null, idea_index integer not null, review_json text not null, updated_at integer not null, primary key(user_id,report_id,idea_index));
create table if not exists trend_scans(id text primary key, user_id text not null, scan_json text not null, created_at integer not null);
create index if not exists idx_trend_scans_user on trend_scans(user_id,created_at desc);
create table if not exists custom_agents(id text primary key, user_id text, json text, created_at integer);
create table if not exists automations(id text primary key, user_id text not null, name text not null, cron text not null, kind text not null, agent_id text, tool text, payload text, enabled integer default 1, last_minute integer, created_at integer);
create table if not exists automation_runs(id text primary key, automation_id text not null, user_id text, trigger text, status text, thread_id text, output text, error text, started_at integer, finished_at integer);
create index if not exists idx_arun on automation_runs(automation_id, started_at);
create table if not exists access_tokens(id text primary key, user_id text not null, name text, kind text, client_id text, hash text unique not null, scopes text not null, expires_at integer, created_at integer, last_used integer);
create table if not exists oauth_clients(client_id text primary key, user_id text not null, name text, secret_hash text not null, scopes text not null, created_at integer);
create table if not exists google_connections(user_id text primary key, email text not null, token_cipher text not null, updated_at integer not null);
create table if not exists google_oauth_states(state_hash text primary key, user_id text not null, verifier_cipher text not null, expires_at integer not null);
create table if not exists notion_connections(user_id text primary key, workspace_name text not null, bot_name text not null, token_cipher text not null, updated_at integer not null);
create table if not exists apollo_connections(user_id text primary key, api_key_cipher text not null, acting_user text not null, updated_at integer not null);
create table if not exists stripe_connections(user_id text primary key, secret_cipher text not null, account_id text not null, account_label text not null, livemode integer not null default 0, updated_at integer not null);
create table if not exists canva_connections(user_id text primary key, token_cipher text not null, expires_at integer not null, updated_at integer not null);
create table if not exists canva_oauth_states(state_hash text primary key, user_id text not null, verifier_cipher text not null, expires_at integer not null);
create table if not exists linkedin_connections(user_id text primary key, token_cipher text not null, person_urn text not null, display_name text, expires_at integer not null, updated_at integer not null);
create table if not exists linkedin_oauth_states(state_hash text primary key, user_id text not null, expires_at integer not null);
create table if not exists idea_reports(id text primary key, user_id text not null, audience text not null, report_json text not null, created_at integer not null);
create index if not exists idx_idea_reports_user on idea_reports(user_id,created_at desc);
create table if not exists mega_packs(id text primary key, user_id text not null, pack_json text not null, created_at integer not null);
create index if not exists idx_mega_packs_user on mega_packs(user_id,created_at desc);
`)

export const now = () => Date.now()
