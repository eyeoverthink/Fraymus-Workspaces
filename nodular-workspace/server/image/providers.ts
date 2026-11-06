import sharp from 'sharp'

// Free-first image generation. Gemini (gemini-2.5-flash-image) is billed, so it
// runs only when IMAGE_PROVIDERS lists it and GEMINI_IMAGE_BILLING_CONFIRMED=true.
// OpenAI and Replicate run only when listed and their key is set.
// Nothing here prints a key.

export const DEFAULT_IMAGE_PROVIDERS = ['huggingface', 'pollinations', 'local'] as const
/** Billed image models. Not in the default order. */
export const BILLED_IMAGE_PROVIDERS = ['gemini'] as const
export const PAID_IMAGE_PROVIDERS = ['openai', 'replicate'] as const

const KNOWN = new Set<string>([...DEFAULT_IMAGE_PROVIDERS, ...BILLED_IMAGE_PROVIDERS, ...PAID_IMAGE_PROVIDERS])

export type Env = Record<string, string | undefined>
export type ImageFetch = (input: string, init?: RequestInit) => Promise<Response>
export type ImageOutput = { png: Buffer; mocked: boolean; provider: string; model?: string }
export type ProviderSkip = { name: string; reason: string }
export type ImagePlan = {
  /** Names from IMAGE_PROVIDERS, in order, with "none" removed. */
  order: string[]
  /** Providers that will actually be called. */
  active: string[]
  /** Listed but not called (missing key, unknown name). */
  skipped: ProviderSkip[]
  /** Billed or paid providers whose key is set but which were not listed. Never called. */
  gated: ProviderSkip[]
}

export type GenerateOpts = {
  env?: Env
  fetch?: ImageFetch
  log?: (line: string) => void
}

const SECRET_ENV = ['HF_TOKEN', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'REPLICATE_API_TOKEN', 'LOCAL_IMAGE_TOKEN'] as const

export function redactSecrets(text: string, env: Env = process.env): string {
  let s = String(text || '')
  for (const key of SECRET_ENV) {
    const value = env[key]?.trim()
    if (value && value.length >= 8) s = s.split(value).join('[redacted]')
  }
  return s
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [redacted]')
    .replace(/\b(sk-[A-Za-z0-9_\-]{8,})\b/g, '[redacted]')
    .replace(/\b(hf_[A-Za-z0-9]{8,})\b/g, '[redacted]')
    .replace(/\b(AIza[0-9A-Za-z_\-]{10,})\b/g, '[redacted]')
    .replace(/\b(r8_[A-Za-z0-9]{8,})\b/g, '[redacted]')
    .replace(/([?&](?:key|api_key|token|access_token)=)[^&\s"]+/gi, '$1[redacted]')
}

function clip(s: string, max = 180): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, max)
}

function listedProviders(env: Env): string[] {
  const raw = env.IMAGE_PROVIDERS
  const source = raw === undefined ? DEFAULT_IMAGE_PROVIDERS.join(',') : raw
  const names = source.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (names.length === 0 || names.every((n) => n === 'none')) return []
  return names.filter((n) => n !== 'none')
}

function geminiConfirmed(env: Env): boolean {
  return env.GEMINI_IMAGE_BILLING_CONFIRMED === 'true'
}

function configured(name: string, env: Env): boolean {
  switch (name) {
    case 'huggingface': return !!env.HF_TOKEN?.trim()
    case 'gemini': return !!env.GEMINI_API_KEY?.trim() && geminiConfirmed(env)
    case 'pollinations': return true
    case 'local': return !!env.LOCAL_IMAGE_URL?.trim()
    case 'openai': return !!env.OPENAI_API_KEY?.trim()
    case 'replicate': return !!env.REPLICATE_API_TOKEN?.trim()
    default: return false
  }
}

function credentialPresent(name: string, env: Env): boolean {
  if (name === 'gemini') return !!env.GEMINI_API_KEY?.trim()
  return configured(name, env)
}

function skipReason(name: string, env: Env): string {
  switch (name) {
    case 'huggingface': return 'HF_TOKEN not set'
    case 'gemini':
      if (!env.GEMINI_API_KEY?.trim()) return 'GEMINI_API_KEY not set'
      return 'GEMINI_IMAGE_BILLING_CONFIRMED is not true'
    case 'local': return 'LOCAL_IMAGE_URL not set'
    case 'openai': return 'OPENAI_API_KEY not set'
    case 'replicate': return 'REPLICATE_API_TOKEN not set'
    default: return 'unknown provider'
  }
}

export function planImageProviders(env: Env = process.env): ImagePlan {
  const order = listedProviders(env)
  const skipped: ProviderSkip[] = []
  const active: string[] = []
  for (const name of order) {
    if (!KNOWN.has(name)) {
      skipped.push({ name, reason: 'unknown provider' })
      continue
    }
    if (!configured(name, env)) {
      skipped.push({ name, reason: skipReason(name, env) })
      continue
    }
    active.push(name)
  }
  const gated: ProviderSkip[] = []
  for (const name of [...BILLED_IMAGE_PROVIDERS, ...PAID_IMAGE_PROVIDERS]) {
    if (!order.includes(name) && credentialPresent(name, env)) {
      gated.push({
        name,
        reason: name === 'gemini'
          ? 'billed; list gemini in IMAGE_PROVIDERS and set GEMINI_IMAGE_BILLING_CONFIRMED=true'
          : 'opt-in only; not listed in IMAGE_PROVIDERS'
      })
    }
  }
  return { order, active, skipped, gated }
}

function escapeXml(s: string) {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c] as string))
}

async function placeholderPng(prompt: string): Promise<Buffer> {
  const label = escapeXml(prompt.slice(0, 40))
  const svg = `<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#e5e7eb"/><circle cx="512" cy="430" r="170" fill="#6366f1"/><rect x="332" y="620" width="360" height="260" rx="40" fill="#6366f1"/><text x="50%" y="960" text-anchor="middle" fill="#111" font-family="monospace" font-size="22">Image placeholder (no provider configured): ${label}</text></svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

async function toPng(buf: Buffer): Promise<Buffer> {
  try {
    return await sharp(buf).png().toBuffer()
  } catch {
    throw new Error('response was not a decodable image')
  }
}

function isImage(buf: Buffer, contentType: string): boolean {
  const ct = contentType.split(';')[0].trim().toLowerCase()
  if (ct.startsWith('text/') || ct.includes('json') || ct.includes('html') || ct.includes('xml')) return false
  if (buf.length < 32) return false
  const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
  const webp = buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP'
  const gif = buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a'
  if (png || jpeg || webp || gif) return true
  return ct.startsWith('image/')
}

function errorDetail(status: number, text: string): string {
  let detail = text
  try {
    const j = JSON.parse(text)
    const inner = j?.error?.message || j?.error?.error || (typeof j?.error === 'string' ? j.error : '') || j?.detail || j?.message || ''
    if (inner) detail = typeof inner === 'string' ? inner : JSON.stringify(inner)
  } catch { /* body is not JSON */ }
  return clip(`${status} ${detail}`)
}

async function readBuf(res: Response): Promise<Buffer> {
  return Buffer.from(await res.arrayBuffer())
}

async function mustImage(res: Response, label: string): Promise<Buffer> {
  const buf = await readBuf(res)
  const ct = res.headers.get('content-type') || ''
  if (!res.ok || !isImage(buf, ct)) throw new Error(`${label} ${errorDetail(res.status, buf.toString('utf8').slice(0, 500))}`)
  return buf
}

async function postJson(fetchImpl: ImageFetch, url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<Response> {
  return fetchImpl(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function hfModels(env: Env): string[] {
  if (env.HF_IMAGE_MODEL?.trim()) return [env.HF_IMAGE_MODEL.trim()]
  return (env.HF_IMAGE_MODELS || 'black-forest-labs/FLUX.1-schnell,stabilityai/stable-diffusion-xl-base-1.0')
    .split(',').map((s) => s.trim()).filter(Boolean)
}

async function fromHuggingFace(prompt: string, env: Env, fetchImpl: ImageFetch): Promise<{ png: Buffer; model: string }> {
  const errors: string[] = []
  for (const model of hfModels(env)) {
    const schnell = /schnell/i.test(model)
    const res = await postJson(fetchImpl, `https://router.huggingface.co/hf-inference/models/${model}`, {
      Authorization: `Bearer ${env.HF_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'image/png'
    }, {
      inputs: prompt,
      parameters: { num_inference_steps: schnell ? 4 : 20, guidance_scale: schnell ? 0 : 7.5 }
    }, 90_000)
    const buf = await readBuf(res)
    const ct = res.headers.get('content-type') || ''
    if (res.ok && isImage(buf, ct)) return { png: buf, model }
    errors.push(`${model} ${errorDetail(res.status, buf.toString('utf8').slice(0, 400))}`)
  }
  throw new Error(errors.join('; ') || 'no Hugging Face image model configured')
}

async function fromGemini(prompt: string, env: Env, fetchImpl: ImageFetch): Promise<{ png: Buffer; model: string }> {
  if (!env.GEMINI_API_KEY?.trim() || !geminiConfirmed(env)) {
    throw new Error('GEMINI_IMAGE_BILLING_CONFIRMED is not true')
  }
  const model = env.GEMINI_IMAGE_MODEL?.trim() || 'gemini-2.5-flash-image'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
  const res = await postJson(fetchImpl, url, {
    'Content-Type': 'application/json',
    'x-goog-api-key': env.GEMINI_API_KEY || ''
  }, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
  }, 90_000)
  const text = (await readBuf(res)).toString('utf8')
  if (!res.ok) throw new Error(errorDetail(res.status, text.slice(0, 500)))
  let parsed: any
  try { parsed = JSON.parse(text) } catch { throw new Error(errorDetail(res.status, text.slice(0, 400))) }
  const parts = parsed?.candidates?.[0]?.content?.parts || []
  let data = ''
  for (const part of parts) {
    const inline = part.inlineData || part.inline_data
    if (inline?.data) { data = inline.data; break }
  }
  if (!data) {
    const msg = parsed?.promptFeedback?.blockReason || parsed?.candidates?.[0]?.finishReason || 'response had no image'
    throw new Error(String(msg))
  }
  return { png: Buffer.from(data, 'base64'), model }
}

async function fromPollinations(prompt: string, _env: Env, fetchImpl: ImageFetch): Promise<{ png: Buffer; model: string }> {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=768&height=768&nologo=true&model=flux`
  const res = await fetchImpl(url, {
    headers: { Accept: 'image/jpeg, image/png', 'User-Agent': 'NodularAgent/1.0' },
    signal: AbortSignal.timeout(60_000)
  })
  return { png: await mustImage(res, 'pollinations'), model: 'flux' }
}

function assertNotPaidHost(raw: string) {
  let host = ''
  try { host = new URL(raw).hostname.toLowerCase() } catch { throw new Error('LOCAL_IMAGE_URL is not a valid URL') }
  if (host === 'api.openai.com' || host.endsWith('.openai.com') || host === 'api.replicate.com' || host.endsWith('.replicate.com')) {
    throw new Error('local image URL points at a paid host; list openai or replicate in IMAGE_PROVIDERS to opt in')
  }
}

function joinPath(base: string, path: string): string {
  const b = base.replace(/\/$/, '')
  return b.endsWith(path) ? b : b + path
}

async function fromLocal(prompt: string, env: Env, fetchImpl: ImageFetch): Promise<{ png: Buffer; model: string }> {
  const base = env.LOCAL_IMAGE_URL!.trim()
  assertNotPaidHost(base)
  const kind = (env.LOCAL_IMAGE_KIND || 'a1111').trim().toLowerCase()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (env.LOCAL_IMAGE_TOKEN?.trim()) headers.Authorization = `Bearer ${env.LOCAL_IMAGE_TOKEN.trim()}`
  if (kind === 'comfy') return fromComfy(prompt, env, fetchImpl, base, headers)
  if (kind === 'openai' || kind === 'ollama') return fromLocalOpenAI(prompt, fetchImpl, base, headers)
  if (kind !== 'a1111' && kind !== 'automatic1111' && kind !== 'sdwebui') {
    throw new Error(`unknown LOCAL_IMAGE_KIND ${kind}`)
  }
  const res = await postJson(fetchImpl, joinPath(base, '/sdapi/v1/txt2img'), headers, {
    prompt, steps: 4, width: 512, height: 512, cfg_scale: 1
  }, 120_000)
  const buf = await readBuf(res)
  if (!res.ok) throw new Error(errorDetail(res.status, buf.toString('utf8').slice(0, 400)))
  let b64 = ''
  try { b64 = JSON.parse(buf.toString('utf8'))?.images?.[0] || '' } catch { /* not json */ }
  if (!b64) throw new Error('a1111 response had no images[0]')
  const raw = b64.includes(',') ? b64.split(',').pop()! : b64
  return { png: Buffer.from(raw, 'base64'), model: 'a1111' }
}

async function fromLocalOpenAI(prompt: string, fetchImpl: ImageFetch, base: string, headers: Record<string, string>): Promise<{ png: Buffer; model: string }> {
  const res = await postJson(fetchImpl, joinPath(base, '/v1/images/generations'), headers, {
    prompt, size: '512x512', n: 1, response_format: 'b64_json'
  }, 120_000)
  const buf = await readBuf(res)
  if (!res.ok) throw new Error(errorDetail(res.status, buf.toString('utf8').slice(0, 400)))
  const data = JSON.parse(buf.toString('utf8'))?.data?.[0]
  if (data?.b64_json) return { png: Buffer.from(data.b64_json, 'base64'), model: 'local-openai' }
  if (typeof data?.url === 'string') {
    const img = await fetchImpl(data.url, { signal: AbortSignal.timeout(60_000) })
    return { png: await mustImage(img, 'local'), model: 'local-openai' }
  }
  throw new Error('local openai-compatible response had no image')
}

function comfyWorkflow(prompt: string, ckpt: string) {
  return {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['4', 1] } },
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed: Math.floor(Math.random() * 1e9), steps: 4, cfg: 1, sampler_name: 'euler', scheduler: 'normal', denoise: 1,
        model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0]
      }
    },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'nodular', images: ['8', 0] } }
  }
}

async function fromComfy(prompt: string, env: Env, fetchImpl: ImageFetch, base: string, headers: Record<string, string>): Promise<{ png: Buffer; model: string }> {
  const ckpt = env.COMFY_CHECKPOINT?.trim() || 'sd_xl_base_1.0.safetensors'
  const res = await postJson(fetchImpl, joinPath(base, '/prompt'), headers, { prompt: comfyWorkflow(prompt, ckpt) }, 30_000)
  const createdBuf = await readBuf(res)
  if (!res.ok) throw new Error(errorDetail(res.status, createdBuf.toString('utf8').slice(0, 400)))
  const created = JSON.parse(createdBuf.toString('utf8'))
  const nodeErrors = created.node_errors && Object.keys(created.node_errors).length ? JSON.stringify(created.node_errors) : ''
  if (!created.prompt_id) throw new Error(clip(nodeErrors || 'comfy did not return prompt_id'))
  if (nodeErrors) throw new Error(clip(`comfy node error ${nodeErrors}`))
  let image: { filename: string; subfolder?: string; type?: string } | undefined
  for (let i = 0; i < 60 && !image; i++) {
    if (i) await sleep(1000)
    const histRes = await fetchImpl(`${base.replace(/\/$/, '')}/history/${created.prompt_id}`, { headers, signal: AbortSignal.timeout(20_000) })
    const histBuf = await readBuf(histRes)
    if (!histRes.ok) throw new Error(errorDetail(histRes.status, histBuf.toString('utf8').slice(0, 300)))
    const hist = JSON.parse(histBuf.toString('utf8'))
    const outputs = hist?.[created.prompt_id]?.outputs || {}
    for (const node of Object.values(outputs) as any[]) {
      if (node?.images?.[0]?.filename) { image = node.images[0]; break }
    }
  }
  if (!image) throw new Error('comfy history had no image')
  const q = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '', type: image.type || 'output' })
  const view = await fetchImpl(`${base.replace(/\/$/, '')}/view?${q}`, { signal: AbortSignal.timeout(60_000) })
  return { png: await mustImage(view, 'comfy'), model: ckpt }
}

async function fromOpenAI(prompt: string, env: Env, fetchImpl: ImageFetch): Promise<{ png: Buffer; model: string }> {
  const model = env.OPENAI_IMAGE_MODEL?.trim() || 'gpt-image-1'
  const base = (env.OPENAI_IMAGE_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
  const body: Record<string, unknown> = { model, prompt, size: '1024x1024', n: 1 }
  if (model.startsWith('dall-e')) body.response_format = 'b64_json'
  const res = await postJson(fetchImpl, `${base}/images/generations`, {
    Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    'Content-Type': 'application/json'
  }, body, 120_000)
  const buf = await readBuf(res)
  if (!res.ok) throw new Error(errorDetail(res.status, buf.toString('utf8').slice(0, 500)))
  const data = JSON.parse(buf.toString('utf8'))?.data?.[0]
  if (data?.b64_json) return { png: Buffer.from(data.b64_json, 'base64'), model }
  if (typeof data?.url === 'string') {
    const img = await fetchImpl(data.url, { signal: AbortSignal.timeout(60_000) })
    return { png: await mustImage(img, 'openai'), model }
  }
  throw new Error('openai response had no image')
}

async function fromReplicate(prompt: string, env: Env, fetchImpl: ImageFetch): Promise<{ png: Buffer; model: string }> {
  const model = env.REPLICATE_IMAGE_MODEL?.trim() || 'black-forest-labs/flux-schnell'
  const token = env.REPLICATE_API_TOKEN || ''
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'wait=60' }
  let res = await postJson(fetchImpl, `https://api.replicate.com/v1/models/${model}/predictions`, headers, { input: { prompt } }, 90_000)
  let pred: any = JSON.parse((await readBuf(res)).toString('utf8'))
  if (!res.ok) throw new Error(errorDetail(res.status, JSON.stringify(pred).slice(0, 400)))
  for (let i = 0; i < 30 && pred?.urls?.get && !['succeeded', 'failed', 'canceled'].includes(pred.status); i++) {
    await sleep(1000)
    const poll = await fetchImpl(pred.urls.get, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) })
    pred = JSON.parse((await readBuf(poll)).toString('utf8'))
    if (!poll.ok) throw new Error(errorDetail(poll.status, JSON.stringify(pred).slice(0, 300)))
  }
  if (pred.status !== 'succeeded') throw new Error(clip(`replicate ${pred.status || 'error'}: ${pred.error || pred.detail || ''}`))
  const out = Array.isArray(pred.output) ? pred.output[0] : pred.output
  if (typeof out !== 'string') throw new Error('replicate returned no image')
  const img = await fetchImpl(out, { signal: AbortSignal.timeout(60_000) })
  return { png: await mustImage(img, 'replicate'), model }
}

const callers: Record<string, (prompt: string, env: Env, fetchImpl: ImageFetch) => Promise<{ png: Buffer; model: string }>> = {
  huggingface: fromHuggingFace,
  gemini: fromGemini,
  pollinations: fromPollinations,
  local: fromLocal,
  openai: fromOpenAI,
  replicate: fromReplicate
}

export function failureMessage(tried: { name: string; reason: string }[]): string {
  return `Image generation failed. Tried ${tried.map((t) => `${t.name} (${t.reason})`).join('; ')}.`
}

export async function generateImage(prompt: string, opts: GenerateOpts = {}): Promise<ImageOutput> {
  const env = opts.env || process.env
  const fetchImpl = opts.fetch || fetch
  const log = opts.log || ((line) => console.warn(line))
  const text = String(prompt || '').trim()
  if (!text) throw new Error('prompt required')
  const plan = planImageProviders(env)
  const tried: { name: string; reason: string }[] = []
  for (const name of plan.active) {
    try {
      const out = await callers[name](text, env, fetchImpl)
      return { png: await toPng(out.png), mocked: false, provider: name, model: out.model }
    } catch (e: any) {
      const reason = clip(redactSecrets(e?.message || String(e), env))
      log(`image provider ${name} failed: ${reason}`)
      tried.push({ name, reason })
    }
  }
  if (tried.length === 0) return { png: await placeholderPng(text), mocked: true, provider: 'placeholder' }
  throw new Error(failureMessage(tried))
}
