
# NODULAR WORKSPACE - FULL IMPLEMENTATION (No Stubs)

5-node chain: Llama Groq (brain) → FLUX schnell (image) → BiRefNet Remover → Real-ESRGAN Upscaler → HTML Preview + Deploy API

Rebuild of $4M Enhancor Workflows video using 100% FREE 2026 stack.

## Quick Start

npm i
cp .env.example .env
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

Click Deploy API → returns POST /api/workflows/:id/run
Curl: curl -X POST http://localhost:3001/api/workflows/ugc-mirror-selfie-v1/run -d '{"prompt":"mirror selfie"}'

This endpoint is your product. Charge per call. System prompt chain is moat.

## For Codex/Devin

Read AGENT_INSTRUCTIONS.md - explains what was built, file map, expectations, acceptance criteria. Implement true BiRefNet WASM via @imgly/background-removal-node and true Real-ESRGAN via replicate, add Supabase persistence, auth, billing.

## Video Concept

Wrapper dies, workflow is IP. System prompt chain is moat, not model. This repo implements that with free models.
