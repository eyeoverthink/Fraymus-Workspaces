// Validates the code-explainer workflow, manifests, and tools.
// Unit checks import the workflow module directly. Tool registration is checked against a running server (BASE_URL).
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { parseManifest } from '../server/agent/manifest.ts'
import {
  canReadSkill, evaluateQa, loadWorkflow, lookupAssets, nextStep, readSkill, recordLearning, type PublicStep
} from '../server/agent/explainer-workflow.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const base = process.env.BASE_URL || process.env.BASE || ''
const PHRASE = 'gray plastic'
let failed = 0
const ok = (c: unknown, m: string) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) failed++ }
const throws = (fn: () => unknown, m: string) => {
  try { fn(); ok(false, m) } catch { ok(true, m) }
}

const httpTools = JSON.parse(readFileSync(join(root, 'config/http-tools.json'), 'utf8')) as { name: string; description: string; url?: string; headers?: Record<string, string> }[]
const known = new Set([
  'memory_save', 'memory_search', 'web_search', 'http_get', 'generate_image', 'remove_background',
  'upscale_image', 'list_workflows', 'run_workflow', 'delegate_to_agent', 'hyperframes_render',
  'explainer_next_step', 'explainer_qa', 'asset_lookup', 'explainer_learn', 'read_explainer_skill',
  ...httpTools.map((d) => d.name)
])
const wild = (t: string) => /^[\w-]+\*$/.test(t) || /^[\w-]+__\*$/.test(t)
const publicKeys = new Set(['step', 'kind', 'instruction', 'agent', 'tool', 'quality', 'review', 'waitForHuman', 'stub', 'optional', 'candidates', 'notSufficient'])

const agentFiles = readdirSync(join(root, 'agents')).filter((f) => f.endsWith('.md'))
const ids: string[] = []
for (const file of agentFiles) {
  const stem = file.slice(0, -3)
  const text = readFileSync(join(root, 'agents', file), 'utf8')
  const def = parseManifest(text, stem)
  ids.push(def.id)
  ok(def.id === stem && /^[a-z][a-z0-9_]{0,40}$/.test(def.id), `${stem} id matches filename`)
  const body = text.replace(/^---[\s\S]*?---\r?\n?/, '').trim()
  ok(body.length > 40 && body.length <= 8000 && def.systemPrompt === body, `${stem} prompt is stored whole`)
  if (def.tools !== '*') for (const t of def.tools) ok(wild(t) || known.has(t), `${stem} tool ${t} is real or a stub name`)
}
for (const id of ['explainer_orchestrator', 'explainer_researcher', 'explainer_planner', 'scene_builder_express', 'scene_builder_standard', 'scene_builder_studio']) {
  ok(ids.includes(id), `ships ${id}`)
}
const planner = parseManifest(readFileSync(join(root, 'agents/explainer_planner.md'), 'utf8'))
const runner = parseManifest(readFileSync(join(root, 'agents/explainer_orchestrator.md'), 'utf8'))
ok(planner.tools !== '*' && planner.tools.includes('read_explainer_skill'), 'planner can read the skill')
ok(runner.tools !== '*' && !runner.tools.includes('read_explainer_skill'), 'orchestrator cannot read the skill')
for (const id of ['scene_builder_express', 'scene_builder_standard', 'scene_builder_studio', 'explainer_researcher']) {
  const text = readFileSync(join(root, 'agents', id + '.md'), 'utf8')
  ok(!text.includes(PHRASE) && !/\b720\b|\b1400\b/.test(text), `${id} manifest has no skill body or thresholds`)
}

const wfFile = JSON.parse(readFileSync(join(root, 'workflows/code-explainer-60s/workflow.json'), 'utf8'))
ok(wfFile.id === 'code-explainer-60s' && wfFile.humanGates.join() === 'pick_hook', 'one human gate')
ok(typeof wfFile.unattended === 'string' && wfFile.unattended.includes('automation'), 'not an unattended automation')
loadWorkflow()
ok(readSkill().includes(PHRASE), 'skill file is readable by the module')

const leak = (step: PublicStep, label: string) => {
  const blob = JSON.stringify(step)
  ok(Object.keys(step).every((k) => publicKeys.has(k)), `${label} public keys`)
  ok(!blob.includes(PHRASE) && !blob.includes('Do not schedule') && !/\b720\b|\b1400\b|0\.08|-20/.test(blob), `${label} hides skill and thresholds`)
}
const entry = nextStep({})
ok(entry.step === 'research_script' && entry.agent === 'explainer_researcher', 'entry is research')
leak(entry, 'entry')
for (const s of wfFile.steps) {
  const pub = s.id === 'qa'
    ? nextStep({ from: 'qa', qa: 'pass', rendered: true, tier: 'express' })
    : nextStep({ from: s.id, hookChosen: true, tier: 'express', rendered: true, wantRealism: false })
  leak(pub, s.id)
}

ok(nextStep({ from: 'research_script' }).waitForHuman === true && nextStep({ from: 'research_script' }).step === 'pick_hook', 'research stops at the hook gate')
ok(nextStep({ from: 'pick_hook' }).step === 'pick_hook', 'gate holds until a hook is chosen')
const voice = nextStep({ from: 'pick_hook', hookChosen: true })
ok(voice.step === 'voiceover' && voice.notSufficient?.includes('speak') && voice.candidates?.includes('elevenlabs_word_timestamps'), 'voiceover requires word times')
ok(nextStep({ from: 'voiceover' }).agent === 'explainer_planner', 'planner follows voiceover')
const expressBuild = nextStep({ from: 'assets', tier: 'express' })
ok(expressBuild.step === 'build' && expressBuild.agent === 'scene_builder_express' && expressBuild.review === 'once', 'express builder')
ok(nextStep({ from: 'assets', tier: 'standard' }).agent === 'scene_builder_standard' && nextStep({ from: 'assets', tier: 'standard' }).review === 'per_scene', 'standard builder')
ok(nextStep({ from: 'assets', tier: 'studio' }).agent === 'scene_builder_studio', 'studio builder')
ok(nextStep({ from: 'build', tier: 'express' }).quality === 'draft' && nextStep({ from: 'preview', tier: 'express' }).quality === 'delivery', 'express previews then delivers')
ok(nextStep({ from: 'preview', tier: 'standard' }).step === 'qa', 'standard reviews before the delivery render')
const again = nextStep({ from: 'qa', tier: 'standard', qa: 'fail' })
ok(again.step === 'build' && again.agent === 'scene_builder_standard', 'failed QA returns to the builder')
ok(nextStep({ from: 'qa', tier: 'standard', qa: 'pass', scenesLeft: 2, rendered: false }).step === 'build', 'per-scene pass builds the next scene')
ok(nextStep({ from: 'qa', tier: 'standard', qa: 'pass', scenesLeft: 0, rendered: false }).step === 'render', 'last scene pass goes to delivery')
ok(nextStep({ from: 'qa', tier: 'express', qa: 'pass', rendered: true }).step === 'learn', 'passing delivery is learned')
ok(nextStep({ from: 'qa', tier: 'express', qa: 'override', rendered: false }).step === 'learn', 'explicit override skips to learn')
ok(nextStep({ from: 'learn', wantRealism: false }).step === 'output', 'default finish skips realism')
const realism = nextStep({ from: 'learn', wantRealism: true })
ok(realism.step === 'realism' && realism.stub === true && realism.optional === true, 'realism is an optional stub')
ok(nextStep({ from: 'realism' }).step === 'output' && nextStep({ from: 'output' }).step === 'output', 'output ends the run')
throws(() => nextStep({ tier: 'ultra' }), 'unknown tier rejected')
throws(() => nextStep({ from: 'nope' }), 'unknown step rejected')
throws(() => nextStep({ from: 'qa', tier: 'express', rendered: true }), 'leaving QA without a status rejected')
throws(() => nextStep({ from: 'qa', qa: 'maybe' }), 'bad QA status rejected')

const rules = JSON.parse(readFileSync(join(root, 'workflows/code-explainer-60s/qa-rules.json'), 'utf8')).rules as { min?: number; max?: number }[]
const needles = rules.flatMap((r) => [r.min, r.max]).filter((n): n is number => typeof n === 'number' && String(n).replace('-', '').length >= 2).map(String)
const hidden = (v: unknown) => {
  const blob = JSON.stringify(v)
  return needles.every((n) => !blob.includes(n)) && Object.keys(v as object).sort().join() === 'fixes,status'
}
const good = { cameraSpeedPxPerSec: 400, stillFrameMs: 800, colorStrength: 0.5, loudnessLufs: -16, flicker: 0.02, mobileReadability: 0.9 }
const dir = mkdtempSync(join(tmpdir(), 'explainer-qa-'))
const pass = evaluateQa(good, dir)
ok(pass.status === 'pass' && pass.fixes.length === 0 && hidden(pass), 'in-range measurements pass with no thresholds')
const fast = evaluateQa({ ...good, cameraSpeedPxPerSec: 5000 }, dir)
ok(fast.status === 'fail' && fast.fixes.length === 1 && hidden(fast) && /camera/i.test(fast.fixes[0]), 'fast camera fails closed')
const missing = evaluateQa({}, dir)
ok(missing.status === 'fail' && missing.fixes.length === 6 && hidden(missing), 'missing measurements fail closed')
ok(evaluateQa({ ...good, cameraSpeedPxPerSec: '400' }, dir).status === 'fail', 'string measurements are not numbers')
ok(evaluateQa(null, dir).status === 'fail', 'empty QA input fails')

const learned = recordLearning({
  videoId: 'vid1', topic: 'flat earth', tier: 'express', mediaUrl: '/outputs/vid1.mp4',
  corrections: [{ metric: 'cameraSpeedPxPerSec', max: 100, fix: 'Hold the camera stiller than the last approved cut.' }]
}, dir)
ok(learned.saved && learned.rulesAdded === 1 && learned.referenceCount === 1 && !JSON.stringify(learned).includes('100'), 'learn stores a reference without echoing the bound')
ok(evaluateQa({ ...good, cameraSpeedPxPerSec: 200 }, dir).status === 'fail', 'a learned bound can tighten')
ok(hidden(evaluateQa({ ...good, cameraSpeedPxPerSec: 200 }, dir)), 'tightened failure still hides numbers')
ok(evaluateQa({ ...good, cameraSpeedPxPerSec: 50 }, dir).status === 'pass', 'a value under the learned bound passes')
const looseDir = mkdtempSync(join(tmpdir(), 'explainer-loose-'))
recordLearning({ videoId: 'vid2', topic: 'orbits', corrections: [{ metric: 'cameraSpeedPxPerSec', max: 5000, fix: 'Allow a faster move.' }] }, looseDir)
ok(evaluateQa({ ...good, cameraSpeedPxPerSec: 600 }, looseDir).status === 'pass', 'a looser correction does not raise the shipped ceiling')
ok(evaluateQa({ ...good, cameraSpeedPxPerSec: 800 }, looseDir).status === 'fail', 'shipped ceiling still fails a faster camera')
throws(() => recordLearning({ videoId: 'v', topic: 't', mediaUrl: '/outputs/../secret.mp4' }, dir), 'mediaUrl cannot climb out of outputs')
throws(() => recordLearning({ videoId: 'v', topic: 't', mediaUrl: 'file:///etc/passwd' }, dir), 'mediaUrl cannot be a file URL')

const found = lookupAssets('earth')
ok(found.placeholderCatalog === true && found.matches.some((a) => a.id === 'example-globe' && a.status === 'not_a_file' && /STUB/.test(a.note)), 'catalog match is a placeholder')
ok(lookupAssets('zzznone').matches.length === 0, 'unknown asset is a miss, not a download')
ok(!canReadSkill('concierge') && !canReadSkill('scene_builder_express') && !canReadSkill('explainer_orchestrator'), 'skill guard refuses other agents')
ok(canReadSkill('explainer_planner') && canReadSkill('mcp'), 'planner and admin direct-call may read the skill')

const secret = /sk_live_|AKIA[0-9A-Z]{16}|xi-api-key['":\s]+[A-Za-z0-9]{8,}|Bearer [A-Za-z0-9_\-]{20,}/
for (const rel of ['workflows/code-explainer-60s/workflow.json', 'workflows/code-explainer-60s/skill.md', 'workflows/code-explainer-60s/qa-rules.json', 'workflows/code-explainer-60s/assets.json', 'config/http-tools.json', '.env.example']) {
  ok(!secret.test(readFileSync(join(root, rel), 'utf8')), `${rel} has no secret`)
}
for (const name of ['elevenlabs_word_timestamps', 'asset_library_fetch', 'realism_pass']) {
  ok(/STUB/.test(httpTools.find((d) => d.name === name)?.description || ''), `${name} is labeled STUB`)
}

async function api(method: string, path: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, body: await r.json().catch(() => null) as any }
}
async function until(threadId: string) {
  for (let i = 0; i < 60; i++) {
    const t = await api('GET', '/api/agent/threads/' + threadId)
    if (['done', 'error', 'awaiting_approval'].includes(t.body?.run?.status)) return t.body
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('timeout ' + threadId)
}

async function integration() {
  const status = await api('GET', '/api/agent/status')
  const names = (status.body.tools as { name: string }[]).map((t) => t.name)
  ok(status.body.mockFallback === true, 'mock LLM so the skill guard is deterministic')
  for (const name of ['explainer_next_step', 'explainer_qa', 'asset_lookup', 'explainer_learn', 'read_explainer_skill', 'hyperframes_render', 'web_search']) {
    ok(names.includes(name), `registered ${name}`)
  }
  ok(!names.includes('frame_probe'), 'frame probe is not a tool')
  const envRefs = (s: string) => [...s.matchAll(/\$\{ENV:([A-Z0-9_]+)\}/g)].map((m) => m[1])
  for (const d of httpTools) {
    const refs = [d.url || '', ...Object.values(d.headers || {})].flatMap(envRefs)
    const on = refs.every((k) => !!process.env[k])
    ok(on === names.includes(d.name), `${d.name} is registered only when its env is set`)
  }
  const listed = await api('GET', '/api/agents')
  ok(['explainer_orchestrator', 'explainer_planner', 'scene_builder_studio'].every((id) => listed.body.some((a: any) => a.id === id)), 'agents are loaded by the server')

  const minted = await api('POST', '/api/access/tokens', { name: 'explainer-test', scopes: ['admin'] })
  const client = new Client({ name: 'explainer-test', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), { requestInit: { headers: { Authorization: `Bearer ${minted.body.token}` } } }))
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args })
    const text = (r.content as { text: string }[]).map((x) => x.text).join('')
    return { error: !!r.isError, text, json: () => JSON.parse(text) }
  }
  try {
    const remote = await call('call_tool', { name: 'explainer_next_step', arguments: {} })
    ok(!remote.error && remote.json().step === 'research_script', 'server next_step matches the definition')
    const serverPass = await call('call_tool', { name: 'explainer_qa', arguments: { measurements: { ...good, cameraSpeedPxPerSec: 50 } } })
    ok(!serverPass.error && serverPass.json().status === 'pass' && hidden(serverPass.json()), 'server QA passes in-range input')
    const saved = await call('call_tool', { name: 'explainer_learn', arguments: { videoId: 'servervid', topic: 'tides', tier: 'express', mediaUrl: '/outputs/servervid.mp4', corrections: [{ metric: 'cameraSpeedPxPerSec', max: 100, fix: 'Hold the camera stiller than the last approved cut.' }] } })
    ok(!saved.error && saved.json().saved === true && !saved.text.includes('100'), 'server learn does not echo the bound')
    const serverFail = await call('call_tool', { name: 'explainer_qa', arguments: { measurements: { ...good, cameraSpeedPxPerSec: 200 } } })
    ok(!serverFail.error && serverFail.json().status === 'fail' && hidden(serverFail.json()) && !serverFail.text.includes('100'), 'server QA honors the learned bound')
    const globe = await call('call_tool', { name: 'asset_lookup', arguments: { query: 'earth' } })
    ok(!globe.error && globe.json().matches[0].status === 'not_a_file', 'server asset lookup is the placeholder catalog')
    const skill = await call('call_tool', { name: 'read_explainer_skill', arguments: {} })
    ok(!skill.error && skill.json().skill.includes(PHRASE), 'admin direct-call can read the skill')
  } finally {
    await client.close()
    await api('DELETE', '/api/access/tokens/' + minted.body.id)
  }

  const started = async (agentId: string, message: string) => {
    const r = await api('POST', '/api/agent/runs', { agentId, message })
    return until(r.body.threadId)
  }
  const toolText = (t: any, name: string) => t.messages.filter((m: any) => m.role === 'tool' && m.name === name).map((m: any) => m.content).join('\n')
  const plannerRun = await started('explainer_planner', 'read the explainer skill')
  ok(plannerRun.run.status === 'done' && toolText(plannerRun, 'read_explainer_skill').includes(PHRASE), 'planner tool returns the skill')
  const concierge = await started('concierge', 'read the explainer skill')
  const denied = toolText(concierge, 'read_explainer_skill')
  ok(concierge.run.status === 'done' && /explainer_planner/.test(denied) && !denied.includes(PHRASE), 'concierge is refused the skill')
  const builder = await started('scene_builder_express', 'read the explainer skill')
  ok(builder.run.status === 'done' && toolText(builder, 'read_explainer_skill') === '' && !JSON.stringify(builder.messages).includes(PHRASE), 'builder has no skill tool')
}

if (!base) ok(false, 'BASE_URL is set (run via npm test, or start the server)')
else await integration()
console.log(failed ? `${failed} FAILED` : 'ALL PASSED')
process.exit(failed ? 1 : 0)
