# Deploy

Copy `.env.example` to `.env` and fill in what you need. Nothing is required to run the explicitly labeled offline mode locally.

## Local

    npm install --legacy-peer-deps
    npm run models:configure # optional: select already-installed local text/tool + vision models
    npm run models:test     # real synthetic inference checks, not private account tests
    npm run dev:all          # UI :5173, API :3001
    npm run test:workflow    # needs the API running

## Docker

    docker compose up --build      # http://localhost:3001 (UI + API), data in the nodular-data volume

## Fly.io

    fly launch --no-deploy --copy-config
    fly volumes create nodular_data --size 3
    fly secrets set GROQ_API_KEY=... HF_TOKEN=... PUBLIC_URL=https://<app>.fly.dev
    fly deploy --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_...

SQLite lives on the volume, so run a single machine and scheduler. Supabase replaces
only the workflow store; it does not migrate agent/automation/integration state.
Several application machines need a deliberate shared-state/locking design.

## Railway

Create a service from this repo (it uses the Dockerfile), add a volume mounted at `/data`, and set the same variables.

## Supabase (optional, replaces workflow-store SQLite only)

Run `supabase/schema.sql` in the SQL editor, then set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`.
The server uses the service key, so keep it secret.
Agent state remains in `DATA_DIR/agent.db`.

## Using a deployed workflow

Click **Deploy API**. The key is returned once (and copied to the clipboard):

    curl -X POST $PUBLIC_URL/api/workflows/<id>/run -H "Content-Type: application/json" -H "x-api-key: nk_..." -d '{"prompt":"your idea"}'

Each run costs one credit (`FREE_CREDITS` per user). With Stripe configured, successful runs are also reported to the meter named by `STRIPE_METER_EVENT_NAME`.

## Agents on your VPS

Run Ollama on a VPS (`ollama serve`, pull a model with tool support), set `OLLAMA_HOST` (and `OLLAMA_BASIC_AUTH` if behind a proxy), optionally `GROQ_API_KEY` as fallback. Mount a persistent volume at `DATA_DIR` so `agent.db` survives restarts. `config/` ships in the image.

Set `IDEA_MODEL` for structured drafting and an exact vision-capable
`IDEA_VISION_MODEL=provider:model` for image evidence. Restart after settings
change. In Docker, `127.0.0.1` means the container, not the host; use a reachable
model endpoint (for example `host.docker.internal` on Docker Desktop).

## Browser, capture and media

Use HTTPS outside localhost for the browser's user-controlled screen picker.
Iframe refusal is not bypassed; users open the site in their own tab, capture a
chosen frame, redact locally and separately consent to model analysis.

Mega creates native PNG text cards, draft combinations and HTML without extra
media services. MP4 rendering needs a separately approved exact action and actual
HyperFrames/Chrome/FFmpeg prerequisites. Whisper needs real local executable and
model paths. The Docker image does not install these optional host dependencies.
Never report an HTML draft as video or a narration script as synthesized audio.

Before public exposure configure authentication, restricted CORS and private
model endpoints. `/api` is open local-user mode without Clerk. Existing
`/outputs` files are public-by-URL; protect them separately if needed.
