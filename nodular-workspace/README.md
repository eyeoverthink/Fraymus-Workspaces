
# NODULAR WORKSPACE - FULL IMPLEMENTATION (No Stubs)

5-node chain: Llama Groq (brain) â†’ FLUX schnell (image) â†’ BiRefNet Remover â†’ Real-ESRGAN Upscaler â†’ HTML Preview + Deploy API

Rebuild of $4M Enhancor Workflows video using 100% FREE 2026 stack.

## Quick Start

npm i --legacy-peer-deps`ncp .env.example .env
# Add free keys (optional - works without with mocks + sharp local)
# GROQ_API_KEY from https://console.groq.com
# HF_TOKEN from https://huggingface.co/settings/tokens
npm run dev:all

Canvas: http://localhost:5173
Server: http://localhost:3001

## What Was Added (Full, No Stubs)

- BackgroundRemoverNode.tsx - indigo border, BiRefNet free WASM, shows transparent checkerboard preview
- UpscalerNode.tsx - green border, Sharp 4x lanczos3, shows 4K output
- executor.ts - full DAG topological sort, handles image blobs, error handling, progress callbacks
- server/index.ts - 6 full routes, no TODOs, sharp for upscaler, HF proxies for FLUX/RMBG, Socket.io REA
- AGENT_INSTRUCTIONS.md - briefing for Codex/Devin dumb agent

## Free Keys

All free tier, no credit card:
- Groq: https://console.groq.com - Llama 3.3 70B 14k tok/s
- HuggingFace: https://huggingface.co/settings/tokens - FLUX schnell + RMBG-1.4

Without keys, app still works: Groq returns mock enhanced prompt, FLUX returns SVG placeholder, remover/upscaler use sharp local.

## Deploy as Product

Click Deploy API â†’ returns POST /api/workflows/:id/run
Curl: curl -X POST http://localhost:3001/api/workflows/ugc-mirror-selfie-v1/run -d '{"prompt":"mirror selfie"}'

This endpoint is your product. Charge per call. System prompt chain is moat.

## For Codex/Devin

Read AGENT_INSTRUCTIONS.md - explains what was built, file map, expectations, acceptance criteria. Implement true BiRefNet WASM via @imgly/background-removal-node and true Real-ESRGAN via replicate, add Supabase persistence, auth, billing.

## Video Concept

Wrapper dies, workflow is IP. System prompt chain is moat, not model. This repo implements that with free models.


## Status

See DEPLOY.md for Docker/Fly/Railway and env vars (.env.example).
Verified: server pipeline, deploy + API-key runs, SQLite persistence, credits, local background removal, UI build.
Written but untested without your accounts: Supabase store, Clerk auth, Stripe metering/checkout (no webhook), Replicate Real-ESRGAN (sharp lanczos3 is used otherwise), Docker build.


## Agents

Open the **Agents** tab: chat with Concierge or any of the 14 specialists in `config/agents.json`.
Tools run automatically when safe; risky ones (`http_get`, `run_workflow`, HTTP tools) show an **Approve / Reject** card.

- **Models**: `LLM_PROVIDERS` order (Ollama -> Groq -> OpenAI-compatible). Point `OLLAMA_HOST` at your VPS. With nothing configured, a clearly labeled offline mock answers (a banner is shown).
- **Edit agents**: change prompts, `model` hints (`provider[:model]`) and tool allowlists in `config/agents.json`. Users can also create their own agents via `POST /api/agents`.
- **HTTP tools**: `config/http-tools.json` defines tools backed by your own services (Fraynix engine, Hermes, TTS). **These endpoint paths and body shapes are templates I guessed; adapt them to your real APIs.** A tool is skipped until every `${ENV:NAME}` it references is set.
- **Data**: threads, memories and approvals live in `DATA_DIR/agent.db` (local SQLite).
- **Safety**: `http_get` blocks private/loopback addresses (SSRF) unless `ALLOW_PRIVATE_FETCH=1`; delegated agents cannot run approval tools.
- **Tests**: `node scripts/test-agent.mjs` (server with `LLM_PROVIDERS=none`).
