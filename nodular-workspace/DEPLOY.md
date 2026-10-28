# Deploy

Copy `.env.example` to `.env` and fill in what you need. Nothing is required to run locally.

## Local

    npm install --legacy-peer-deps
    npm run dev:all          # UI :5173, API :3001
    npm run test:workflow    # needs the API running

## Docker

    docker compose up --build      # http://localhost:3001 (UI + API), data in the nodular-data volume

## Fly.io

    fly launch --no-deploy --copy-config
    fly volumes create nodular_data --size 3
    fly secrets set GROQ_API_KEY=... HF_TOKEN=... PUBLIC_URL=https://<app>.fly.dev
    fly deploy --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_...

SQLite lives on the volume, so run a single machine. For several machines use Supabase instead.

## Railway

Create a service from this repo (it uses the Dockerfile), add a volume mounted at `/data`, and set the same variables.

## Supabase (optional, replaces SQLite)

Run `supabase/schema.sql` in the SQL editor, then set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`.
The server uses the service key, so keep it secret.

## Using a deployed workflow

Click **Deploy API**. The key is returned once (and copied to the clipboard):

    curl -X POST $PUBLIC_URL/api/workflows/<id>/run -H "Content-Type: application/json" -H "x-api-key: nk_..." -d '{"prompt":"your idea"}'

Each run costs one credit (`FREE_CREDITS` per user). With Stripe configured, successful runs are also reported to the meter named by `STRIPE_METER_EVENT_NAME`.

## Agents on your VPS

Run Ollama on a VPS (`ollama serve`, pull a model with tool support), set `OLLAMA_HOST` (and `OLLAMA_BASIC_AUTH` if behind a proxy), optionally `GROQ_API_KEY` as fallback. Mount a persistent volume at `DATA_DIR` so `agent.db` survives restarts. `config/` ships in the image.
