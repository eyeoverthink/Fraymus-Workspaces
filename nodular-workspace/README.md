
# NODULAR WORKSPACE - FULL IMPLEMENTATION (No Stubs)

5-node chain: Llama Groq (brain) â†’ FLUX schnell (image) â†’ BiRefNet Remover â†’ Real-ESRGAN Upscaler â†’ HTML Preview + Deploy API

Rebuild of $4M Enhancor Workflows video using 100% FREE 2026 stack.

## Quick Start

Node.js 22 or newer is required. The server imports `node:sqlite` (there is no npm package for that), and `package.json` sets `"engines": { "node": ">=22" }`. Node 20 and older fail as soon as the store opens.

```
npm i --legacy-peer-deps
cp .env.example .env
```

Keys are optional. Without them the app uses mocks and local sharp.

- `GROQ_API_KEY` from https://console.groq.com
- `HF_TOKEN` from https://huggingface.co/settings/tokens

```
npm run dev:all
```

- Canvas: http://localhost:5173
- Server: http://localhost:3001
- Health: `curl http://localhost:3001/health` returns `{"ok":true,"store":"sqlite"}` with the default SQLite store. `store` is `"supabase"` when `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are set.

The API listens on `0.0.0.0`. Leaving `CLERK_SECRET_KEY` unset keeps auth open so local dev works without Clerk, and that includes the MCP token-minting API. Do not publish port 3001 until Clerk is configured or the host is on a private network. See Security below.

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
Tools run automatically when safe; risky ones (`http_get`, `run_workflow`, `hyperframes_render`, HTTP tools, imported MCP tools) show an **Approve / Reject** card. The app owner does not see that card. Their own runs, and agents they delegate to, execute those tools immediately.

- **Models**: `LLM_PROVIDERS` order (Ollama -> Groq -> OpenAI-compatible). Point `OLLAMA_HOST` at your VPS. With nothing configured, a clearly labeled offline mock answers (a banner is shown).
- **Edit agents**: each agent is one manifest file, `agents/<id>.md` (front-matter: id, name, role, description, greeting, model, tools; body = system prompt). Edit the file, use the **Connect** tab, or let a connected agent do it over MCP; runtime edits are stored as overrides in `DATA_DIR/agents/` and win over the shipped defaults. Users can also create their own agents via `POST /api/agents`.
- **HTTP tools**: `config/http-tools.json` defines tools backed by your own services (Fraynix engine, Hermes, TTS). **These endpoint paths and body shapes are templates I guessed; adapt them to your real APIs.** A tool is skipped until every `${ENV:NAME}` it references is set.
- **Data**: threads, memories and approvals live in `DATA_DIR/agent.db` (local SQLite).
- **Safety**: `http_get` blocks private/loopback addresses (SSRF) unless `ALLOW_PRIVATE_FETCH=1`. Approval-risk tools still ask a person first, including inside a delegated agent, except for the app owner (below). A delegated run that is not the owner's cannot show an approval card, so the tool is refused instead of executed.
- **Owner**: set `OWNER_USER_IDS` or `OWNER_USER_ID` to the signed-in app owner's Clerk user id (JWT `sub`, shaped like `user_...`). `MCP_ADMIN_USER`, when set, is an owner id too. A run authenticated with `MCP_ADMIN_TOKEN` is treated as the owner, and a delegated agent inherits that for the whole run, so `video_director` can call `hyperframes_render` without a prompt. `OWNER_EMAILS` is a comma-separated list of addresses (case-insensitive). A signed-in Clerk user is also an owner when one of those addresses is verified on their Clerk user. `verifyToken` on a default session token exposes `sub` and does not include email, so the server loads the user from the Clerk Backend API (`users.getUser`, `CLERK_SECRET_KEY`) and keeps only addresses whose `verification.status` is `verified`. Results are cached for about a minute. An unverified or missing email never matches, and the open-mode user id `local` is never an email owner. Leave the id and email fields blank and nobody is an owner: approval stays required. With `CLERK_SECRET_KEY` unset, every `/api` caller is the user id `local`, which is not an owner unless you list `local` (doing so approves every open-mode request). Other signed-in users and anonymous requests stay gated. Unattended automations never auto-approve, even when they belong to the owner.
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
- **OAuth in**: create a client in the **Connect** tab, then `POST /oauth/token` with `grant_type=client_credentials` (client_secret_basic or _post) for a 1-hour bearer token. Discovery: `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource`. Long-lived access tokens can be minted in the same tab. Headless setup: set `MCP_ADMIN_TOKEN` (24+ chars) in `.env`. Optional `MCP_ADMIN_USER` is the user id that token acts as, and is an app owner when set. The token itself also marks that run (and agents it delegates to) as the owner even if `MCP_ADMIN_USER` is blank. A personal access token with the `admin` scope is not the owner: its agent runs still ask for approval. *Not implemented*: the interactive authorization-code + PKCE flow some hosted MCP clients expect; use client_credentials or a token.
- **MCP import**: Connect tab or `import_mcp_server`; accepts one server or a Claude-Desktop-style `mcpServers` block. HTTP servers are always allowed; local-command servers need `ALLOW_STDIO_IMPORT=1`. Imported servers persist in `DATA_DIR/mcp-servers.json` (may contain headers/secrets; file mode 600 on POSIX).
- **Security**: The process binds `0.0.0.0` (every interface). When `CLERK_SECRET_KEY` is unset it does not require a signed-in user, which is what `npm run dev:all` and the test suite rely on, so that behavior is unchanged. Open mode also leaves the MCP token-minting API unauthenticated: anyone who can reach the port can create access tokens and OAuth clients. `/mcp` itself still requires `Authorization: Bearer <token>`. Startup prints a warning in this mode. Before any non-local exposure, set `CLERK_SECRET_KEY` (and `VITE_CLERK_PUBLISHABLE_KEY`) or keep the port on Tailscale or a firewall. `MCP_ADMIN_TOKEN`, if set, is a full-admin bearer.
- **Tasks**: `make help` (or the matching `npm` scripts). `npm test` boots a throwaway server and runs all e2e suites. `make` itself was not run on this Windows machine.
## Automations (scheduler)

Cron-scheduled (5-field, **UTC**) agent runs or tool calls, replacing Base44 scheduled automations. Manage via `/api/automations` or the MCP tools `list_automations`, `upsert_automation` (admin), `run_automation`, `automation_runs`, `delete_automation`. Templates (`daily-report`, `six-hour-research`, `heartbeat`) install disabled. Unattended agent runs never auto-approve risky tools, including when the automation belongs to the app owner; they end as `awaiting_approval`. Tool automations call the tool directly (admin-created only). Set `SCHEDULER=off` to disable the ticker. Not ported: LinkedIn, Google Calendar and Base44-entity triggers (no native equivalent), and data-change triggers (use `POST /api/automations/:id/trigger` from a webhook).
