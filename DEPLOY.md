
# DEPLOY IN ONE SHOT - For Codex/Devin Dumb Agent

## Option 1: Docker (Local prod test)

docker-compose up --build
# Frontend: http://localhost:5173 (vite preview) or http://localhost:3001 serves static
# Server: http://localhost:3001/health

## Option 2: Railway (Recommended free)

1. Install Railway CLI: npm i -g @railway/cli
2. railway login
3. railway init
4. Add env vars in Railway dashboard: GROQ_API_KEY, HF_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY, CLERK_*
5. railway up

## Option 3: Fly.io

fly launch
fly secrets set GROQ_API_KEY=... HF_TOKEN=... SUPABASE_URL=... etc
fly deploy

## Option 4: Vercel + Separate Server

- Frontend: vercel --prod (vite)
- Server: deploy server/ as separate Node service on Railway

## Supabase Setup (1 min)

1. https://supabase.com -> New project free
2. SQL Editor -> paste supabase/schema.sql -> Run
3. Storage -> Create bucket workflow-outputs public
4. Settings -> API -> copy URL, anon, service_role to .env

## Clerk Setup (2 min, optional)

1. https://clerk.com -> New app free
2. Copy publishable + secret to .env
3. If no Clerk keys, app runs open with banner - no crash

## Verify Deploy

curl http://localhost:3001/health
# Should return { status: 'ok', freeStack: true }

curl -X POST http://localhost:3001/api/workflows/test/run -H "Content-Type: application/json" -d '{"prompt":"mirror selfie"}'

## Production Checklist for Dumb Agent

- [ ] npm run build succeeds
- [ ] docker build . succeeds
- [ ] /api/flux works with HF_TOKEN, else returns placeholder SVG (no crash)
- [ ] /api/remover returns transparent PNG
- [ ] /api/upscaler returns 4x image with headers X-Upscale-To
- [ ] /api/rea/suggest broadcasts via Socket.io
- [ ] Supabase saves workflows and runs
- [ ] Clerk auth shows Sign In when keys set, else shows orange banner and works open
- [ ] Deploy endpoint returns curl that works

If any fails, fix in server/index.ts - full implementations, no stubs.
