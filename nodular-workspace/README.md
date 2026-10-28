# Nodular Workspace

A self-hosted workspace for editable AI agents, approval-gated tools, workflows,
scheduled briefings, personal time audits, evidence-based idea research, and content
drafting. React/Vite runs the interface; Fastify and SQLite run the agent hub.
There is no Base44 runtime dependency.

**Free-first does not mean every service is free or connected.** Local templates,
checklists, SQLite, native research helpers and image cards need no paid service.
Genuine text generation, agent tool selection and image understanding need a real
model. Cloud providers can charge; OAuth products can require vendor approval.
The app distinguishes offline mocks, native outputs, configured integrations,
pending approvals, failed calls, and unsupported capabilities.

## Contents

- [Start locally](#start-locally)
- [Configure real models](#configure-real-models)
- [Workspace pages](#workspace-pages)
- [Browser and screenshot evidence](#browser-and-screenshot-evidence)
- [Mega one-button draft chain](#mega-one-button-draft-chain)
- [Agents, tools and the fleet](#agents-tools-and-the-fleet)
- [Automations](#automations)
- [Time audit and creative research](#time-audit-and-creative-research)
- [Connections and integrations](#connections-and-integrations)
- [MCP and OpenClaw interoperability](#mcp-and-openclaw-interoperability)
- [Workflow canvas and API deployment](#workflow-canvas-and-api-deployment)
- [Storage, privacy and production safety](#storage-privacy-and-production-safety)
- [Architecture and development](#architecture-and-development)
- [Troubleshooting](#troubleshooting)

## Start locally

Use **Node.js 24** and npm. Node's SQLite API is experimental; its warning is
expected. Run commands from this directory, not the repository's collection of
historical root-level source files.

```powershell
Set-Location .\nodular-workspace
npm ci --legacy-peer-deps
Copy-Item .env.example .env
npm run dev:all
```

Do not overwrite an existing `.env`; keep its account settings and secrets.
The frontend is `http://localhost:5173`, the backend is `http://localhost:3001`,
and `/health` reports backend/store readiness. Vite proxies `/api` requests.

For the built UI and API on a single port:

```powershell
npm run build
npm run server
```

Open `http://localhost:3001`. `npm run server` automatically loads `.env` using
Node's `--env-file-if-exists`; exported process variables take precedence.
Vite independently reads its own `VITE_*` settings.

No model/key is required to inspect the app, use local templates, record time,
manage checklists, or exercise the explicit mock agent. Mock responses are not
AI reasoning or a functioning provider connection.

## Configure real models

### Existing local Ollama installation

Start Ollama using its supported desktop/service setup, then:

```powershell
npm run models:configure
npm run models:test
npm run dev:all
```

The configurator queries `/api/tags` and `/api/show`, selects an **installed
tool-capable model** and an **installed vision model**, and writes nonsecret
model selections to ignored `.env`. It deliberately selects a local-only provider
order; unrelated environment settings are preserved. It does not install Ollama
or download multi-gigabyte weights.

Preferred installed models include `gpt-oss:20b` for multi-step tool work,
`llama3.2:latest` for lighter structured text, and `llava:latest` for vision.
Other installed models with appropriate reported
capabilities can be selected. Hardware, model license, quality and latency remain
the operator's responsibility. If none are installed, use Ollama's official
instructions to install suitable models, then rerun the configurator.

Example resulting settings:

```dotenv
LLM_PROVIDERS=ollama
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_MODEL=gpt-oss:20b
IDEA_MODEL=ollama:llama3.2:latest
IDEA_VISION_MODEL=ollama:llava:latest
```

`npm run models:test` performs actual structured-text, synthetic tool-call and
synthetic image inference. The vision test sends a generated red square, not a
private screenshot. A capability label alone does not count as a successful test.
The **Connect > Models** panel reports configured selections and offers the same
synthetic checks with visible failure messages.

`npm run models:test-autonomy` is the stronger opt-in check: a real agent must
read synthetic local context and actually save ten distinct idea drafts through
its tools in a temporary database. Merely returning a tool-call-shaped probe is
not enough to pass. Larger/stronger models may be needed for long multi-step
creative assignments; the small-model probe does not guarantee their completion.

The local implementation check successfully used `gpt-oss:20b` to read context
and save ten distinct drafts through the real agent tool loop. The smaller
`llama3.2:latest` passed structured ten-idea synthesis and Mega copy generation,
but did not reliably finish that multi-step autonomous assignment, so it is not
the selected local autonomous agent model. These are concrete smoke checks, not
a promise of deterministic behavior on every later task.

Agent chat and the canvas text node share the provider router. Idea Finder and
Mega drafts use `IDEA_MODEL`, or the router default if absent. Vision uses the
exact `IDEA_VISION_MODEL=provider:model`, without falling through to an unrelated
provider or a text-only model. Structured Ollama drafts use JSON-schema output
and are validated again by the server.

### Hosted or remote models

Use `OLLAMA_HOST` for a reachable trusted Ollama service; `OLLAMA_BASIC_AUTH`
supports a reverse proxy. For Groq, configure `GROQ_API_KEY` and optionally
`GROQ_MODEL`. For OpenAI-compatible servers set **both** `OPENAI_BASE_URL`
(including the compatible API base path) and `OPENAI_API_KEY`, plus `OPENAI_MODEL`
as needed. `LLM_PROVIDERS=ollama,groq,openai` defines fallback order.

Cloud inference can incur cost and transmit supplied evidence outside this host.
Review the configured provider before consenting. If configured calls fail, the
app reports errors; it does not replace failed inference with claimed success.
`LLM_PROVIDERS=none` deliberately exercises the offline mock. Supplying no usable
provider also permits the explicitly labeled offline agent fallback.

## Workspace pages

| Page | Purpose |
|---|---|
| Agents | Chat, tool results, approval cards, editable/custom personas, saved conversations |
| Workflow canvas | Connect text/image/removal/upscale/preview nodes and deploy a saved workflow API |
| Mega draft chain | Brief/transcript to reviewable copy, PNG cards, composition and draft combinations |
| Automations | Cron jobs, disabled templates, run-now, UTC next run and saved execution history |
| Time audit | Manual 30-minute blocks, 48-hour summary and per-weekend checklist |
| Idea Finder | Mixed-source combinations, model synthesis, missions, trend snapshots and human reviews |
| Browser / capture | Sandboxed browsing, external-tab fallback, consent-based one-frame capture and local redaction |
| Action log | User-scoped action/status/timestamp audit trail |
| Connect | Model diagnostics, account connections, access tokens, MCP imports and manifest editing |

Direct links accept `?view=agents`, `canvas`, `mega`, `automations`, `time-audit`,
`idea-finder`, `browser`, `action-log`, or `connect`.

## Browser and screenshot evidence

1. Open **Browser / capture** and enter an HTTPS URL without embedded credentials.
2. Try **Browse in panel**, or **Open your own tab** for sites that deny embedding
   or need normal-tab login/storage.
3. Click **Capture selected tab / window**. Your browser's native permission
   picker decides what to share; the app cannot choose a hidden target for you.
4. Review the single captured frame. Drag over sensitive regions to permanently
   black them out in the reviewed copy, or discard the frame.
5. Send the reviewed screenshot to Idea Finder. **Separately consent** there
   before sending its pixels to the configured vision model.
6. Review/correct the returned description. Only that reviewed text is included
   when generating an idea report.

Capture requests video only, never audio, and stops every stream track after one
frame or on failure/cancellation. The captured frame is scaled to at most 1920
pixels per side. Capture/redaction take place in browser memory; there is no
screen recorder, automatic background capture or upload during this step.

Screen capture requires a supporting desktop browser and a secure context
(localhost or HTTPS). Embedded browsers, operating systems or permission policies
may disable it. Uploading an ordinary screenshot remains available. The capture
picker itself is intentionally user-operated, not an unattended capture API.

The embedded page is sandboxed without same-origin privileges. Many sites use
CSP/X-Frame-Options or storage policies that prevent embedding. There is no proxy
that strips those protections. The app cannot inspect the cross-origin DOM,
verify a selected screenshot's origin, reuse your browser cookies, or bypass a
login, paywall or content-access restriction. Share only permitted content.

## Mega one-button draft chain

The attached Mega package was integrated by intent, not copied over the working
app. Its fixed transcript, invented earnings, placeholder images, silent audio,
claimed Hypit outputs, fake deployment response and unconditional success paths
are **not** treated as implementations.

Enter an audience and a 20-10,000 character brief/transcript. Choose local
templates or explicitly consent to configured model synthesis, then click
**Run native draft chain**. Optional WAV transcription reuses local Whisper only
when its real executable/model are configured.

| Stage | Actual output / boundary |
|---|---|
| Copy | Ten hooks, ten CTAs, summary and a narration script; validated real model output or labeled local templates |
| Cards | Ten real 1080 x 1920 PNG text cards generated locally with Sharp; not generated photography or PSD layers |
| Combinations | Ten paired drafts or all 100 hook x CTA combinations in JSON; ten underlying images, not 100 unique videos |
| Composition | A 15-second portrait HTML/GSAP composition with the draft text; sandboxed preview and HTML download |
| MP4 | Separate exact-action approval through the existing runtime; calls HyperFrames only after approval |
| Voice | Script only; no native VoiceStudio synthesis or voice cloning adapter is configured by this flow |
| Publish/deploy | Not automatic; use a separately approved publisher or the existing workflow deployment surface |

Packs, generated cards and failed-run messages persist in `DATA_DIR`. PNG cards
are served through owner-checked `/api/mega/packs/:id/cards/:index` routes and
loaded using authenticated API requests. JSON/HTML/card downloads are available.
Failed model calls are recorded as failures; they never silently become template
or fake provider successes.

The render request creates a visible approval for the exact saved pack ID.
Approve/reject in Mega or Agents. A rejection executes nothing; successful and
failed renders update the pack, run and action log. Direct MCP calls, delegated
agents and unattended tool automations cannot bypass this approval.

Rendering requires HyperFrames CLI support, Chrome and FFmpeg on the server and
may download executable Node tooling. The composition uses GSAP from jsDelivr;
the preview button says so before loading it. HTML is **not** an MP4. A render
produces the ten-hook montage, not 100 cloned videos, speech, dubbing or publishing.

REST: GET `/api/mega/health`, GET `/api/mega/packs`, GET `/api/mega/packs/:id`,
POST `/api/mega/run`, POST `/api/mega/packs/:id/render`.
Tools: `mega_create_pack` (approval), `mega_read_pack` (safe),
`mega_render_video` (approval). The Content Engine persona can use them.

## Agents, tools and the fleet

Built-in Markdown manifests live under `agents/`; the Morgan roster adds 40 named
roles plus Content Engine and Revenue Agent personas. They are editable runtime
personas, **not** 42 permanently running processes. Users can create scoped
custom agents. UI/agent manifest edits write overrides under `DATA_DIR/agents`;
resetting an override restores the shipped definition.

The registry exposes each tool's schema and `safe`/`approval` risk. Only tools
available to that persona are offered to its model. Local tool results and
external data are untrusted evidence, not instructions. Risky actions stop at
visible approvals; delegated runs cannot execute them, and MCP clients cannot
approve their own requests.

The original fleet inventory has **34 entries**. Fifteen runnable free/no-key
entries use native implementations: public search/read helpers, metadata,
passive authorized header checks, bounded page extraction/fetching, arXiv
reference starters, local nucleotide statistics, and opt-out draft templates.
Nineteen entries are prompt-only guidance, not connected services. `/api/skills`
and MCP `list_skills` expose honest status and available tools.

HTTP service definitions in `config/http-tools.json` are optional operator
templates, not verified contracts for your private services. Adapt them to
documented APIs and set required environment variables before using them.
Public research uses SSRF-protected `safeFetch`; it does not execute browser JS
or provide a shell.

## Automations

Manage list/create/edit/enable/disable, templates, run-now and history in
**Automations**. Cron is **five fields in UTC**, not browser-local time. The UI
shows the next occurrence. The server must stay running; `SCHEDULER=off` stops
the scheduler.

Templates install disabled: daily report, six-hour research, memory check,
Morgan briefings, AI trend radar and creative idea briefing. The memory check
only searches memory; it is not a real continuity-relay heartbeat.

Direct tool jobs accept safe tools only, checked at save **and** execution.
Scheduled agent runs can reach `awaiting_approval`, never auto-approve publishing,
sends, booking, payment actions, model-research approvals or render tools.
Inspect the saved run/thread to continue an authorized action.

There are no Base44 entity triggers, automatic Calendar event-change push
subscriptions, or scheduled LinkedIn publisher. Existing external webhook
senders can invoke the authenticated `/api/automations/:id/trigger` endpoint;
that endpoint is not a new provider integration.

## Time audit and creative research

Record manual 30-minute blocks with activity, energy 1-10, estimated value and
notes. The audit summarizes 48 hours and rejects overlapping blocks. It does not
monitor your device or infer actual earnings.

The weekend tracker saves six editable default exercise tasks, custom additions,
completion and evidence notes per user/Saturday date. Reinstalling defaults
preserves progress. Sunday selects the preceding Saturday; weekdays default to
the upcoming weekend.

Idea Finder combines an audience and natural-language brief with pasted text,
public business/GitHub links, permitted Instagram/D&B excerpts, D-U-N-S context,
image descriptions and the audit. Public fetching, web search, YouTube search
and model synthesis each require opt-in. Instagram is not scraped, D-U-N-S is
not verified against a proprietary database, and GitHub input reads public
profile/repository metadata, not a full source-code audit.

Generate three or ten saved hypotheses, each with a problem, evidence, 12-hour
MVP scope, experiment, risks and validated source IDs. Local combinations work
offline and are labeled as such. Real synthesis has strict output/count/citation
validation; it does not manufacture evidence when a provider fails.

Save a mission, moonshot revenue goal, horizon, budget ceiling and weekly
experiment target. Actual gross revenue remains separately self-reported.
Creativity/usefulness scores and validation notes are human judgments. Large
money goals are aspirations, not forecasts, emotional motivation for software,
or authorization to spend.

The trend radar saves dated public YouTube/web search metadata for predefined
AI business/skills topics. It does not watch videos, rank real earnings, guarantee
top-ten quality or predict every trend. Source failures are visible.
Optional daily radar and autonomous creative-draft templates install disabled;
the draft agent needs a real model and saves proposals for human review.
See [IDEA_LAB.md](docs/IDEA_LAB.md), including the dated YouTube research links.

## Connections and integrations

Provider tokens are never committed. Per-user stored credentials use encryption
with a stable `INTEGRATION_ENCRYPTION_KEY` of at least 32 characters.

| Service | Implemented capability | Prerequisite / limitation |
|---|---|---|
| Google Gmail/Calendar | Read/search; approved drafts, sends, event creation | OAuth app, user consent, scopes; no event-change push trigger |
| Notion | Search, paginated direct-child page reads, approved child-page creation | User's internal integration and explicitly shared pages; no recursive workspace crawl |
| Apollo | Bounded prospect search | Account API key; no email/phone enrichment |
| Stripe account tools | Exact-email customer lookup and approved draft invoice + line item | Per-user key; no finalize, send or charge |
| Canva | OAuth, design metadata, approved blank design and export jobs | Approved vendor app/scopes; no bulk generation |
| LinkedIn | OAuth member connection, approved single public text post | OpenID Connect + Share on LinkedIn products; no scheduled/multi-network publisher |
| Whisper.cpp | Actual local PCM WAV transcription | `WHISPER_CPP_PATH`, `WHISPER_MODEL_PATH`; 16-bit PCM WAV, max 50 MiB |
| HyperFrames | Approved HTML to MP4/WebM/GIF tool | CLI, Chrome, FFmpeg and output permissions |
| VoiceStudio / PhotoCraft / REA | Optional MCP bridge configuration | Real service/binary required; bridge availability is not native synthesis/PSD editing |
| Hypit / Repurpose.io | No runnable native integration | No fake endpoint, clone operation or success fallback |

REA in the optional MCP bridge means **Reverse Engineer Anything**, not a
implemented collaborative editor. Socket.io canvas suggestions are separate.
Yjs packages are present, but realtime multi-user co-editing is not built.

Detailed guides:
[Google](docs/GOOGLE_INTEGRATION.md),
[Notion](docs/NOTION_INTEGRATION.md),
[Sales](docs/SALES_INTEGRATIONS.md),
[Canva and publishing](docs/CANVA_AND_PUBLISHING.md),
[Morgan playbook](docs/AGENT_PLAYBOOK.md).
Provider-mocked tests do not establish that an unconfigured account is connected.

## MCP and OpenClaw interoperability

The app is both an MCP client and a token-protected MCP server:

- `POST /mcp`: Streamable HTTP with a bearer access token.
- `read`: inspect agents, threads, skills, time audit, lab and other scoped data.
- `run`: talk to agents and start reviewable runs.
- `admin`: edit manifests/import MCP/manage automations/call **safe** tools.
- Approval-required tools still need authenticated-app approval, even with admin.

Create a token or OAuth client in **Connect**. OAuth `/oauth/token` supports
`client_credentials` with client-secret Basic or POST authentication and one-hour
tokens. Discovery is available at `/.well-known/oauth-authorization-server` and
`/.well-known/oauth-protected-resource`. Authorization-code + PKCE interactive
sign-in is **not implemented**; clients that require only that flow need a
different supported connection mode.

Set a private `MCP_ADMIN_TOKEN` (24+ characters) only for trusted headless setup.
Never put tokens in repository files or copy them into public issues.

Imports accept a server definition or a Claude-Desktop-style `mcpServers` block.
Tools are namespaced `<server>__<tool>`. Imported tools require approval; clients
cannot mark their own tools safe. Local-command imports require explicit
`ALLOW_STDIO_IMPORT=1` and execute code on this host. Configuration persists in
`DATA_DIR/mcp-servers.json`, which can contain secrets: protect/back it up.

For OpenClaw or another MCP client, configure this server's actual base URL,
bearer token and supported Streamable HTTP transport in that client's settings.
No specific unverified OpenClaw configuration shape is assumed here.

## Workflow canvas and API deployment

The original DAG canvas connects text prompt enhancement, FLUX image generation,
background removal, upscaling and HTML preview. Cycles fail validation.
Text now uses the same Ollama/Groq/OpenAI-compatible router as agents.

FLUX requires `HF_TOKEN` and a compatible reachable provider; without it the
existing image node explicitly returns a placeholder. Background removal uses
the local package; failures report a passthrough engine. Sharp upscaling is
Lanczos resampling, **not** generative Real-ESRGAN; configured Replicate is
optional and may charge. A 4x resize is not proof of recovered image detail.

**Deploy API** saves a workflow and issues a workflow-scoped key once. Calling
`POST /api/workflows/:id/run` requires its `x-api-key` and consumes a configured
credit. Copy the actual URL/key from the UI; do not use placeholder public URLs.
This provisions a route in your running server, not a cloud deployment or a
complete storefront. The optional billing hook has no full subscription/payment
webhook lifecycle. Model prompts and an endpoint do not establish market demand.

## Storage, privacy and production safety

| Location | Contents |
|---|---|
| `DATA_DIR/agent.db` | Threads/messages, approvals, memories, automations/history, audit, connections, time audit, lab and Mega pack metadata |
| `DATA_DIR/nodular.db` | Default SQLite workflow/user/key/credit/run store |
| `DATA_DIR/agents` | Runtime manifest overrides |
| `DATA_DIR/mcp-servers.json` | Persisted imported MCP definitions, possibly secret headers |
| `DATA_DIR/mega/<id>` | Saved PNG draft cards; owner-checked API downloads |
| `DATA_DIR/outputs` | Existing rendered/workflow output files |
| `.env` | Local server setup and private credentials; ignored by Git |

Supabase optionally replaces the **workflow store only**. Agent/chat/automation/
integration databases remain local SQLite. Run a single application/scheduler
instance unless you implement distributed locking and migrate all local state.
Back up the entire data directory, `.env`, stable encryption key and any
Supabase data, using access-controlled storage. Stop/quiesce writes or use a
proper SQLite backup procedure for a consistent copy. Changing/losing the
encryption key makes saved integration credentials unreadable.

**Without `CLERK_SECRET_KEY`, `/api` is local-user open mode**, including token
minting and management. Do not expose it directly to the internet. Use a firewall/
private network, or configure Clerk backend and matching frontend publishable key.
Restrict `CORS_ORIGIN`, use HTTPS, protect provider/model endpoints, and review
which operators can edit server-wide manifests/import executable MCP servers.
Clerk sign-in alone is not a complete multi-tenant admin role system.

The existing `/outputs/:name` file surface is public-by-URL and cacheable; protect
it at a reverse proxy or avoid sensitive rendered/workflow content. Mega PNG
cards use a distinct owner-checked `/api` route, but an approved rendered MP4 uses
the existing output surface. Screenshot pixels are not retained by image analysis;
reviewed descriptions and supplied notes can be persisted in reports/messages.
Do not treat all workspace outputs as confidential simply because API routes
require sign-in.

Audit records contain action names/status/timestamps, not complete arguments or
private outputs. Other tables deliberately retain report/conversation content.
An audit log is not a filesystem `/memory` directory.

Never commit `.env`, provider secrets, database files, model weights, captured
screenshots, `node_modules`, or generated `dist`. Clone the source and restore
local configuration/data separately on another machine.

## Architecture and development

```text
src/App.tsx                 Page navigation and screenshot handoff
src/agents/                Agents, Connect, automations, audit, lab, browser, Mega UI
src/lib/screen-capture.ts   User-permission single-frame capture and cleanup
src/canvas, editor, nodes   Workflow canvas, Monaco and preview
server/index.ts            Fastify bootstrap, auth, static output, native routes
server/agent/llm.ts         Shared router, tools, structured text, strict vision
server/agent/runtime.ts     Runs, delegation, approvals and exact-action requests
server/agent/tools.ts       Tool registry, web search, safeFetch
server/agent/models.ts      Honest diagnostics and synthetic inference tests
server/agent/mega.ts        Persisted native content chain and approved render wrapper
server/agent/idea-lab.ts    Evidence, mission, trend snapshots, reviews and image analysis
server/agent/automations.ts UTC cron scheduler and execution history
server/agent/mcp*.ts        MCP client bridge and scoped server
server/agent/db.ts          Local agent SQLite schema
server/store.ts            Workflow SQLite/Supabase store
server/services.ts         Workflow model/image engines
server/pipeline.ts         Topological workflow execution
agents, config, docs        Editable personas, operator configuration and guides
scripts                    Regression harness and opt-in live checks
```

```powershell
npm test
npx tsc --noEmit
npm run build
git diff --check
```

`npm test` creates a temporary mock-provider server and databases, exercises agent/
MCP/approval boundaries, integrations, automations, workflow, audit, lab, capture
cleanup, model diagnostics and Mega persistence/approval tests, then cleans up.
It intentionally does not download real models or call your private accounts.
Synthetic browser tests do not replace manually accepting/declining your browser's
actual screen permission picker. `npm run models:test` is an explicit live model
check and is separate from the offline suite.

Docker, Fly and Railway examples are in [DEPLOY.md](DEPLOY.md). A container's
`127.0.0.1` is the container, not the Windows host: use a reachable Ollama address
such as `host.docker.internal` where supported. Runtime `.env` and model weights
are not part of the image. Install renderer/transcriber dependencies deliberately
on the execution host. See [ARCHITECTURE.md](ARCHITECTURE.md) for boundaries.

## Troubleshooting

| Symptom | Action |
|---|---|
| Changes absent on GitHub | Select the actual pushed feature branch, not the default branch. The root README links to the runnable app directory. |
| Mock banner / no autonomous drafts | Start Ollama, run model configuration/tests, restart the server; verify `LLM_PROVIDERS` is not `none`. |
| Model installed but inference fails | Check capabilities, model name, available memory and Connect test errors. Installed is not the same as loaded/responding. |
| Image needs manual description | Configure/test `IDEA_VISION_MODEL`; ordinary text models cannot read pixels. |
| Blank embedded page | The site may reject framing; open your own tab and use the explicit capture picker. |
| No screen-capture picker | Use desktop Chrome/Edge or another supporting browser on HTTPS/localhost; platform policy may block it. Upload a screenshot instead. |
| AI returns invalid drafts/citations | Refine the brief or use a stronger compatible model. Errors remain visible; offline templates are a separate explicit choice. |
| Automation did not execute | Check enabled status, UTC next run, server uptime, `SCHEDULER` and saved errors/approvals. |
| MP4 unavailable | Approve the exact render, then inspect Chrome/FFmpeg/HyperFrames/CDN errors; an HTML draft is not video. |
| OAuth not connected | Follow that provider's guide, verify callback URL, scopes/products, encryption key and user consent. |
| Can't transcribe audio | Configure actual Whisper.cpp paths and a compatible 16-bit PCM WAV; no fabricated transcript fallback exists. |
| Old UI / missing asset after rebuild | Finish the build, restart the backend's production static-file registration, then reload the page. |

This repository ships source and tested native paths, not guaranteed provider
accounts, sales results, every named fleet integration, or a finished commercial
deployment. Review claims, permissions, model output and customer evidence before
acting on them.
