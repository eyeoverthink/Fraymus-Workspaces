// Provider-chain tests. Every HTTP call is mocked. No live image API is contacted.
import sharp from 'sharp'
import {
  BILLED_IMAGE_PROVIDERS, DEFAULT_IMAGE_PROVIDERS, PAID_IMAGE_PROVIDERS, failureMessage, generateImage, planImageProviders, redactSecrets,
  type Env, type ImageFetch
} from '../server/image/providers.ts'
import { runUpscaler } from '../server/services.ts'

let failed = 0
const ok = (c: unknown, m: string) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) failed++ }

const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#336699' } }).png().toBuffer()
const b64 = png.toString('base64')

type Call = { url: string; init?: RequestInit }
function mock(handler: (url: string, init: RequestInit | undefined, calls: Call[]) => Response | Promise<Response>): { fetch: ImageFetch; calls: Call[] } {
  const calls: Call[] = []
  const fetch: ImageFetch = async (url, init) => {
    calls.push({ url, init })
    return handler(url, init, calls)
  }
  return { fetch, calls }
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const bytes = (buf: Buffer, type = 'image/png', status = 200) => new Response(buf, { status, headers: { 'content-type': type } })
const hosts = (calls: Call[]) => calls.map((c) => new URL(c.url).host + new URL(c.url).pathname)

ok(DEFAULT_IMAGE_PROVIDERS.join() === 'huggingface,pollinations,local', 'default order is free providers')
ok(!DEFAULT_IMAGE_PROVIDERS.includes('gemini' as never), 'gemini is not in the default order')
ok(BILLED_IMAGE_PROVIDERS.join() === 'gemini', 'gemini is the billed opt-in provider')
ok(PAID_IMAGE_PROVIDERS.join() === 'openai,replicate', 'paid names are openai and replicate')

const paidKeys: Env = { OPENAI_API_KEY: 'sk-test-openai-key-0001', REPLICATE_API_TOKEN: 'r8_testreplicatetoken0001' }
const geminiKey = 'AIzaTestGeminiKey0001234567890'
const hfToken = 'hf_testtokenvalue0001'
const def = planImageProviders({ ...paidKeys, HF_TOKEN: hfToken, GEMINI_API_KEY: geminiKey })
ok(def.order.join() === 'huggingface,pollinations,local', 'unset IMAGE_PROVIDERS uses the default order')
ok(def.active.join() === 'pollinations', 'a Hugging Face token alone does not call the router: ' + def.active.join())
ok(def.skipped.some((s) => s.name === 'huggingface' && s.reason.includes('HF_IMAGE_BILLING_CONFIRMED')), 'unconfirmed Hugging Face is skipped')
ok(!def.active.includes('gemini') && !def.active.includes('openai') && !def.active.includes('replicate'), 'billed and paid providers stay out of the default plan')
ok(def.gated.map((g) => g.name).join() === 'gemini,openai,replicate', 'gemini and paid keys without a listing are gated')
const hfOn = planImageProviders({ HF_TOKEN: hfToken, HF_IMAGE_BILLING_CONFIRMED: 'true' })
ok(hfOn.active.join() === 'huggingface,pollinations', 'Hugging Face runs when the token and HF_IMAGE_BILLING_CONFIRMED=true are set')
ok(!planImageProviders({ HF_TOKEN: hfToken, HF_IMAGE_BILLING_CONFIRMED: '1' }).active.includes('huggingface'), 'only the exact value true confirms Hugging Face billing')
const hfUnlisted = planImageProviders({ IMAGE_PROVIDERS: 'pollinations', HF_TOKEN: hfToken, HF_IMAGE_BILLING_CONFIRMED: 'true' })
ok(!hfUnlisted.active.includes('huggingface') && hfUnlisted.gated.some((g) => g.name === 'huggingface'), 'confirmed Hugging Face stays off when it is not in IMAGE_PROVIDERS')

const listedUnconfirmed = planImageProviders({ IMAGE_PROVIDERS: 'gemini,pollinations', GEMINI_API_KEY: geminiKey })
ok(listedUnconfirmed.active.join() === 'pollinations', 'listing gemini without the billing flag does not activate it')
ok(listedUnconfirmed.skipped.some((s) => s.name === 'gemini' && s.reason.includes('GEMINI_IMAGE_BILLING_CONFIRMED')), 'unconfirmed gemini is skipped with the flag reason')
const confirmed = planImageProviders({ IMAGE_PROVIDERS: 'gemini', GEMINI_API_KEY: geminiKey, GEMINI_IMAGE_BILLING_CONFIRMED: 'true' })
ok(confirmed.active.join() === 'gemini', 'gemini runs when listed, keyed, and GEMINI_IMAGE_BILLING_CONFIRMED=true')
ok(planImageProviders({ IMAGE_PROVIDERS: 'gemini', GEMINI_IMAGE_BILLING_CONFIRMED: 'true' }).active.length === 0, 'the billing flag without a key does not call gemini')
ok(!planImageProviders({ GEMINI_API_KEY: geminiKey, GEMINI_IMAGE_BILLING_CONFIRMED: 'true' }).active.includes('gemini'), 'the billing flag does not add gemini to the default order')
ok(!planImageProviders({ IMAGE_PROVIDERS: 'gemini', GEMINI_API_KEY: geminiKey, GEMINI_IMAGE_BILLING_CONFIRMED: '1' }).active.includes('gemini'), 'only the exact value true confirms gemini billing')

ok(planImageProviders({ IMAGE_PROVIDERS: 'none', ...paidKeys }).active.length === 0, 'none selects nothing even if paid keys exist')
ok(planImageProviders({ IMAGE_PROVIDERS: '' }).active.length === 0, 'blank IMAGE_PROVIDERS selects nothing')
const optIn = planImageProviders({ IMAGE_PROVIDERS: 'openai,replicate', ...paidKeys })
ok(optIn.active.join() === 'openai,replicate', 'paid providers run only when listed and keyed')
ok(planImageProviders({ IMAGE_PROVIDERS: 'openai,replicate' }).active.length === 0, 'listed paid providers without keys are skipped')

const secret = 'sk-live-abcdefghijklmnopqrstuvwxyz'
const orgBody = { error: { message: `organization workgroup mismatch for key ${secret}`, type: 'invalid_request_error' } }

{
  const logs: string[] = []
  const seen: string[] = []
  const { fetch, calls } = mock(async (url) => {
    const host = new URL(url).host
    seen.push(host)
    if (url.includes('router.huggingface.co')) return json(401, { error: 'unauthorized' })
    if (url.includes('generativelanguage.googleapis.com')) throw new Error('gemini was called without confirmation')
    if (url.includes('image.pollinations.ai')) return bytes(png, 'image/jpeg')
    if (url.includes('api.openai.com') || url.includes('api.replicate.com')) throw new Error('paid host was called')
    throw new Error('unexpected ' + url)
  })
  const out = await generateImage('a red fox', {
    fetch,
    log: (l) => logs.push(l),
    env: { ...paidKeys, HF_TOKEN: hfToken, HF_IMAGE_BILLING_CONFIRMED: 'true', GEMINI_API_KEY: geminiKey, GEMINI_IMAGE_BILLING_CONFIRMED: 'true' }
  })
  ok(out.provider === 'pollinations' && out.mocked === false, 'falls through HF to Pollinations and skips unlisted Gemini')
  const order = seen.filter((host, i) => host !== seen[i - 1])
  ok(order.join() === 'router.huggingface.co,image.pollinations.ai', 'fallback order: ' + order.join())
  ok(calls.every((c) => !String(c.url).includes('generativelanguage') && !String(c.url).includes('api.openai.com') && !String(c.url).includes('api.replicate.com')), 'gemini and paid hosts are not called when unlisted')
  ok(logs.some((l) => l.startsWith('image provider huggingface failed:')), 'failures are logged with a short reason')
  const meta = await sharp(out.png).metadata()
  ok(meta.format === 'png' && meta.width === 8, 'output is normalized to png')
}

{
  const logs: string[] = []
  const { fetch, calls } = mock(async (url) => {
    if (url.includes('generativelanguage.googleapis.com')) return json(429, { error: { message: 'quota exceeded' } })
    if (url.includes('image.pollinations.ai')) return bytes(png, 'image/jpeg')
    throw new Error('unexpected ' + url)
  })
  const out = await generateImage('a red fox', {
    fetch,
    log: (l) => logs.push(l),
    env: { IMAGE_PROVIDERS: 'gemini,pollinations', GEMINI_API_KEY: geminiKey, GEMINI_IMAGE_BILLING_CONFIRMED: 'true' }
  })
  ok(out.provider === 'pollinations', 'confirmed gemini failure falls through to the next provider')
  const geminiCall = calls.find((c) => c.url.includes('generativelanguage'))!
  ok(geminiCall.url.includes('/models/gemini-2.5-flash-image:generateContent'), 'confirmed gemini uses gemini-2.5-flash-image')
  ok(!geminiCall.url.includes('AIza'), 'Gemini key stays out of the URL')
  ok((geminiCall.init?.headers as Record<string, string>)['x-goog-api-key'] === geminiKey, 'Gemini key is a header')
  ok(logs.some((l) => l.includes('quota exceeded')), 'gemini quota failure is logged')
}

{
  let called = false
  const { fetch } = mock(async () => { called = true; return bytes(png) })
  const out = await generateImage('a red fox', {
    fetch,
    env: { IMAGE_PROVIDERS: 'gemini', GEMINI_API_KEY: geminiKey }
  })
  ok(out.mocked === true && out.provider === 'placeholder' && !called, 'listed gemini without the billing flag makes no request')
}

{
  const { fetch, calls } = mock(async (url) => {
    if (url.includes('router.huggingface.co')) throw new Error('huggingface was called without confirmation')
    if (url.includes('image.pollinations.ai')) return bytes(png)
    throw new Error('unexpected ' + url)
  })
  const out = await generateImage('a red fox', { fetch, env: { HF_TOKEN: hfToken } })
  ok(out.provider === 'pollinations' && calls.every((c) => !c.url.includes('huggingface')), 'Hugging Face token without the billing flag makes no Hugging Face request')
}

{
  const logs: string[] = []
  const { fetch, calls } = mock(async (url) => {
    if (url.includes('api.openai.com')) return json(400, orgBody)
    if (url.includes('image.pollinations.ai')) return bytes(png)
    throw new Error('unexpected ' + url)
  })
  const out = await generateImage('a red fox', {
    fetch,
    log: (l) => logs.push(l),
    env: { IMAGE_PROVIDERS: 'openai,pollinations', OPENAI_API_KEY: secret }
  })
  ok(out.provider === 'pollinations', 'openai org error falls through to the next provider')
  ok(hosts(calls)[0] === 'api.openai.com/v1/images/generations', 'opted-in openai is called first')
  const body = JSON.parse(String(calls[0].init?.body))
  ok(body.model === 'gpt-image-1' && body.prompt === 'a red fox', 'openai images request uses gpt-image-1')
  const joined = logs.join('\n')
  ok(joined.includes('workgroup') && joined.includes('image provider openai failed:'), 'org/workgroup failure is logged')
  ok(!joined.includes(secret) && !joined.includes('sk-live'), 'logs do not contain the key')
}

{
  const logs: string[] = []
  const { fetch } = mock(async (url) => {
    if (url.includes('router.huggingface.co')) return json(503, { error: 'model not found' })
    if (url.includes('generativelanguage')) return json(403, { error: { message: 'billing disabled for AIzaShouldNotLeak0001234567' } })
    if (url.includes('image.pollinations.ai')) return json(402, { error: 'rate limited' })
    throw new Error('unexpected ' + url)
  })
  let message = ''
  try {
    await generateImage('a red fox', {
      fetch,
      log: (l) => logs.push(l),
      env: {
        IMAGE_PROVIDERS: 'huggingface,gemini,pollinations',
        HF_TOKEN: 'hf_shouldnotleaktoken0001',
        HF_IMAGE_BILLING_CONFIRMED: 'true',
        GEMINI_API_KEY: 'AIzaShouldNotLeak0001234567',
        GEMINI_IMAGE_BILLING_CONFIRMED: 'true'
      }
    })
  } catch (e: any) { message = e.message }
  ok(message.startsWith('Image generation failed. Tried huggingface'), 'all-fail message names huggingface: ' + message)
  ok(message.includes('gemini') && message.includes('pollinations'), 'all-fail message names every provider tried')
  ok(message.includes('model not found') && message.includes('rate limited'), 'all-fail message keeps the short reasons')
  ok(!message.includes('hf_shouldnotleak') && !message.includes('AIzaShouldNotLeak') && !logs.join('\n').includes('AIzaShouldNotLeak'), 'error text and logs omit keys')
  ok(!message.includes('openai') && !message.includes('replicate'), 'untried paid providers are not blamed')
  const redacted = redactSecrets(`token hf_shouldnotleaktoken0001 and ${secret}`, { HF_TOKEN: 'hf_shouldnotleaktoken0001', OPENAI_API_KEY: secret })
  ok(redacted === 'token [redacted] and [redacted]', 'redactSecrets strips env values: ' + redacted)
  ok(failureMessage([{ name: 'huggingface', reason: '401 unauthorized' }]).includes('huggingface (401 unauthorized)'), 'failureMessage shape')
}

{
  let called = false
  const { fetch } = mock(async () => { called = true; return bytes(png) })
  const out = await generateImage('offline', { fetch, env: { IMAGE_PROVIDERS: 'none', OPENAI_API_KEY: secret, REPLICATE_API_TOKEN: 'r8_testreplicatetoken0001' } })
  ok(out.mocked === true && out.provider === 'placeholder' && !called, 'none returns a placeholder and makes no request')
  const meta = await sharp(out.png).metadata()
  ok(meta.format === 'png' && meta.width === 1024, 'placeholder is a png')
}

{
  const { fetch, calls } = mock(async (url, init) => {
    if (url.endsWith('/sdapi/v1/txt2img')) {
      const body = JSON.parse(String(init?.body))
      if (body.prompt !== 'local fox') throw new Error('bad prompt')
      return json(200, { images: [b64] })
    }
    throw new Error('unexpected ' + url)
  })
  const out = await generateImage('local fox', { fetch, env: { IMAGE_PROVIDERS: 'local', LOCAL_IMAGE_URL: 'http://127.0.0.1:7860' } })
  ok(out.provider === 'local' && out.model === 'a1111' && calls.length === 1, 'local Automatic1111 is used when configured')
}

{
  const { fetch, calls } = mock(async (url) => {
    if (url.endsWith('/prompt')) return json(200, { prompt_id: 'job1' })
    if (url.endsWith('/history/job1')) return json(200, { job1: { outputs: { '9': { images: [{ filename: 'nodular_1.png', subfolder: '', type: 'output' }] } } } })
    if (url.includes('/view?')) return bytes(png)
    throw new Error('unexpected ' + url)
  })
  const out = await generateImage('comfy fox', {
    fetch,
    env: { IMAGE_PROVIDERS: 'local', LOCAL_IMAGE_URL: 'http://127.0.0.1:8188', LOCAL_IMAGE_KIND: 'comfy' }
  })
  ok(out.provider === 'local' && out.model === 'sd_xl_base_1.0.safetensors' && calls.length === 3, 'local ComfyUI prompt/history/view')
}

{
  const { fetch, calls } = mock(async (url) => {
    if (url.includes('/v1/images/generations')) return json(200, { data: [{ b64_json: b64 }] })
    throw new Error('unexpected ' + url)
  })
  const out = await generateImage('ollama fox', {
    fetch,
    env: { IMAGE_PROVIDERS: 'local', LOCAL_IMAGE_URL: 'http://127.0.0.1:11434', LOCAL_IMAGE_KIND: 'ollama' }
  })
  ok(out.model === 'local-openai' && calls[0].url === 'http://127.0.0.1:11434/v1/images/generations', 'ollama-adjacent local endpoint')
}

{
  let called = false
  const { fetch } = mock(async () => { called = true; return bytes(png) })
  let message = ''
  try {
    await generateImage('nope', { fetch, log: () => {}, env: { IMAGE_PROVIDERS: 'local', LOCAL_IMAGE_URL: 'https://api.openai.com/v1', OPENAI_API_KEY: secret } })
  } catch (e: any) { message = e.message }
  ok(!called && message.includes('local') && message.includes('paid host'), 'local refuses api.openai.com: ' + message)
}

{
  const { fetch, calls } = mock(async (url) => {
    if (url.includes('api.replicate.com')) return json(201, { status: 'succeeded', output: ['https://cdn.example/out.png'] })
    if (url === 'https://cdn.example/out.png') return bytes(png)
    throw new Error('unexpected ' + url)
  })
  const out = await generateImage('rep fox', {
    fetch,
    env: { IMAGE_PROVIDERS: 'replicate', REPLICATE_API_TOKEN: 'r8_testreplicatetoken0001' }
  })
  ok(out.provider === 'replicate' && calls[0].url.includes('/models/black-forest-labs/flux-schnell/predictions'), 'replicate runs only when listed')
  const missed = planImageProviders({ REPLICATE_API_TOKEN: 'r8_testreplicatetoken0001' })
  ok(!missed.active.includes('replicate'), 'replicate token alone does not enter the default chain')
}

{
  const { fetch, calls } = mock(async (url) => {
    if (url.includes('FLUX.1-schnell')) return json(404, { error: 'model not available' })
    if (url.includes('stable-diffusion-xl-base-1.0')) return bytes(png)
    throw new Error('unexpected ' + url)
  })
  const out = await generateImage('hf fox', { fetch, env: { IMAGE_PROVIDERS: 'huggingface', HF_TOKEN: hfToken, HF_IMAGE_BILLING_CONFIRMED: 'true' } })
  ok(out.provider === 'huggingface' && out.model?.includes('stable-diffusion-xl'), 'Hugging Face tries SDXL after FLUX fails')
  ok(calls.length === 2, 'both HF models were requested')
}

{
  const savedToken = process.env.REPLICATE_API_TOKEN
  const savedFlag = process.env.ENABLE_PAID_REPLICATE
  const savedFetch = globalThis.fetch
  const tiny = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#336699' } }).png().toBuffer()
  const restore = () => {
    globalThis.fetch = savedFetch
    if (savedToken === undefined) delete process.env.REPLICATE_API_TOKEN
    else process.env.REPLICATE_API_TOKEN = savedToken
    if (savedFlag === undefined) delete process.env.ENABLE_PAID_REPLICATE
    else process.env.ENABLE_PAID_REPLICATE = savedFlag
  }
  try {
    process.env.REPLICATE_API_TOKEN = 'r8_testreplicatetoken0001'
    delete process.env.ENABLE_PAID_REPLICATE
    let called = false
    globalThis.fetch = (async () => { called = true; throw new Error('replicate must not be called') }) as typeof fetch
    const resized = await runUpscaler(tiny, 2)
    const meta = await sharp(resized.png).metadata()
    ok(resized.engine === 'sharp-lanczos3' && resized.kind === 'resize' && !called && meta.width === 16, `token alone stays a sharp resize (${resized.engine}, calls ${called})`)

    process.env.ENABLE_PAID_REPLICATE = 'true'
    called = false
    const word = await runUpscaler(tiny, 2)
    ok(word.engine === 'sharp-lanczos3' && word.kind === 'resize' && !called, 'ENABLE_PAID_REPLICATE must be the exact value 1')

    delete process.env.REPLICATE_API_TOKEN
    process.env.ENABLE_PAID_REPLICATE = '1'
    called = false
    const flagOnly = await runUpscaler(tiny, 2)
    ok(flagOnly.kind === 'resize' && !called, 'ENABLE_PAID_REPLICATE=1 without a token stays local')

    process.env.REPLICATE_API_TOKEN = 'r8_testreplicatetoken0001'
    process.env.ENABLE_PAID_REPLICATE = '1'
    const urls: string[] = []
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url)
      urls.push(u)
      if (u.includes('api.replicate.com')) return json(201, { status: 'succeeded', output: 'https://cdn.example/up.png' })
      if (u.includes('cdn.example/up.png')) return bytes(png)
      throw new Error('unexpected ' + u)
    }) as typeof fetch
    const paid = await runUpscaler(tiny, 2)
    ok(paid.engine === 'replicate-real-esrgan' && paid.kind === 'ai-upscale' && urls.some((u) => u.includes('api.replicate.com') && u.includes('nightmareai/real-esrgan')), 'ENABLE_PAID_REPLICATE=1 plus the token calls Real-ESRGAN')
  } finally {
    restore()
  }
}

console.log(failed ? `\n${failed} failed` : '\nimage provider tests ok')
process.exit(failed ? 1 : 0)
