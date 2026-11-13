
# ARCHITECTURE - Nodular Workspace Full

## System Diagram

```
[User] --drag--> [ReactFlow Canvas @xyflow/react]
   |                 | (nodes, edges JSON)
   |                 v
   |           [Zustand Store] --debounce--> POST /api/rea/suggest
   |                 |                          |
   |                 |                          v
   |                 |                    [REA Agent - Groq Llama free]
   |                 |                          | io.emit('rea:suggestion')
   |                 |                          v
   |                 |                    [Monaco Editor - ghost text]
   |                 |
   |                 v Run Workflow button
   |           [executor.ts - topological sort]
   |                 |
   |                 +--> /api/llama (Groq free) -> text
   |                 +--> /api/flux (free-first image chain) -> image blob
   |                 +--> /api/remover (BiRefNet free WASM) -> transparent PNG
   |                 +--> /api/upscaler (Sharp 4x free) -> 4K PNG
   |                 +--> /api/workflows/:id/run (deploy endpoint - your product)
   |                 |
   |                 v
   |           [Live Preview - HTML + 4K image]
   |
   +--> Deploy API button --> POST /api/workflows + /deploy --> returns curl endpoint
```

## Free Stack Justification

| Paid (Video) | Free (This Repo) | Implementation | Cost |
|---|---|---|---|
| Nano Banana (Gemini image) | Pollinations and local by default. Hugging Face runs only with HF_TOKEN and HF_IMAGE_BILLING_CONFIRMED=true. Gemini (`gemini-2.5-flash-image`) runs only when listed in IMAGE_PROVIDERS and GEMINI_IMAGE_BILLING_CONFIRMED=true. OpenAI and Replicate opt-in | server/image/providers.ts | $0 unless a billed provider is confirmed |
| Claude Sonnet | Llama 3.3 70B | Groq API 14k tok/s | $0 |
| Remove.bg | BiRefNet | @imgly/background-removal WASM + HF RMBG-1.4 | $0 local |
| Magnific | Sharp resize (Real-ESRGAN opt-in) | Sharp lanczos3 resize. Real-ESRGAN only when ENABLE_PAID_REPLICATE=1 and REPLICATE_API_TOKEN are both set | $0 local unless that flag is 1 |

## Data Flow for 5-Node Chain

1. Node 1 Llama: input prompt "mirror selfie" -> Groq -> enhanced prompt "UGC mirror selfie, iPhone flash, Gen-Z bedroom, vintage denim..."
2. Node 2 FLUX: enhanced prompt -> image provider chain -> png blob URL
3. Node 3 Remover: blob URL -> fetch blob -> FormData -> /api/remover -> HF RMBG-1.4 returns transparent PNG -> blob URL
4. Node 4 Upscaler: transparent PNG -> /api/upscaler -> sharp resize 4096x4096 lanczos3 -> blob URL
5. Node 5 Preview: final blob URL + text -> HTML with <img> + deploy curl

## Realtime

- Yjs + y-websocket for multi-user cursor sync (future)
- Socket.io for REA suggestions + canvas updates
- Zustand for local state, syncs to store on every change

## Deploy as API - Product Moat

Workflows Map in-memory (replace with Postgres). Each workflow is DAG + system prompts. Deploy creates endpoint that runs DAG server-side. Customer pays per run. System prompt chain is IP, not model.
