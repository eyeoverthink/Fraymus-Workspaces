
-- NODULAR WORKSPACE - Supabase Schema - FULL
-- Run in Supabase SQL editor: https://supabase.com/dashboard/project/_/sql

-- Enable UUID
create extension if not exists "uuid-ossp";

-- USERS - synced from Clerk via webhook (or Supabase Auth)
create table public.users (
  id text primary key, -- Clerk user ID
  email text,
  created_at timestamp with time zone default now(),
  plan text default 'free' check (plan in ('free','pro','enterprise')),
  credits integer default 100, -- free runs
  stripe_customer_id text
);

-- WORKFLOWS - DAG + system prompts = your IP
create table public.workflows (
  id text primary key, -- slug like 'ugc-mirror-selfie-v1'
  user_id text references public.users(id) on delete cascade,
  name text not null,
  description text,
  nodes jsonb not null, -- ReactFlow nodes with system prompts
  edges jsonb not null,
  is_public boolean default false,
  is_deployed boolean default false,
  deploy_url text,
  runs integer default 0,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- WORKFLOW RUNS - execution logs + outputs
create table public.workflow_runs (
  id uuid primary key default uuid_generate_v4(),
  workflow_id text references public.workflows(id) on delete cascade,
  user_id text references public.users(id) on delete cascade,
  status text check (status in ('running','success','failed')) default 'running',
  input_prompt text,
  nodes_snapshot jsonb, -- nodes at time of run
  results jsonb, -- ExecutionResult[]
  final_image_url text, -- stored in Supabase Storage
  final_html text,
  duration_ms integer,
  cost_usd numeric default 0, -- free stack = 0, but track for billing
  created_at timestamp with time zone default now()
);

-- API KEYS - for deployed endpoints
create table public.api_keys (
  id uuid primary key default uuid_generate_v4(),
  user_id text references public.users(id) on delete cascade,
  key_hash text not null, -- sha256 of key
  key_prefix text not null, -- first 8 chars for display
  name text,
  workflow_id text references public.workflows(id),
  last_used_at timestamp with time zone,
  created_at timestamp with time zone default now()
);

-- STORAGE BUCKET for images
insert into storage.buckets (id, name, public) values ('workflow-outputs', 'workflow-outputs', true)
on conflict (id) do nothing;

-- RLS Policies
alter table public.workflows enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.users enable row level security;

create policy "Users can manage own workflows" on public.workflows
  for all using (user_id = auth.uid()::text);

create policy "Users can view own runs" on public.workflow_runs
  for all using (user_id = auth.uid()::text);

-- Function to increment runs
create or replace function increment_workflow_runs(wf_id text)
returns void as $$
  update public.workflows set runs = runs + 1, updated_at = now() where id = wf_id;
$$ language sql;

-- Indexes
create index idx_workflows_user on public.workflows(user_id);
create index idx_runs_workflow on public.workflow_runs(workflow_id);
create index idx_runs_user on public.workflow_runs(user_id);

-- Atomically spend one run credit; returns false when out of credits
create or replace function consume_credit(uid text)
returns boolean as $$
  with u as (update public.users set credits = credits - 1 where id = uid and credits > 0 returning 1)
  select exists(select 1 from u);
$$ language sql;

-- Refund one credit after a failed run
create or replace function refund_credit(uid text)
returns void as $$
  update public.users set credits = credits + 1 where id = uid;
$$ language sql;
