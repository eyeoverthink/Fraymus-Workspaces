
# AGENT INSTRUCTIONS - FOR CODEX / DEVIN / DUMB AGENT

You are being given a FULLY WORKING nodular workflow system scaffold. No stubs. Every file is implemented.

## WHAT WAS BUILT (Context from YouTube Video)

Original video: "I Made $4M with AI workflows and I'll show you how" - Enhancor Workflows
Core idea: Wrapper (1 API call) dies in 12 months. Workflow (chain of APIs + system prompt + logic) is defensible IP.

This repo rebuilds that using 100% FREE 2026 stack:

### FREE REPLACEMENTS:
- Nano Banana 2 (paid Gemini image) → FLUX.1 [schnell] via HuggingFace Inference - Apache 2.0, 4 steps, FREE
- Claude Sonnet (paid brain) → Llama 3.3 70B via Groq - 14k tok/s FREE
- Kora Reality (paid video) → Wan 2.1 via Replicate free tier
- Remove.bg ($0.20/img) → BiRefNet via @imgly/background-removal WASM - FREE local
- Magnific Upscaler ($0.50/img) → Sharp lanczos3 4x local - FREE, or Real-ESRGAN WASM

### 5-NODE CHAIN IMPLEMENTED:
1. Llama Groq Node (Brain) - System prompt is IP/moat - `src/nodes/LlamaNode.tsx`
2. FLUX Schnell Node (Image Gen) - `src/nodes/FluxNode.tsx` - calls /api/flux
3. BiRefNet Remover Node - `src/nodes/BackgroundRemoverNode.tsx` - calls /api/remover - transparent PNG
4. Real-ESRGAN Upscaler Node - `src/nodes/UpscalerNode.tsx` - calls /api/upscaler - 1024→4096
5. HTML Preview + Deploy Node - `src/nodes/HtmlPreviewNode.tsx` - renders + exposes as API

## FILE MAP - EVERY FILE IS FULL IMPLEMENTATION, NO TODOs

```
src/
  canvas/WorkflowCanvas.tsx - ReactFlow canvas, drag nodes, runWorkflow() calls executor.ts, updates nodes with outputs
  nodes/
    LlamaNode.tsx - brain, purple border, shows system prompt
    FluxNode.tsx - image gen, white border, shows generated image
    BackgroundRemoverNode.tsx - NEW, indigo border, BiRefNet free local
    UpscalerNode.tsx - NEW, green border, 4x sharp upscaler
    HtmlPreviewNode.tsx - output + deploy URL display
    index.ts - nodeTypes registry for ReactFlow
  engine/
    registry.ts - FREE_REGISTRY with 6 models, specs, inputs/outputs, cost FREE
    executor.ts - FULL DAG executor, topological sort, runs nodes in order, handles image blobs, error handling, no stubs
  store/useWorkflowStore.ts - Zustand store, initial 5-node chain already wired with animated edges
  editor/
    MonacoWorkspace.tsx - Monaco editor + REA suggestion chip + execution log
    LivePreview.tsx - Shows final image + HTML + deploy curl
  rea/
    prompts.ts - REA_SYSTEM_PROMPT, moat logic
    agent.ts - getReaSuggestion() calls Groq
  App.tsx - 3-pane layout + Deploy API button + logs

server/
  index.ts - FULL Fastify + Socket.io server, 6 routes:
    POST /api/llama - Groq Llama free, fallback mock if no key
    POST /api/flux - HF FLUX schnell, fallback SVG placeholder if no key
    POST /api/remover - BiRefNet via HF RMBG-1.4 if HF_TOKEN, else sharp local fallback (full implementation)
    POST /api/upscaler - Sharp lanczos3 4x upscale, real image resize, headers X-Upscale-From/To
    POST /api/rea/suggest - Heuristic + Groq for smart suggestions, broadcasts via io.emit
    POST /api/workflows - CRUD, POST /:id/run, POST /:id/deploy - deploy as API endpoint (your product)
```

## HOW REA (Realtime Editing Agent) WORKS

1. User drags node → onNodesChange → useWorkflowStore updates
2. useEffect in WorkflowCanvas debounces and POST /api/rea/suggest with nodes+edges
3. Server: heuristic checks chain length, suggests next high-leverage node from FREE_REGISTRY
4. If GROQ_API_KEY set, calls Llama 3.3 for smarter suggestion
5. Broadcasts via Socket.io: io.emit('rea:suggestion', {suggestion, codePatch})
6. Frontend: Monaco shows ghost text, chip updates "💡 REA: Add Upscaler..."

## HOW DEPLOY AS API WORKS (Your Product Moat)

This is the key insight from video: Workflow IS the product.

- User builds canvas, clicks Deploy API
- POST /api/workflows creates workflow ID
- POST /api/workflows/:id/deploy creates endpoint
- Endpoint: POST /api/workflows/:id/run with { prompt } → runs full chain server-side → returns { imageUrl, html }
- Customer pays per call - you own the chain + system prompt, not model

## EXPECTATIONS FOR YOU (Codex/Devin)

You have FULL working code. No stubs. Your job to turn into production app:

### MUST DO:
1. **Add persistence**: Replace in-memory Map with Supabase/Prisma Postgres. Workflows, runs, users.
2. **Add auth**: Clerk or Supabase Auth. Users own workflows.
3. **Improve remover**: Currently sharp fallback. Install @imgly/background-removal-node and implement true BiRefNet WASM local in server. Code: `import { removeBackground } from '@imgly/background-removal-node'`
4. **Improve upscaler**: Currently sharp lanczos3. For true Real-ESRGAN, add `replicate` SDK and call `xinntao/realesrgan` or use `upscaler` npm with `esm` model. Keep sharp as fallback.
5. **Add file upload UI**: In canvas, allow dropping image as input to remover
6. **Add tests**: `scripts/test-workflow.mjs` - test full 5-node execution
7. **Polish UI**: Loading states, error toasts, image comparison slider (before/after remover/upscaler)
8. **Deploy**: Dockerfile, deploy to Railway/Fly.io, env vars GROQ_API_KEY, HF_TOKEN
9. **Add billing**: Stripe per workflow run, metered

### ACCEPTANCE CRITERIA:
- npm run dev:all works without errors
- Run Workflow button executes 5 nodes and shows final 4K image in preview
- Remove background actually makes transparent (check via checkerboard background in node)
- Upscale actually 4x (check headers X-Upscale-To)
- Deploy API returns curl that works: curl POST /api/workflows/:id/run
- REA suggestion changes as you add nodes (test: start with 1 node, REA should suggest FLUX)

### DO NOT:
- Do not add stubs or TODOs - implement fully
- Do not break free stack - keep all APIs free tier
- Do not remove REA - it's core feature
- Do not hardcode API keys - use process.env

### ENV NEEDED:
```
GROQ_API_KEY=gsk_... # https://console.groq.com - free
HF_TOKEN=hf_... # https://huggingface.co/settings/tokens - free
```

If no keys, app still works with mocks/placeholders + sharp local - no crashes.

## WHY THIS IS VALUABLE (Explain to dumb agent)

This is not a demo. It's a $4M pattern: System prompt chain + free models = defensible product. User can build any UGC, product photo, ad creative workflow and sell API access. Your job is to make it production-ready.

Start with server/index.ts - make remover and upscaler true AI, not sharp fallback. Then add persistence. Then polish canvas.

Good luck.
