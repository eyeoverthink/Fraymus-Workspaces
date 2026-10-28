import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

const dir = mkdtempSync(join(tmpdir(), 'nodular-mega-'))
process.env.DATA_DIR = dir
process.env.LLM_PROVIDERS = 'none'
const { db } = await import('../server/agent/db')
const { createStore } = await import('../server/store')
const { registerTools } = await import('../server/agent/tools')
const { initAgents, callToolDirect, requestToolApproval, decideApproval, getThread } = await import('../server/agent/runtime')
const { createMegaPack, getMegaPack, listMegaPacks, registerMegaTools } = await import('../server/agent/mega')
const store = await createStore()
initAgents(store); registerMegaTools()
const brief = 'A small bakery needs a checklist for tracking pickup orders. Test whether a reviewable assistant saves duplicate entry. Do not promise income.'
try {
  await assert.rejects(() => createMegaPack('a', { transcript: 'short', audience: 'bakery' }), /20/)
  await assert.rejects(() => createMegaPack('a', { transcript: brief, audience: 'bakery', useAi: true }), /permission/)
  const pack = await createMegaPack('a', { transcript: brief, audience: 'bakery <script>alert(1)</script>', variants: 100 })
  assert.equal(pack.status, 'draft')
  assert.equal(pack.generation.mode, 'local-template')
  assert.equal(pack.cards.length, 10)
  assert.equal(pack.variants.length, 100)
  assert.equal(new Set(pack.variants.map((item) => `${item.hook}:${item.cta}`)).size, 100)
  assert(pack.variants.every((item) => item.status === 'draft-not-rendered'))
  const png = await sharp(readFileSync(join(dir, 'mega', pack.id, '0.png'))).metadata()
  assert.equal(png.width, 1080); assert.equal(png.height, 1920)
  assert(!pack.composition!.includes('<script>alert(1)</script>'))
  assert.equal(getMegaPack('b', pack.id), null)
  assert.equal(listMegaPacks('b').length, 0)
  assert.equal(listMegaPacks('a').length, 1)
  assert(pack.stages.some((stage) => stage.step === 'voice' && stage.status === 'unavailable'))
  assert(pack.stages.some((stage) => stage.step === 'video-render' && stage.status === 'not_requested'))
  console.log('PASS native packs persist 10 actual portrait PNGs, 100 real combinations and honest non-rendered/unavailable stages; owners isolated')
  await assert.rejects(() => createMegaPack('a', { transcript: brief, audience: 'bakery', useAi: true, allowModel: true }), /real model/)
  assert(listMegaPacks('a').some((item) => item.status === 'failed' && item.error))
  await assert.rejects(() => callToolDirect('a', 'mega_create_pack', { transcript: brief, audience: 'bakery' }), /approval/)
  await assert.rejects(() => callToolDirect('a', 'mega_render_video', { id: pack.id }), /approval/)
  let renders = 0, failRender = false
  registerTools([{ name: 'hyperframes_render', risk: 'approval', description: 'test-only mock renderer', parameters: {}, run: async (args) => {
    renders++; assert.equal(args.html, pack.composition); assert.equal(args.resolution, 'portrait')
    if (failRender) throw new Error('Chrome unavailable (synthetic failure)')
    return { mediaUrl: '/outputs/test-only-mock.mp4', bytes: 42 }
  } }])
  const rejected = requestToolApproval('a', 'morgan_content_engine', 'mega_render_video', { id: pack.id }, 'Render exact saved pack')
  assert.equal(getThread('a', rejected.threadId)?.run.status, 'awaiting_approval')
  assert.equal(renders, 0)
  await assert.rejects(() => decideApproval('b', rejected.approvalId, true), /not found/)
  await decideApproval('a', rejected.approvalId, false)
  assert.equal(renders, 0)
  assert.equal(getThread('a', rejected.threadId)?.run.status, 'done')
  const approved = requestToolApproval('a', 'morgan_content_engine', 'mega_render_video', { id: pack.id }, 'Render exact saved pack')
  await decideApproval('a', approved.approvalId, true)
  assert.equal(renders, 1)
  assert.equal(getMegaPack('a', pack.id)?.render?.status, 'done')
  assert.equal(getThread('a', approved.threadId)?.run.status, 'done')
  await assert.rejects(() => decideApproval('a', approved.approvalId, true), /already decided/)
  assert.equal(renders, 1)
  failRender = true
  const failing = requestToolApproval('a', 'morgan_content_engine', 'mega_render_video', { id: pack.id }, 'Render exact saved pack')
  await decideApproval('a', failing.approvalId, true)
  assert.equal(getMegaPack('a', pack.id)?.render?.status, 'failed')
  assert.equal(getThread('a', failing.threadId)?.run.status, 'error')
  console.log('PASS mock renderer cannot run before approval, across users, after rejection or twice; failures persist, and manual actions do not invoke an LLM')
} finally {
  store.close?.()
  db.close()
  rmSync(dir, { recursive: true, force: true })
}
