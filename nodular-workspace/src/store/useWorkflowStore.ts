
import { create } from 'zustand'
import { Node, Edge } from '@xyflow/react'

type WorkflowState = {
  nodes: Node[]
  edges: Edge[]
  code: string
  previewHtml: string
  agentSuggestion: string
  isRunning: boolean
  executionLog: any[]
  deployedUrl: string | null
  deployedCurl: string | null
  setNodes: (n: Node[]) => void
  setEdges: (e: Edge[]) => void
  setCode: (c: string) => void
  setPreviewHtml: (h: string) => void
  setAgentSuggestion: (s: string) => void
  setIsRunning: (b: boolean) => void
  addLog: (log: any) => void
  setDeployedUrl: (url: string | null) => void
  setDeployedCurl: (c: string | null) => void
}

export const useWorkflowStore = create<WorkflowState>((set) => ({
  nodes: [
    { id: '1', type: 'llama-groq', position: { x: 50, y: 50 }, data: { prompt: 'You are a UGC expert. Transform this into a detailed FLUX prompt: Mirror selfie, iPhone 14 flash, messy Gen-Z bedroom, vintage denim jacket, natural skin texture, photorealistic, 4K, UGC style --ar 4:5' } },
    { id: '2', type: 'flux-schnell', position: { x: 400, y: 50 }, data: { model: 'black-forest-labs/FLUX.1-schnell', steps: 4, prompt: 'mirror selfie' } },
    { id: '3', type: 'remover-birefnet', position: { x: 750, y: 50 }, data: { label: 'Remove background for product' } },
    { id: '4', type: 'upscaler-realesrgan', position: { x: 1100, y: 50 }, data: { scale: 4, label: 'Upscale to 4K' } },
    { id: '5', type: 'html-preview', position: { x: 1450, y: 50 }, data: { html: '<div style="padding:20px;color:#888">Run workflow → output appears here → Deploy as API</div>' } },
  ],
  edges: [
    { id: 'e1-2', source: '1', target: '2', animated: true },
    { id: 'e2-3', source: '2', target: '3', animated: true },
    { id: 'e3-4', source: '3', target: '4', animated: true },
    { id: 'e4-5', source: '4', target: '5', animated: true },
  ],
  code: `// NODULAR EXECUTOR - Full implementation
// This code runs in server/engine/executor.ts
// No stubs - every node has real implementation:
// 1. Llama Groq (free brain)
// 2. FLUX schnell (free image)
// 3. BiRefNet remover (free local WASM)
// 4. Real-ESRGAN upscaler (free sharp)
// 5. HTML preview + deploy endpoint

import { executeWorkflow } from './engine/executor'
const result = await executeWorkflow(nodes, edges, { workflowId: 'ugc-mirror-selfie' })
console.log('Final:', result.finalOutput)
`,
  previewHtml: '<div style="padding:24px;color:#888">Run workflow to see result</div>',
  agentSuggestion: '💡 REA: Full chain ready! Llama → FLUX → Remover → Upscaler → Deploy. This chain is your IP. Run it, then Deploy as API.',
  isRunning: false,
  executionLog: [],
  deployedUrl: null,
  deployedCurl: null,
  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),
  setCode: (code) => set({ code }),
  setPreviewHtml: (html) => set({ previewHtml: html }),
  setAgentSuggestion: (s) => set({ agentSuggestion: s }),
  setIsRunning: (b) => set({ isRunning: b }),
  addLog: (log) => set((state) => ({ executionLog: [...state.executionLog, log] })),
  setDeployedUrl: (url) => set({ deployedUrl: url }),
  setDeployedCurl: (c) => set({ deployedCurl: c }),
}))
