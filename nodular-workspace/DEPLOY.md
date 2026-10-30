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

## Shopify credit packs on Fly.io (option B)

One Fly machine runs everything: API, `/webhooks/shopify`, the buyer page at `/enhance`, and SQLite on the `nodular_data` volume.

Flow: Shopify `orders/paid` → HMAC + shop-domain check → 25 credits per pack unit (product `8843401527492`) to the buyer's email,
once per order id (and once per `X-Shopify-Webhook-Id`). `refunds/create` takes back 25 per refunded pack unit; `orders/cancelled` takes back
whatever is left of that order. Credits already spent can't be clawed back; the shortfall is logged.
Buyers open `/enhance`, enter the purchase email, get a 6-digit code by email (10 min, 5 tries, single use), and get a 7-day session.
Each run costs 1 credit and is refunded if any step fails. With `BUYER_PIPELINE_STRICT=1` (the default) a missing model key fails the run instead of returning a placeholder.
If a Clerk user later signs in with the same verified email, the buyer balance merges into that account.

    fly launch --no-deploy --copy-config          # keep fly.toml (app name, region)
    fly volumes create nodular_data --size 3 --region iad
    fly secrets set \
      SHOPIFY_WEBHOOK_SECRET=... \
      HF_TOKEN=hf_... \
      OPENAI_BASE_URL=https://router.hostinger.com/v1 OPENAI_API_KEY=... OPENAI_MODEL=gpt-5.6-luna \
      RESEND_API_KEY=re_... MAIL_FROM="FRAYMUS <codes@yourdomain.com>" \
      PUBLIC_URL=https://<app>.fly.dev
    # optional: GROQ_API_KEY (instead of the router), REPLICATE_API_TOKEN (+ REQUIRE_AI_UPSCALE=1 for a real AI upscale),
    #           CLERK_SECRET_KEY / VITE_CLERK_PUBLISHABLE_KEY (locks the workspace UI to signed-in users), MCP_ADMIN_TOKEN
    fly deploy
    curl https://<app>.fly.dev/health

Then in Shopify Admin → Settings → Notifications → Webhooks, create JSON webhooks for `orders/paid`, `refunds/create` and `orders/cancelled`
pointing at `https://<app>.fly.dev/webhooks/shopify`, and copy the signing secret shown there into `SHOPIFY_WEBHOOK_SECRET`
(if you create them from a custom app instead, the secret is that app's client secret).
Test with a 100%-off discount code before announcing: one purchase → `/enhance` shows 25 → one run → 24 and a 4096px transparent PNG.

Leave the workspace UI locked: without `CLERK_SECRET_KEY` every `/api/*` route is open to anyone who finds the URL, and `/api/me` credits are shared by everyone as the `local` user.

Local tests: `npm run test:shopify` (signed fake webhooks, idempotency, refunds/cancel, login, strict-fail refund, credit-spend run to 4096px PNG).
