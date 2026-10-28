# Nodular architecture and boundaries

```text
React/Vite
  Agents / Connect / Automations / Action log
  Time audit + weekend checklist / Idea Finder
  Browser + one-frame capture / Mega draft chain
  ReactFlow DAG / Monaco / preview
          |
  Authenticated /api routes (local open mode when Clerk is unset)
          |
Fastify
  Agent runtime -> LLM router -> Ollama / Groq / OpenAI-compatible
       |                |
       |                +-> exact-provider vision / schema-validated drafts
       +-> scoped tools -> safe operations or pending exact-action approvals
       +-> delegation (cannot execute approval-required tools)
       +-> UTC scheduler (safe tool jobs, reviewable agent runs)
       +-> audit / messages / reviews / saved drafts
  Native integrations -> encrypted per-user provider credentials
  Workflow executor -> text / FLUX / remover / upscaler / preview
  Mega chain -> copy / native PNG cards / HTML / combinations
       +-> separately approved HyperFrames render
  Scoped token-authenticated /mcp <-> external MCP clients
  MCP bridge -> optional external MCP services (imported calls need approval)
          |
  agent.db + agents overrides + mcp-servers.json
  nodular.db OR Supabase workflow store
  DATA_DIR/mega (owner-checked PNG route)
  DATA_DIR/outputs (existing public-by-URL output route)
```

## Evidence and authority

Agent/model output cannot change tool risk or approve its own actions. MCP admin
tokens cannot invoke approval tools directly; delegated agents cannot execute
them. The Mega render button queues a saved pack ID as an exact tool approval;
deciding that approval executes one action without another model planning step.
Failures remain in the run, pack and action log.

The browser iframe is sandboxed and may be refused by a site's framing policy.
The app neither proxies around that policy nor reads cross-origin DOM/cookies.
`getDisplayMedia` uses the browser's user-controlled picker. Capture/redaction
happen locally; sharing to Idea Finder and vision-model upload are separate
steps. Stream tracks stop after one frame/failure/cancellation.

Research source fetching is bounded and uses the existing SSRF-protected helper.
No general shell is exposed by the parallel-fetch skill. Model context, source
pages and imported tool output are evidence, not trusted instructions.

## Model paths

Agents and the canvas text engine use the common provider router. `IDEA_MODEL`
selects structured idea/content synthesis; `IDEA_VISION_MODEL` selects one exact
vision provider/model with no silent vision-provider fallback. Local setup writes
only ignored `.env` settings, not repository credentials/weights. Diagnostics
separate capability metadata from actual synthetic inference results.

## Persistence and deployment

SQLite is the default. Supabase replaces the workflow store, **not** the agent/
automation/integration SQLite state. Use one application/scheduler instance.
Back up the entire data directory plus server configuration and encryption key.
Optional provider connections require real account setup and consent.

The workflow canvas is a topologically sorted DAG. It is not the same engine as
the agent tool loop or the native Mega draft chain. Mega's 100 combinations are
hook/CTA records, not 100 rendered videos. Its cards are actual local PNG text
artwork, not FLUX photography, PhotoCraft PSD editing or Hypit video cloning.

Socket.io supplies canvas suggestions. Installed Yjs libraries are not an
implemented shared multi-user editor. Optional REA MCP means Reverse Engineer
Anything and is a separate integration.

See [README.md](README.md) for the full capability matrix, operating instructions,
privacy/approval warnings, APIs, tests and troubleshooting.
