# 1. Supabase (1 min)
# Create project at supabase.com → SQL Editor → paste supabase/schema.sql → Storage → create bucket workflow-outputs public

# 2. Docker local test
docker-compose up --build
# or
docker build -t nodular . && docker run -p 3001:3001 --env-file .env nodular

# 3. Railway (free)
railway login && railway init && railway up
# Add env in dashboard: GROQ_API_KEY, HF_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY, CLERK_*

# 4. Verify
curl http://localhost:3001/health
# { status: 'ok', freeStack: true, nodes: [...] }