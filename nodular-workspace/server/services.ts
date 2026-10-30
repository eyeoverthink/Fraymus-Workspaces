import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const DEFAULT_SYSTEM = 'You are a FLUX prompt engineer. Convert user ideas into detailed, photorealistic FLUX.1 schnell prompts. Be specific about lighting, camera, texture. Output only the prompt.'

// Prompt step. Engines, in order: Groq (GROQ_API_KEY), any OpenAI-compatible endpoint such as the
// Hostinger router (PROMPT_LLM_BASE_URL/PROMPT_LLM_API_KEY, falling back to OPENAI_BASE_URL/OPENAI_API_KEY),
// otherwise a fixed template (mocked=true). PROMPT_LLM=groq|openai|template forces one.
export async function runLlama(prompt: string, system = DEFAULT_SYSTEM): Promise<{ text: string; mocked?: boolean; engine: string }> {
  const groqKey = process.env.GROQ_API_KEY
  const oaBase = process.env.PROMPT_LLM_BASE_URL || process.env.OPENAI_BASE_URL
  const oaKey = process.env.PROMPT_LLM_API_KEY || process.env.OPENAI_API_KEY
  const pick = process.env.PROMPT_LLM || (groqKey ? 'groq' : oaBase && oaKey ? 'openai' : 'template')
  if (pick === 'template' || (pick === 'groq' && !groqKey) || (pick === 'openai' && !(oaBase && oaKey))) {
    return { text: `Photorealistic ${prompt.slice(0, 200)}, UGC mirror selfie, iPhone flash, natural skin texture, 8k, ultra detailed`, mocked: true, engine: 'template' }
  }
  const url = pick === 'groq' ? GROQ_URL : `${oaBase!.replace(/\/$/, '')}/chat/completions`
  const model = pick === 'groq' ? (process.env.GROQ_MODEL || 'llama-3.3-70b-versatile') : (process.env.PROMPT_LLM_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini')
  const headers: Record<string, string> = { Authorization: `Bearer ${pick === 'groq' ? groqKey : oaKey}`, 'Content-Type': 'application/json' }
  if (pick === 'openai' && process.env.OPENAI_USER_AGENT) headers['User-Agent'] = process.env.OPENAI_USER_AGENT
  const r = await fetch(url, {
    method: 'POST', headers, signal: AbortSignal.timeout(60000),
    body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], max_tokens: 400, temperature: 0.8 })
  })
  const data: any = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${pick} prompt LLM failed ${r.status}: ${JSON.stringify(data).slice(0, 300)}`)
  const text = data.choices?.[0]?.message?.content
  if (!text) throw new Error(`${pick} prompt LLM returned no text`)
  return { text, engine: `${pick}:${model}` }
}

function escapeXml(s: string) {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c] as string))
}

export async function runFlux(prompt: string): Promise<{ png: Buffer; mocked: boolean; engine?: string }> {
  const token = process.env.HF_TOKEN
  if (!token) {
    const svg = `<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#e5e7eb"/><circle cx="512" cy="430" r="170" fill="#6366f1"/><rect x="332" y="620" width="360" height="260" rx="40" fill="#6366f1"/><text x="50%" y="960" text-anchor="middle" fill="#111" font-family="monospace" font-size="24">FLUX placeholder - set HF_TOKEN: ${escapeXml(prompt.slice(0, 40))}</text></svg>`
    return { png: await sharp(Buffer.from(svg)).png().toBuffer(), mocked: true }
  }
  // hf-inference no longer serves FLUX.1-schnell (410 "deprecated"). Route through HF Inference Providers instead.
  // HF_FLUX_PROVIDER: comma-separated order to try (default "nscale,fal-ai"); HF_FLUX_MODEL overrides the model id.
  // HF_FLUX_URL (legacy) still forces a raw-bytes hf-inference style endpoint.
  const model = process.env.HF_FLUX_MODEL || 'black-forest-labs/FLUX.1-schnell'
  const providers = process.env.HF_FLUX_URL ? ['url'] : (process.env.HF_FLUX_PROVIDER || 'nscale,fal-ai').split(',').map((s) => s.trim()).filter(Boolean)
  const errors: string[] = []
  for (const provider of providers) {
    try {
      const raw = await fluxViaProvider(provider, model, prompt, token)
      return { png: await sharp(raw).png().toBuffer(), mocked: false, engine: `hf-${provider}:${model.split('/').pop()}` }
    } catch (e: any) {
      errors.push(`${provider}: ${e?.message || e}`)
    }
  }
  throw new Error(`HF FLUX failed (${errors.join(' | ').slice(0, 500)})`)
}

const FAL_IDS: Record<string, string> = {
  'black-forest-labs/FLUX.1-schnell': 'fal-ai/flux/schnell',
  'black-forest-labs/FLUX.1-dev': 'fal-ai/flux/dev'
}

async function fluxViaProvider(provider: string, model: string, prompt: string, token: string): Promise<Buffer> {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const signal = AbortSignal.timeout(120000)
  const steps = /schnell/i.test(model) ? 4 : 28
  if (provider === 'nscale') {
    const r = await fetch('https://router.huggingface.co/nscale/v1/images/generations', {
      signal, method: 'POST', headers,
      body: JSON.stringify({ model, prompt, size: '1024x1024', response_format: 'b64_json' })
    })
    if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 200)}`)
    const j: any = await r.json()
    const b64 = j?.data?.[0]?.b64_json
    if (!b64) throw new Error('no image in response')
    return Buffer.from(b64, 'base64')
  }
  if (provider === 'fal-ai') {
    const id = FAL_IDS[model]
    if (!id) throw new Error(`no fal-ai mapping for ${model}`)
    const r = await fetch(`https://router.huggingface.co/fal-ai/${id}`, {
      signal, method: 'POST', headers,
      body: JSON.stringify({ prompt, num_inference_steps: steps, image_size: { width: 1024, height: 1024 } })
    })
    if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 200)}`)
    const j: any = await r.json()
    const imgUrl = j?.images?.[0]?.url
    if (!imgUrl) throw new Error('no image in response')
    const ir = await fetch(imgUrl, { signal })
    if (!ir.ok) throw new Error(`image download ${ir.status}`)
    return Buffer.from(await ir.arrayBuffer())
  }
  const url = provider === 'url' ? process.env.HF_FLUX_URL! : `https://router.huggingface.co/${provider}/models/${model}`
  const r = await fetch(url, {
    signal, method: 'POST', headers,
    body: JSON.stringify({ inputs: prompt, parameters: { num_inference_steps: steps, guidance_scale: 0 } })
  })
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 200)}`)
  return Buffer.from(await r.arrayBuffer())
}

function removeInWorker(input: Buffer, timeoutMs = 180000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [fileURLToPath(new URL('./remover-worker.mjs', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'] })
    const out: Buffer[] = []; let err = ''
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('background removal timed out')) }, timeoutMs)
    p.stdout.on('data', (d) => out.push(d))
    p.stderr.on('data', (d) => { err += d })
    p.on('error', (e) => { clearTimeout(t); reject(e) })
    p.on('close', (code, sig) => {
      clearTimeout(t)
      const png = Buffer.concat(out)
      if (code === 0 && png.length) resolve(png)
      else reject(new Error(`remover worker exited ${code ?? sig}: ${err.trim().split('\n').pop()?.slice(0, 200) || ''}`))
    })
    p.stdin.end(input)
  })
}

export async function runRemover(input: Buffer): Promise<{ png: Buffer; engine: string }> {
  try {
    return { png: await removeInWorker(input), engine: 'imgly-isnet-local' }
  } catch (err) {
    console.warn('Local background removal failed, passing image through', err)
    return { png: await sharp(input).ensureAlpha().png().toBuffer(), engine: 'passthrough' }
  }
}

async function replicateUpscale(input: Buffer, scale: number): Promise<Buffer> {
  const token = process.env.REPLICATE_API_TOKEN!
  const version = process.env.REPLICATE_ESRGAN_VERSION || 'nightmareai/real-esrgan'
  const png = await sharp(input).png().toBuffer()
  const body: any = { input: { image: `data:image/png;base64,${png.toString('base64')}`, scale: Math.min(scale, 4), face_enhance: false } }
  const url = version.includes(':')
    ? 'https://api.replicate.com/v1/predictions'
    : `https://api.replicate.com/v1/models/${version}/predictions`
  if (version.includes(':')) body.version = version.split(':')[1]
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'wait=60' },
    body: JSON.stringify(body)
  })
  let pred: any = await r.json()
  if (!r.ok) throw new Error(`Replicate failed ${r.status}: ${JSON.stringify(pred).slice(0, 300)}`)
  for (let i = 0; i < 60 && !['succeeded', 'failed', 'canceled'].includes(pred.status); i++) {
    await new Promise((res) => setTimeout(res, 2000))
    pred = await (await fetch(pred.urls.get, { headers: { Authorization: `Bearer ${token}` } })).json()
  }
  if (pred.status !== 'succeeded') throw new Error(`Replicate prediction ${pred.status}: ${pred.error || ''}`)
  const outUrl = Array.isArray(pred.output) ? pred.output[0] : pred.output
  return Buffer.from(await (await fetch(outUrl)).arrayBuffer())
}

export async function runUpscaler(input: Buffer, scale = 4): Promise<{ png: Buffer; from: string; to: string; engine: string }> {
  const meta = await sharp(input).metadata()
  const w = meta.width || 1024
  const h = meta.height || 1024
  const to = `${w * scale}x${h * scale}`
  let engine = 'sharp-lanczos3'
  let png: Buffer | null = null

  if (process.env.REPLICATE_API_TOKEN) {
    try {
      const ai = await replicateUpscale(input, scale)
      // Real-ESRGAN output must match the requested size; normalize so the contract holds.
      png = await sharp(ai).resize(w * scale, h * scale, { kernel: 'lanczos3' }).png({ compressionLevel: 8 }).toBuffer()
      engine = 'replicate-real-esrgan'
    } catch (err) {
      console.warn('Replicate upscale failed, falling back to sharp', err)
    }
  }
  if (!png) {
    png = await sharp(input).resize(w * scale, h * scale, { kernel: 'lanczos3', fastShrinkOnLoad: false }).png({ compressionLevel: 8 }).toBuffer()
  }
  return { png, from: `${w}x${h}`, to, engine }
}
