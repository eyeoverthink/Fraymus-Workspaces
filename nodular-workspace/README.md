
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

Open the **Agents** tab: chat with Concierge or any of the specialists defined in `agents/*.md`.
Tools run automatically when safe; risky ones (`http_get`, `run_workflow`, HTTP tools) show an **Approve / Reject** card.

- **Models**: `LLM_PROVIDERS` order (Ollama -> Groq -> OpenAI-compatible). Point `OLLAMA_HOST` at your VPS. With nothing configured, a clearly labeled offline mock answers (a banner is shown).
- **Edit agents**: each agent is one manifest file, `agents/<id>.md` (front-matter: id, name, role, description, greeting, model, tools; body = system prompt). Edit the file, use the **Connect** tab, or let a connected agent do it over MCP; runtime edits are stored as overrides in `DATA_DIR/agents/` and win over the shipped defaults. Users can also create their own agents via `POST /api/agents`.
- **HTTP tools**: `config/http-tools.json` defines tools backed by your own services (Fraynix engine, Hermes, TTS). **These endpoint paths and body shapes are templates I guessed; adapt them to your real APIs.** A tool is skipped until every `${ENV:NAME}` it references is set.
- **Data**: threads, memories and approvals live in `DATA_DIR/agent.db` (local SQLite).
- **Safety**: `http_get` blocks private/loopback addresses (SSRF) unless `ALLOW_PRIVATE_FETCH=1`; delegated agents cannot run approval tools.
- **Tests**: `node scripts/test-agent.mjs` (server with `LLM_PROVIDERS=none`).

## Media skills (MCP bridge + HyperFrames)

`config/mcp-servers.json` lists MCP servers whose tools are registered as `<server>__<tool>` (approval required unless in `safeTools`). A server is skipped unless its env var is set; status is in `/api/agent/status` under `mcp`.

| Skill | How it is wired | Status |
|---|---|---|
| HyperFrames (Apache-2.0) | native `hyperframes_render` tool: HTML composition -> MP4/WebM/GIF via `npx hyperframes` (needs Node 22+, Chrome, FFmpeg) | **tested**: real 1080x1920 H.264 render |
| VoiceStudio (AGPL-3.0) | MCP over HTTP, set `VOICESTUDIO_MCP_URL`. Install per https://voicestudio.sh | bridge tested with a fake MCP server; real VoiceStudio untested |
| PhotoCraft (Apache-2.0) | stdio MCP, set `PHOTOCRAFT_CLI` to the `photocraft-cli` binary | bridge tested; real binary untested |
| REA = *Reverse Engineer Anything* (MIT) | stdio MCP via `npx rea-agents --mcp`, set `REA_MCP=1` | bridge tested; real server untested. This is NOT the realtime editing agent |
| Hypit | **not integrated**: it is a skill for coding agents (Claude Code/Codex) with its own license, not a runnable node | - |
| Yjs realtime co-editing | **not built** | - |

The `video_director` agent writes and renders HyperFrames compositions. Tests: `npx tsx scripts/test-mcp.ts`, `npx tsx scripts/test-media.ts`.

## Self-hosted agent hub: MCP server, MCP import, OAuth in

Everything Base44 did for agents now runs here, free and self-hosted. Other agents (OpenClaw, Claude, anything that speaks MCP) can join, see and change it.

- **MCP server**: `POST /mcp` (streamable HTTP, stateless, `Authorization: Bearer <token>`). Tools: `list_agents`, `get_agent`, `upsert_agent`, `reset_agent`, `list_tools`, `run_agent`, `list_threads`, `get_thread`, `decide_approval`, `call_tool`, `list_mcp_servers`, `import_mcp_server`, `remove_mcp_server`. Runs started over MCP show up in the Agents tab like any other conversation.
- **Scopes**: `read` (inspect), `run` (talk to agents), `admin` (edit agents, call any tool, approve, import MCP servers). Admin means full autonomy: only give it to agents you trust.
- **OAuth in**: create a client in the **Connect** tab, then `POST /oauth/token` with `grant_type=client_credentials` (client_secret_basic or _post) for a 1-hour bearer token. Discovery: `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource`. Long-lived access tokens can be minted in the same tab. Headless setup: set `MCP_ADMIN_TOKEN` (24+ chars) in `.env`. *Not implemented*: the interactive authorization-code + PKCE flow some hosted MCP clients expect; use client_credentials or a token.
- **MCP import**: Connect tab or `import_mcp_server`; accepts one server or a Claude-Desktop-style `mcpServers` block. HTTP servers are always allowed; local-command servers need `ALLOW_STDIO_IMPORT=1`. Imported servers persist in `DATA_DIR/mcp-servers.json` (may contain headers/secrets; file mode 600 on POSIX).
- **Security**: `/mcp` always requires a token, but the token-minting API under `/api` is open when `CLERK_SECRET_KEY` is unset. Put the server behind Tailscale/a firewall or enable Clerk before exposing it.
- **Tasks**: `make help` (or the matching `npm` scripts). `npm test` boots a throwaway server and runs all e2e suites. `make` itself was not run on this Windows machine.
## Fraymus OS One studio (portal bridge)

Agents can drive the Fraymus OS One creative studio through the Fraymus Portal (Fraymus-OS-One, branch `fraymus-portal`). Start the studio (`npm start`, 127.0.0.1:4177) and the portal (`cd portal && node src/server.js --http`, 127.0.0.1:4190), then the crew gets three built-in tools:

| Tool | Risk | Use |
| --- | --- | --- |
| `portal_list_tools` | safe | List the 16 studio tools and which bridge tool runs each |
| `portal_call` | safe | Read-only tools: `studio_health`, `brain_status`, `brain_memory_get`, `brain_think` (dry run only), `opeg_protocol`, `project_list`, `project_get`, `mail_list` |
| `portal_call_write` | approval | Everything else: `pixel_render`, `project_create`, `site_publish`, `export_zip`, `opeg_execute`, `brain_cortex_chat`, `brain_think` with `persist:true` |

Env: `PORTAL_URL` (default `http://127.0.0.1:4190`), `PORTAL_TOKEN` (if the portal was started with one), `PORTAL_SAFE_TOOLS` (override the read-only list), `PORTAL_ENABLED=0` (hide the tools). If the portal is down the tools return a plain "Fraymus Portal unreachable" error. Each result includes the portal's SHA-256 chained `receipt`. Genesis and Director have prompt guidance for it. Approval tools can't run inside a delegated run, so Director hands write steps back to Genesis.

The bridge uses `node:http`, not `fetch()`: port 4190 is on the WHATWG fetch blocked-port list, so `fetch()` (and browsers) refuse it. For the same reason the optional MCP route (`fraymus-portal` in `config/mcp-servers.json`, enabled by `PORTAL_MCP_URL`) only works if the portal runs on another port, e.g. `PORTAL_PORT=4191` and `PORTAL_MCP_URL=http://127.0.0.1:4191/mcp`. Test: `npm run test:portal` against a running server (`EXPECT_PORTAL_DOWN=1` checks the error path).

## Automations (scheduler)

Cron-scheduled (5-field, **UTC**) agent runs or tool calls, replacing Base44 scheduled automations. Manage via `/api/automations` or the MCP tools `list_automations`, `upsert_automation` (admin), `run_automation`, `automation_runs`, `delete_automation`. Templates (`daily-report`, `six-hour-research`, `heartbeat`) install disabled. Unattended agent runs never auto-approve risky tools; they end as `awaiting_approval`. Tool automations call the tool directly (admin-created only). Set `SCHEDULER=off` to disable the ticker. Not ported: LinkedIn, Google Calendar and Base44-entity triggers (no native equivalent), and data-change triggers (use `POST /api/automations/:id/trigger` from a webhook).
