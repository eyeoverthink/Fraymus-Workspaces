
# Supabase Setup - 1 Minute

1. Create project at https://supabase.com - free tier
2. Go to SQL Editor, paste schema.sql and Run
3. Go to Storage, create bucket 'workflow-outputs' public
4. Copy URL and service_role key to .env:
   SUPABASE_URL=https://xxx.supabase.co
   SUPABASE_SERVICE_KEY=eyJ...
   SUPABASE_ANON_KEY=eyJ...

5. For local dev: npx supabase start (optional)

Tables: users, workflows, workflow_runs, api_keys
Workflows store nodes+edges JSONB - your IP is in nodes[0].data.prompt
