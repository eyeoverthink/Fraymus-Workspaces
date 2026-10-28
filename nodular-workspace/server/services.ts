import sharp from 'sharp'
import { chat } from './agent/llm'

const DEFAULT_SYSTEM = 'You are a FLUX prompt engineer. Convert user ideas into detailed, photorealistic FLUX.1 schnell prompts. Be specific about lighting, camera, texture. Output only the prompt.'

export async function runLlama(prompt: string, system = DEFAULT_SYSTEM): Promise<{ text: string; mocked?: boolean; provider?: string; model?: string }> {
  const result = await chat([{ role: 'system', content: system }, { role: 'user', content: prompt }], [], undefined, { maxTokens: 600 })
  if (result.provider === 'mock') {
    return { text: `Photorealistic ${prompt.slice(0, 200)}, UGC mirror selfie, iPhone flash, natural skin texture, 8k, ultra detailed`, mocked: true }
  }
  if (!result.content.trim()) throw new Error('Configured model returned no text for the workflow')
  return { text: result.content, mocked: false, provider: result.provider, model: result.model }
}

function escapeXml(s: string) {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c] as string))
}

export async function runFlux(prompt: string): Promise<{ png: Buffer; mocked: boolean }> {
  const token = process.env.HF_TOKEN
  if (!token) {
    const svg = `<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#e5e7eb"/><circle cx="512" cy="430" r="170" fill="#6366f1"/><rect x="332" y="620" width="360" height="260" rx="40" fill="#6366f1"/><text x="50%" y="960" text-anchor="middle" fill="#111" font-family="monospace" font-size="24">FLUX placeholder - set HF_TOKEN: ${escapeXml(prompt.slice(0, 40))}</text></svg>`
    return { png: await sharp(Buffer.from(svg)).png().toBuffer(), mocked: true }
  }
  const r = await fetch('https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs: prompt, parameters: { num_inference_steps: 4, guidance_scale: 0 } })
  })
  if (!r.ok) throw new Error(`HF FLUX failed ${r.status}: ${(await r.text()).slice(0, 300)}`)
  const raw = Buffer.from(await r.arrayBuffer())
  return { png: await sharp(raw).png().toBuffer(), mocked: false }
}

export async function runRemover(input: Buffer): Promise<{ png: Buffer; engine: string }> {
  try {
    const { removeBackground } = await import('@imgly/background-removal-node')
    const src = await sharp(input).png().toBuffer()
    const blob = await removeBackground(new Blob([new Uint8Array(src)], { type: 'image/png' }))
    return { png: Buffer.from(await blob.arrayBuffer()), engine: 'imgly-birefnet-local' }
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
