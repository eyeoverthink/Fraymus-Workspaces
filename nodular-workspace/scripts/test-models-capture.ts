import assert from 'node:assert/strict'
import { captureScreenshot, browserUrl } from '../src/lib/screen-capture'

assert.equal(browserUrl('https://example.com/a', 'http://localhost:5173'), 'https://example.com/a')
for (const value of ['javascript:alert(1)', 'http://example.com', 'https://user:pass@example.com', 'https://app.test/a']) {
  assert.throws(() => browserUrl(value, 'https://app.test'))
}
console.log('PASS browser navigation permits HTTPS only, rejects credentials and embedding this app')

const originalFetch = globalThis.fetch
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
let mode: 'success' | 'deny' | 'encode-fail' | 'abort' = 'success'
let stopped = 0, calls = 0
const controller = new AbortController()
const stream = { getTracks: () => [{ stop: () => { stopped++ } }] }
const context = { drawImage: () => {} }
Object.defineProperty(globalThis, 'window', { configurable: true, value: { isSecureContext: true } })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: {
  getDisplayMedia: async (options: unknown) => {
    calls++
    assert.deepEqual(options, { video: true, audio: false })
    if (mode === 'deny') throw new DOMException('Permission denied', 'NotAllowedError')
    return stream
  }
} } })
Object.defineProperty(globalThis, 'document', { configurable: true, value: {
  createElement: (tag: string) => tag === 'canvas' ? {
    width: 0, height: 0, getContext: () => context,
    toBlob: (callback: (blob: Blob | null) => void) => callback(mode === 'encode-fail' ? null : new Blob(['synthetic-test-frame'], { type: 'image/jpeg' }))
  } : {
    muted: false, srcObject: null, videoWidth: 3840, videoHeight: 2160,
    onloadeddata: null as null | (() => void),
    pause: () => {},
    play() { queueMicrotask(() => { if (mode === 'abort') controller.abort(); else this.onloadeddata?.() }); return Promise.resolve() }
  }
} })
try {
  globalThis.fetch = async () => { throw new Error('Screen capture must never upload a frame') }
  const file = await captureScreenshot(new AbortController().signal)
  assert.equal(file.type, 'image/jpeg')
  assert.equal(stopped, 1)
  mode = 'deny'
  await assert.rejects(() => captureScreenshot(new AbortController().signal), /Permission denied/)
  assert.equal(stopped, 1)
  mode = 'encode-fail'
  await assert.rejects(() => captureScreenshot(new AbortController().signal), /encode/)
  assert.equal(stopped, 2)
  mode = 'abort'
  await assert.rejects(() => captureScreenshot(controller.signal), /cancelled/)
  assert(stopped >= 3)
  const cancelled = new AbortController(); cancelled.abort()
  await assert.rejects(() => captureScreenshot(cancelled.signal), /cancelled/)
  assert.equal(calls, 5)
  console.log('PASS synthetic capture tests: no audio or uploads, permission denial visible, and tracks stop on success/failure/abort')
} finally {
  globalThis.fetch = originalFetch
  for (const [name, descriptor] of [['window', originalWindow], ['navigator', originalNavigator], ['document', originalDocument]] as const) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
}

process.env.LLM_PROVIDERS = 'ollama'
process.env.OLLAMA_MODEL = 'test-text'
process.env.IDEA_MODEL = 'ollama:test-text'
process.env.IDEA_VISION_MODEL = 'ollama:test-vision'
const { modelDiagnostics, testConfiguredModels } = await import('../server/agent/models')
let failing = false, empty = false, visionCalls = 0
globalThis.fetch = async (input, init) => {
  const url = String(input)
  if (failing) return Response.json({ error: 'test failure' }, { status: 503 })
  if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: 'test-text', size: 12 }, { name: 'test-vision', size: 12 }] })
  if (url.endsWith('/api/show')) {
    const body = JSON.parse(String(init?.body))
    return Response.json({ capabilities: body.model === 'test-vision' ? ['completion', 'vision'] : ['completion', 'tools'] })
  }
  if (url.endsWith('/api/chat')) {
    if (empty) return Response.json({ message: { content: '' }, done_reason: 'length' })
    const body = JSON.parse(String(init?.body))
    if (body.model === 'test-vision') {
      visionCalls++; assert(body.messages[0].images[0]); assert.equal(body.think, false)
      return Response.json({ message: { content: 'red' } })
    }
    if (body.tools) return Response.json({ message: { content: '', tool_calls: [{ function: { name: 'model_setup_probe', arguments: { value: 'READY' } } }] } })
    assert(body.format.properties.ready)
    return Response.json({ message: { content: '{"ready":true}' } })
  }
  throw new Error(`Unexpected request: ${url}`)
}
try {
  const diagnostics = await modelDiagnostics()
  assert.equal(diagnostics.ollama.reachable, true)
  assert.equal(diagnostics.ollama.checks.length, 2)
  assert(!JSON.stringify(diagnostics).includes('Authorization'))
  const live = await testConfiguredModels()
  assert.equal(live.ok, true)
  assert.equal(visionCalls, 1)
  empty = true
  const truncated = await testConfiguredModels()
  assert.equal(truncated.ok, false)
  assert(truncated.results.every((result) => result.error?.includes('no text or tool calls')))
  empty = false
  failing = true
  const failed = await testConfiguredModels()
  assert.equal(failed.ok, false)
  assert(failed.results.every((result) => !result.ok && result.error))
  assert.equal((await modelDiagnostics()).ollama.reachable, false)
  process.env.IDEA_VISION_MODEL = ''
  assert.equal((await testConfiguredModels()).results[2].error, 'IDEA_VISION_MODEL is not configured')
  console.log('PASS provider-mocked diagnostics/test routes distinguish installation, real response shape, missing vision and failed inference')
} finally { globalThis.fetch = originalFetch }
