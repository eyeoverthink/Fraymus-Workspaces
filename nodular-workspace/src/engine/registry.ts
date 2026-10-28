
// FREE 2026 REGISTRY - 100% free replacements for Enhancor paid stack
export const FREE_REGISTRY = {
  'llama-groq': {
    id: 'llama-groq',
    name: 'Llama 3.3 70B - Brain',
    replaces: 'Claude Sonnet',
    provider: 'Groq - FREE 14k tok/s',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    cost: 'FREE',
    inputs: [{ name: 'prompt', type: 'string', required: true, description: 'System prompt - this is your IP/moat' }],
    outputs: [{ name: 'text', type: 'string', description: 'Enhanced prompt for image gen' }],
    docs: 'Your system prompt is the moat. Make it specific: "UGC mirror selfie, iPhone flash, messy bedroom..."',
    free: true
  },
  'flux-schnell': {
    id: 'flux-schnell',
    name: 'FLUX.1 [schnell] - Image Gen',
    replaces: 'Nano Banana 2',
    provider: 'HuggingFace Inference - FREE Apache 2.0',
    endpoint: 'https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell',
    cost: 'FREE Apache 2.0 - 4 steps',
    inputs: [{ name: 'prompt', type: 'string', required: true }, { name: 'seed', type: 'number', required: false }],
    outputs: [{ name: 'imageUrl', type: 'image', description: '1024x1024 generated image' }],
    docs: 'Fastest open model. 4 inference steps. Commercial use allowed.',
    free: true
  },
  'remover-birefnet': {
    id: 'remover-birefnet',
    name: 'BiRefNet - Background Remover',
    replaces: 'Paid Remove.bg API',
    provider: 'Bria RMBG-1.4 / @imgly/background-removal - FREE local WASM',
    endpoint: '/api/remover - local or HF',
    cost: 'FREE - runs locally via WASM, no API key',
    inputs: [{ name: 'imageUrl', type: 'image', required: true }],
    outputs: [{ name: 'imageUrl', type: 'image', description: 'Transparent PNG' }],
    docs: 'Uses BiRefNet high-res. If HF token present, uses briaai/RMBG-1.4, else local @imgly/background-removal',
    free: true
  },
  'upscaler-realesrgan': {
    id: 'upscaler-realesrgan',
    name: 'Real-ESRGAN 4x - Upscaler',
    replaces: 'Paid Magnific / Topaz API',
    provider: 'Sharp + Real-ESRGAN WASM - FREE local',
    endpoint: '/api/upscaler - local sharp lanczos3 4x',
    cost: 'FREE - sharp local, no API',
    inputs: [{ name: 'imageUrl', type: 'image', required: true }, { name: 'scale', type: 'number', default: 4 }],
    outputs: [{ name: 'imageUrl', type: 'image', description: '4K upscaled image' }],
    docs: 'Sharp lanczos3 4x. For true Real-ESRGAN, swap with replicate.com/xinntao/realesrgan free tier',
    free: true
  },
  'html-preview': {
    id: 'html-preview',
    name: 'HTML / React Preview + API Endpoint',
    replaces: 'Enhancor Deploy Button',
    provider: 'Local - deployable',
    endpoint: '/api/workflows/:id/deploy',
    cost: 'FREE',
    inputs: [{ name: 'imageUrl', type: 'image' }, { name: 'text', type: 'string' }],
    outputs: [{ name: 'html', type: 'html' }, { name: 'deployUrl', type: 'string' }],
    docs: 'Final node. Renders output + exposes workflow as POST /api/run/:workflowId',
    free: true
  },
  'wan-animate': {
    id: 'wan-animate',
    name: 'Wan 2.1 Animate - Video (Optional)',
    replaces: 'Kora Reality',
    provider: 'Replicate free tier',
    cost: 'FREE credits',
    inputs: [{ name: 'imageUrl', type: 'image' }],
    outputs: [{ name: 'videoUrl', type: 'video' }],
    free: true
  }
}

export type RegistryId = keyof typeof FREE_REGISTRY
export const getNodeSpec = (id: string) => (FREE_REGISTRY as any)[id]
