import sharp from 'sharp'

const BASE = process.env.BASE_URL || 'http://localhost:3001'
const fail = (m) => { console.error('FAIL:', m); process.exit(1) }
const post = (path, buf, name = 'image.png') => {
  const fd = new FormData()
  fd.append('file', new Blob([buf], { type: 'image/png' }), name)
  return fetch(BASE + path, { method: 'POST', body: fd })
}

const llama = await fetch(BASE + '/api/llama', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: 'mirror selfie, vintage denim' })
})
if (!llama.ok) fail('llama ' + llama.status)
console.log('1 llama ok')

const flux = await fetch(BASE + '/api/flux', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: 'mirror selfie, vintage denim' })
})
if (!flux.ok) fail('flux ' + flux.status)
console.log('2 flux ok', flux.headers.get('content-type'))

// Subject on white background so removal has something to cut out
const subject = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#ffffff' } })
  .composite([{ input: await sharp({ create: { width: 120, height: 160, channels: 3, background: '#c0392b' } }).png().toBuffer(), left: 68, top: 48 }])
  .png().toBuffer()

const rem = await post('/api/remover', subject)
if (!rem.ok) fail('remover ' + rem.status)
const removed = Buffer.from(await rem.arrayBuffer())
const meta = await sharp(removed).metadata()
if (!meta.hasAlpha) fail('remover output has no alpha')
const { data } = await sharp(removed).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
let transparent = 0
for (let i = 3; i < data.length; i += 4) if (data[i] < 255) transparent++
console.log('3 remover ok', rem.headers.get('x-remover'), 'transparent px:', transparent)
if (transparent === 0) fail('no transparent pixels')

const up = await post('/api/upscaler', removed)
if (!up.ok) fail('upscaler ' + up.status)
const um = await sharp(Buffer.from(await up.arrayBuffer())).metadata()
if (um.width !== meta.width * 4) fail(`upscale width ${um.width} != ${meta.width * 4}`)
console.log('4 upscaler ok', up.headers.get('x-upscale-from'), '->', up.headers.get('x-upscale-to'))

const rea = await fetch(BASE + '/api/rea/suggest', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ nodes: [{ id: 'a', type: 'llama', data: {} }], edges: [] })
})
if (!rea.ok) fail('rea ' + rea.status)
console.log('5 rea ok', JSON.stringify(await rea.json()).slice(0, 120))

// --- Persisted workflow, deploy, and keyed run (full 5-node chain server-side) ---
const nodes = [
  { id: '1', type: 'llama-groq', data: { prompt: 'mirror selfie, vintage denim' } },
  { id: '2', type: 'flux-schnell', data: {} },
  { id: '3', type: 'remover-birefnet', data: {} },
  { id: '4', type: 'upscaler-realesrgan', data: { scale: 4 } },
  { id: '5', type: 'html-preview', data: {} }
]
const edges = [['1', '2'], ['2', '3'], ['3', '4'], ['4', '5']].map(([source, target]) => ({ id: `e${source}-${target}`, source, target }))
const json = { 'Content-Type': 'application/json' }
const created = await (await fetch(BASE + '/api/workflows', { method: 'POST', headers: json, body: JSON.stringify({ name: 'test-chain', nodes, edges }) })).json()
if (!created.id) fail('create workflow ' + JSON.stringify(created))
const listed = await (await fetch(BASE + '/api/workflows')).json()
if (!listed.some((w) => w.id === created.id)) fail('workflow not persisted')
const dep = await (await fetch(BASE + `/api/workflows/${created.id}/deploy`, { method: 'POST' })).json()
if (!dep.apiKey?.startsWith('nk_') || !dep.curl.includes('x-api-key')) fail('deploy ' + JSON.stringify(dep))
console.log('6 deploy ok', dep.fullUrl)

const bad = await fetch(dep.fullUrl, { method: 'POST', headers: { ...json, 'x-api-key': 'nk_wrong' }, body: '{}' })
if (bad.status !== 401) fail('bad key should be 401, got ' + bad.status)

const run = await fetch(dep.fullUrl, { method: 'POST', headers: { ...json, 'x-api-key': dep.apiKey }, body: JSON.stringify({ prompt: 'product shot of a sneaker' }) })
const runBody = await run.json()
if (!run.ok || runBody.status !== 'success') fail('run ' + JSON.stringify(runBody))
const finalImg = Buffer.from(await (await fetch(runBody.imageUrl)).arrayBuffer())
const fm = await sharp(finalImg).metadata()
if (fm.width !== 4096) fail('final image width ' + fm.width)
if (!runBody.html) fail('missing html')
console.log('7 deployed run ok', `${fm.width}x${fm.height}`, runBody.durationMs + 'ms')

const runs = await (await fetch(BASE + `/api/runs?workflowId=${created.id}`)).json()
if (!runs.length) fail('run not persisted')
console.log('8 run history ok')
console.log('ALL PASSED')
