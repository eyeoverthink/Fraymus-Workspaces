
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

`config/mcp-servers.json` lists MCP servers whose tools are registered as `<server>__<tool>`. Imported servers always require per-call approval; a caller cannot declare its own tools safe. The checked-in VoiceStudio config marks only a small, reviewed set of read-only status tools as safe. A server is skipped unless its env var is set; status is in `/api/agent/status` under `mcp`.

| Skill | How it is wired | Status |
|---|---|---|
| HyperFrames (Apache-2.0) | native `hyperframes_render` tool: HTML composition -> MP4/WebM/GIF via `npx hyperframes` (needs Node 22+, Chrome, FFmpeg) | **tested**: real 1080x1920 H.264 render |
| VoiceStudio (AGPL-3.0) | MCP over HTTP, set `VOICESTUDIO_MCP_URL`. Install per https://voicestudio.sh | bridge tested with a fake MCP server; real VoiceStudio untested |
| PhotoCraft (Apache-2.0) | stdio MCP, set `PHOTOCRAFT_CLI` to the `photocraft-cli` binary | bridge tested; real binary untested |
| REA = *Reverse Engineer Anything* (MIT) | stdio MCP via `npx rea-agents --mcp`, set `REA_MCP=1` | bridge tested; real server untested. This is NOT the realtime editing agent |
| Hypit | **not integrated**: it is a skill for coding agents (Claude Code/Codex) with its own license, not a runnable node | - |
| Yjs realtime co-editing | **not built** | - |

The `video_director` agent writes and renders HyperFrames compositions. Tests: `npx tsx scripts/test-mcp.ts`, `npx tsx scripts/test-media.ts`.

### Free fleet skills

The app registers the 15 runnable, no-key fleet entries from the capability inventory as native tools: DuckDuckGo/Hacker News/arXiv search, DuckDuckGo-backed SearXNG compatibility search, limited public username checks, public-source OSINT, npm/PyPI/crates.io metadata, passive security-header checks, Reddit/RSS reads, one-shot feed snapshots, basic page-text extraction, bounded parallel page fetches, arXiv references with a LaTeX starter, local nucleotide statistics, and data-broker opt-out templates. Public fetches use the SSRF-protected `safeFetch`; page extraction does not execute JavaScript, and the parallel fetcher is not a shell. Header checks only make a GET request, require an ownership/authorization confirmation, and still require human approval.

The other 19 fleet entries are guidance-only prompts, not runnable integrations. `/api/skills` and the MCP `list_skills` tool report them as `prompt_only`; optional VoiceStudio, PhotoCraft, and REA MCPs show setup and live connection status. The app does not claim that prompt-only tools, Hypit, external publisher/calendar services, or a persistent feed watcher are implemented.

## Self-hosted agent hub: MCP server, MCP import, OAuth in

Everything Base44 did for agents now runs here, free and self-hosted. Other agents (OpenClaw, Claude, anything that speaks MCP) can join, see and change it.

- **MCP server**: `POST /mcp` (streamable HTTP, stateless, `Authorization: Bearer <token>`). Tools: `list_agents`, `get_agent`, `upsert_agent`, `reset_agent`, `list_tools`, `run_agent`, `list_threads`, `get_thread`, `list_action_log`, `list_time_audit`, `log_time_audit`, `call_tool`, `list_mcp_servers`, `import_mcp_server`, `remove_mcp_server`. Runs started over MCP show up in the Agents tab like any other conversation.
- **Scopes**: `read` (inspect), `run` (talk to agents), `admin` (edit agent manifests, manage automations, import MCP servers, and call registered safe tools). The admin scope cannot invoke approval-required tools or approve them through MCP; pending approvals must be reviewed in the authenticated app.
- **OAuth in**: create a client in the **Connect** tab, then `POST /oauth/token` with `grant_type=client_credentials` (client_secret_basic or _post) for a 1-hour bearer token. Discovery: `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource`. Long-lived access tokens can be minted in the same tab. Headless setup: set `MCP_ADMIN_TOKEN` (24+ chars) in `.env`. *Not implemented*: the interactive authorization-code + PKCE flow some hosted MCP clients expect; use client_credentials or a token.
- **MCP import**: Connect tab or `import_mcp_server`; accepts one server or a Claude-Desktop-style `mcpServers` block. HTTP servers are always allowed; local-command servers need `ALLOW_STDIO_IMPORT=1`. Imported servers persist in `DATA_DIR/mcp-servers.json` (may contain headers/secrets; file mode 600 on POSIX).
- **Security**: `/mcp` always requires a token, but the token-minting API under `/api` is open when `CLERK_SECRET_KEY` is unset. Put the server behind Tailscale/a firewall or enable Clerk before exposing it.
- **Tasks**: `make help` (or the matching `npm` scripts). `npm test` boots a throwaway server and runs all e2e suites. `make` itself was not run on this Windows machine.
## Automations (scheduler)

Cron-scheduled (5-field, **UTC**) agent runs or tool calls, replacing Base44 scheduled automations. Manage via `/api/automations` or the MCP tools `list_automations`, `upsert_automation` (admin), `run_automation`, `automation_runs`, `delete_automation`. Six templates (daily report, research digest, memory check, and House Manager/Content/Revenue briefings) install disabled. Unattended agent runs never auto-approve risky tools; they end as `awaiting_approval`. Direct tool automations are restricted to registered tools marked safe (checked both when saved and when run); approval-required tools are rejected. The **Automations** tab supports create, edit, enable/disable, templates, run-now and run history. The next occurrence of a five-field cron expression is displayed in UTC. Set `SCHEDULER=off` to disable the ticker. Not ported: LinkedIn publishing and Base44-entity triggers (no native equivalent), and data-change triggers (use `POST /api/automations/:id/trigger` from a webhook). Google Calendar account connection is available under **Connect**; calendar event-change push notifications are not implemented.

## Morgan agent playbook implementation

`agents/morgan_40_roster.json` adds the 40 roles listed in the attached House, Content, Revenue, Operations, and Growth breakdown, plus dedicated Content Engine and Revenue Agent core personas (42 new runnable personas; House Manager is included in the 40). They are editable agent manifests with least-privilege access to existing tools, not 42 persistent background processes. Each states its unavailable integrations and must produce drafts/plans rather than claiming external work. The runtime requires app approval for external or potentially billable tools. None of the templates are enabled by default.

The attached playbook names Gmail, Google Calendar, Notion, Apollo, Stripe, invoicing, Whisper, Canva bulk, Repurpose.io, social publishing, and other services. Google Gmail + Calendar are available as a per-user OAuth integration when server credentials are configured. Notion can be connected per user using an internal integration token. Gmail sends, calendar writes, and Notion page creation require app approval; the remaining named connectors are not yet implemented. Model instructions are not integrations. Review `docs/AGENT_PLAYBOOK.md` for the mapped roster and constraints.

## Action log and time audit

Agent tool invocations, approval requests/decisions, and automation outcomes are recorded in the user-scoped `agent.db` audit table. The log stores action names/status/timestamps, not tool arguments or private outputs; inspect it in **Action log**, `/api/agent/action-log`, or MCP `list_action_log`. It is not a filesystem `/memory` directory.

**Time audit** lets the user manually record 30-minute blocks with activity, energy (1–10), estimated value, and a complaint/note. The page summarizes the last 48 hours and links to **Idea Finder**. Idea Finder saves three hypotheses tied to the user's logged evidence and audience, each with a scoped 12-hour MVP, validation step, and risks. Public web search is opt-in. The `$500 × 40` example is labeled arithmetic, not a forecast or promise. The audit is user-entered only; it does not track computer activity. Entries are editable and overlapping blocks are rejected. MCP exposes `list_time_audit` and `idea_finder_report`.
