import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseManifest } from './manifest'

// Code-drawn 60s explainer. The workflow JSON is the source of truth.
// Thresholds stay in qa-rules.json and are never copied into tool results.

const workflowDir = fileURLToPath(new URL('../../workflows/code-explainer-60s/', import.meta.url))
const workflowPath = join(workflowDir, 'workflow.json')
const agentsDir = fileURLToPath(new URL('../../agents/', import.meta.url))
const httpToolsPath = fileURLToPath(new URL('../../config/http-tools.json', import.meta.url))

const SKILL_PHRASE = 'gray plastic'
const TIERS = ['express', 'standard', 'studio'] as const
const REVIEWS = ['once', 'per_scene'] as const
const QA = ['pass', 'fail', 'override'] as const
const KINDS = ['input', 'agent', 'human_gate', 'tool', 'output'] as const
const WHEN_KEYS = ['hookChosen', 'qa', 'review', 'scenesLeftGt', 'rendered', 'wantRealism'] as const

export type TierName = (typeof TIERS)[number]
export type Review = (typeof REVIEWS)[number]
export type QaStatus = (typeof QA)[number]
export type QaReport = { status: 'pass' | 'fail'; fixes: string[] }

export type PublicStep = {
  step: string
  kind: string
  instruction: string
  agent?: string
  tool?: string
  quality?: string
  review?: Review
  waitForHuman?: boolean
  stub?: boolean
  optional?: boolean
  candidates?: string[]
  notSufficient?: string[]
}

export type StepState = {
  from?: string
  tier?: string
  hookChosen?: boolean
  qa?: string
  scenesLeft?: number
  rendered?: boolean
  wantRealism?: boolean
}

type Rule = { metric: string; label: string; min?: number; max?: number; fix: string }
type Correction = { metric: string; min?: number; max?: number; fix: string }
type Step = {
  id: string
  kind: (typeof KINDS)[number]
  instruction: string
  agent?: string
  agentByTier?: boolean
  tool?: string
  quality?: string
  candidates?: string[]
  notSufficient?: string[]
  stub?: boolean
  optional?: boolean
}
type When = {
  hookChosen?: boolean
  qa?: QaStatus
  review?: Review
  scenesLeftGt?: number
  rendered?: boolean
  wantRealism?: boolean
}
type Transition = { from: string; when: When; to: string }
type TierDef = { builder: string; review: Review }
type Asset = { id: string; name: string; tags: string[]; kind: string; status: string; note: string }
type Workflow = {
  entry: string
  steps: Step[]
  transitions: Transition[]
  tiers: Record<TierName, TierDef>
  skillPath: string
  rules: Rule[]
  assets: Asset[]
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, label: string) => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${label} must be a non-empty string`)
  return v.trim()
}
const finite = (v: unknown, label: string) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${label} must be a finite number`)
  return v
}

function inside(root: string, rel: string): string {
  if (typeof rel !== 'string' || !rel.trim() || rel.includes('\0') || isAbsolute(rel)) throw new Error('workflow path must be relative')
  const rootAbs = resolve(root)
  const abs = resolve(rootAbs, rel)
  if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) throw new Error(`path escapes workflow dir: ${rel}`)
  return abs
}

function echoes(text: string, n: number): boolean {
  const body = String(n).replace('-', '')
  if (body.length < 2) return false
  const esc = String(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\d.])${esc}(?![\\d.])`).test(text)
}

function parseRules(raw: unknown): Rule[] {
  if (!isObj(raw) || !Array.isArray(raw.rules)) throw new Error('qa-rules.json needs a rules array')
  const seen = new Set<string>()
  return raw.rules.map((row, i) => {
    if (!isObj(row)) throw new Error(`rule ${i} is not an object`)
    const metric = str(row.metric, `rule ${i} metric`)
    if (!/^[a-z][A-Za-z0-9]{0,40}$/.test(metric)) throw new Error(`bad metric ${metric}`)
    if (seen.has(metric)) throw new Error(`duplicate metric ${metric}`)
    seen.add(metric)
    const label = str(row.label, metric)
    const fix = str(row.fix, metric)
    const rule: Rule = { metric, label, fix }
    if (row.min != null) rule.min = finite(row.min, `${metric} min`)
    if (row.max != null) rule.max = finite(row.max, `${metric} max`)
    if (rule.min == null && rule.max == null) throw new Error(`${metric} needs min or max`)
    if (rule.min != null && rule.max != null && rule.min > rule.max) throw new Error(`${metric} min is above max`)
    for (const n of [rule.min, rule.max]) {
      if (n != null && (echoes(fix, n) || echoes(label, n))) throw new Error(`${metric} text echoes its threshold`)
    }
    return rule
  })
}

function parseAssets(raw: unknown): Asset[] {
  if (!isObj(raw) || !Array.isArray(raw.assets)) throw new Error('assets.json needs an assets array')
  return raw.assets.map((row, i) => {
    if (!isObj(row)) throw new Error(`asset ${i} is not an object`)
    const tags = Array.isArray(row.tags) ? row.tags.map((t) => str(t, `asset ${i} tag`)) : []
    const asset: Asset = {
      id: str(row.id, `asset ${i} id`),
      name: str(row.name, `asset ${i} name`),
      tags,
      kind: str(row.kind, `asset ${i} kind`),
      status: str(row.status, `asset ${i} status`),
      note: str(row.note, `asset ${i} note`)
    }
    if (asset.status !== 'not_a_file') throw new Error(`${asset.id} must stay status not_a_file until a real file is supplied`)
    if (!/STUB/.test(asset.note)) throw new Error(`${asset.id} note must say STUB`)
    return asset
  })
}

function agentTools(id: string): string[] {
  const file = join(agentsDir, `${id}.md`)
  if (!existsSync(file)) throw new Error(`missing agent manifest agents/${id}.md`)
  const tools = parseManifest(readFileSync(file, 'utf8'), id).tools
  if (tools === '*') throw new Error(`${id} must list tools explicitly`)
  return tools
}
const hasTool = (id: string, name: string) => agentTools(id).includes(name)
const lacksTool = (id: string, name: string) => {
  if (hasTool(id, name)) throw new Error(`${id} must not have ${name}`)
}

function parseWhen(raw: unknown, label: string): When {
  if (!isObj(raw)) throw new Error(`${label} when must be an object`)
  for (const k of Object.keys(raw)) if (!(WHEN_KEYS as readonly string[]).includes(k)) throw new Error(`${label} has unknown when.${k}`)
  const when: When = {}
  if (raw.hookChosen != null) {
    if (typeof raw.hookChosen !== 'boolean') throw new Error(`${label} hookChosen must be boolean`)
    when.hookChosen = raw.hookChosen
  }
  if (raw.qa != null) {
    if (!(QA as readonly string[]).includes(String(raw.qa))) throw new Error(`${label} qa is invalid`)
    when.qa = raw.qa as QaStatus
  }
  if (raw.review != null) {
    if (!(REVIEWS as readonly string[]).includes(String(raw.review))) throw new Error(`${label} review is invalid`)
    when.review = raw.review as Review
  }
  if (raw.scenesLeftGt != null) when.scenesLeftGt = finite(raw.scenesLeftGt, `${label} scenesLeftGt`)
  if (raw.rendered != null) {
    if (typeof raw.rendered !== 'boolean') throw new Error(`${label} rendered must be boolean`)
    when.rendered = raw.rendered
  }
  if (raw.wantRealism != null) {
    if (typeof raw.wantRealism !== 'boolean') throw new Error(`${label} wantRealism must be boolean`)
    when.wantRealism = raw.wantRealism
  }
  if (!Object.keys(when).length) throw new Error(`${label} when is empty`)
  return when
}

function parseWorkflow(raw: unknown): Workflow {
  if (!isObj(raw)) throw new Error('workflow.json must be an object')
  if (raw.version !== 1) throw new Error('unsupported workflow version')
  if (!Array.isArray(raw.humanGates) || raw.humanGates.length !== 1 || raw.humanGates[0] !== 'pick_hook') {
    throw new Error('the only human gate is pick_hook')
  }
  if (!Array.isArray(raw.steps)) throw new Error('steps must be an array')
  const steps: Step[] = raw.steps.map((row, i) => {
    if (!isObj(row)) throw new Error(`step ${i} is not an object`)
    const id = str(row.id, `step ${i} id`)
    if (!(KINDS as readonly string[]).includes(String(row.kind))) throw new Error(`${id} has a bad kind`)
    const step: Step = { id, kind: row.kind as Step['kind'], instruction: str(row.instruction, `${id} instruction`) }
    if (row.agent != null) step.agent = str(row.agent, `${id} agent`)
    if (row.agentByTier === true) step.agentByTier = true
    if (row.tool != null) step.tool = str(row.tool, `${id} tool`)
    if (row.quality != null) step.quality = str(row.quality, `${id} quality`)
    if (row.candidates != null) {
      if (!Array.isArray(row.candidates)) throw new Error(`${id} candidates must be an array`)
      step.candidates = row.candidates.map((c) => str(c, `${id} candidate`))
    }
    if (row.notSufficient != null) {
      if (!Array.isArray(row.notSufficient)) throw new Error(`${id} notSufficient must be an array`)
      step.notSufficient = row.notSufficient.map((c) => str(c, `${id} notSufficient`))
    }
    if (row.stub === true) step.stub = true
    if (row.optional === true) step.optional = true
    if (step.kind === 'tool' && !step.tool && !step.candidates?.length) throw new Error(`${id} tool step needs a tool or candidates`)
    if (step.kind === 'agent' && !step.agent && !step.agentByTier) throw new Error(`${id} agent step needs an agent`)
    if (step.kind === 'human_gate' && id !== 'pick_hook') throw new Error('unexpected human gate ' + id)
    return step
  })
  const ids = new Set(steps.map((s) => s.id))
  if (ids.size !== steps.length) throw new Error('duplicate step id')
  const entry = str(raw.entry, 'entry')
  if (!ids.has(entry)) throw new Error('entry is not a step')
  if (!isObj(raw.tiers)) throw new Error('tiers missing')
  const tiers = {} as Record<TierName, TierDef>
  for (const name of TIERS) {
    const row = raw.tiers[name]
    if (!isObj(row)) throw new Error(`tier ${name} missing`)
    const review = str(row.review, `${name} review`)
    if (!(REVIEWS as readonly string[]).includes(review)) throw new Error(`${name} review is invalid`)
    const builder = str(row.builder, `${name} builder`)
    tiers[name] = { builder, review: review as Review }
    lacksTool(builder, 'read_explainer_skill')
    lacksTool(builder, 'hyperframes_render')
    lacksTool(builder, 'explainer_qa')
  }
  if (!Array.isArray(raw.transitions)) throw new Error('transitions missing')
  const transitions = raw.transitions.map((row, i) => {
    if (!isObj(row)) throw new Error(`transition ${i} is not an object`)
    const from = str(row.from, `transition ${i} from`)
    const to = str(row.to, `transition ${i} to`)
    if (!ids.has(from) || !ids.has(to)) throw new Error(`transition ${from} -> ${to} leaves the graph`)
    return { from, to, when: parseWhen(row.when, from) }
  })
  const runner = str(raw.runner, 'runner')
  for (const name of ['explainer_next_step', 'delegate_to_agent', 'explainer_qa', 'asset_lookup', 'explainer_learn', 'hyperframes_render']) {
    if (!hasTool(runner, name)) throw new Error(`${runner} is missing ${name}`)
  }
  lacksTool(runner, 'read_explainer_skill')
  const researcher = steps.find((s) => s.id === 'research_script')?.agent
  const planner = steps.find((s) => s.id === 'plan')?.agent
  if (!researcher || !planner) throw new Error('research_script and plan agents are required')
  if (!hasTool(researcher, 'web_search')) throw new Error(`${researcher} needs web_search`)
  lacksTool(researcher, 'read_explainer_skill')
  if (!hasTool(planner, 'read_explainer_skill')) throw new Error(`${planner} needs read_explainer_skill`)
  lacksTool(planner, 'hyperframes_render')
  lacksTool(planner, 'explainer_qa')
  if (!Array.isArray(raw.stubs) || !raw.stubs.includes('frame_probe')) throw new Error('frame_probe must stay listed as a stub')
  const http = JSON.parse(readFileSync(httpToolsPath, 'utf8')) as { name?: string; description?: string }[]
  const httpNames = new Set(http.map((d) => d.name))
  if (httpNames.has('frame_probe')) throw new Error('frame_probe must not be registered as an HTTP tool')
  for (const name of raw.stubs as unknown[]) {
    if (name === 'frame_probe') continue
    const def = http.find((d) => d.name === name)
    if (!def) throw new Error(`stub ${name} is missing from config/http-tools.json`)
    if (!/STUB/.test(def.description || '')) throw new Error(`stub ${name} description must say STUB`)
  }
  if (Array.isArray(raw.presentButNotSufficient) && !raw.presentButNotSufficient.includes('speak')) {
    throw new Error('speak is audio only and must stay in presentButNotSufficient')
  }
  const skillPath = inside(workflowDir, str(raw.skill, 'skill'))
  const skill = readFileSync(skillPath, 'utf8')
  if (!skill.includes(SKILL_PHRASE)) throw new Error('skill is missing its picture guidance')
  if (/\b720\b|\b1400\b|0\.08|-20|-14/.test(skill)) throw new Error('skill must not carry QA thresholds')
  return {
    entry,
    steps,
    transitions,
    tiers,
    skillPath,
    rules: parseRules(JSON.parse(readFileSync(inside(workflowDir, str(raw.qaRules, 'qaRules')), 'utf8'))),
    assets: parseAssets(JSON.parse(readFileSync(inside(workflowDir, str(raw.assetCatalog, 'assetCatalog')), 'utf8')))
  }
}

let cached: Workflow | null = null
export function loadWorkflow(): Workflow {
  if (!cached) cached = parseWorkflow(JSON.parse(readFileSync(workflowPath, 'utf8')))
  return cached
}

function boolFlag(v: unknown, label: string, fallback: boolean): boolean {
  if (v == null) return fallback
  if (typeof v !== 'boolean') throw new Error(`${label} must be a boolean`)
  return v
}

function describe(step: Step, tier: TierName): PublicStep {
  const wf = loadWorkflow()
  const out: PublicStep = { step: step.id, kind: step.kind, instruction: step.instruction }
  if (step.kind === 'human_gate') out.waitForHuman = true
  if (step.agent) out.agent = step.agent
  if (step.agentByTier) {
    out.agent = wf.tiers[tier].builder
    out.review = wf.tiers[tier].review
  }
  if (step.tool) out.tool = step.tool
  if (step.quality) out.quality = step.quality
  if (step.candidates) out.candidates = [...step.candidates]
  if (step.notSufficient) out.notSufficient = [...step.notSufficient]
  if (step.stub) out.stub = true
  if (step.optional) out.optional = true
  return out
}

function matches(when: When, tier: TierName, state: { hookChosen: boolean; qa?: QaStatus; scenesLeft: number; rendered: boolean; wantRealism: boolean }): boolean {
  const review = loadWorkflow().tiers[tier].review
  if (when.hookChosen != null && when.hookChosen !== state.hookChosen) return false
  if (when.qa != null && when.qa !== state.qa) return false
  if (when.review != null && when.review !== review) return false
  if (when.scenesLeftGt != null && !(state.scenesLeft > when.scenesLeftGt)) return false
  if (when.rendered != null && when.rendered !== state.rendered) return false
  if (when.wantRealism != null && when.wantRealism !== state.wantRealism) return false
  return true
}

export function nextStep(input: StepState = {}): PublicStep {
  const wf = loadWorkflow()
  const tierName = input.tier == null ? 'express' : str(input.tier, 'tier')
  if (!(TIERS as readonly string[]).includes(tierName)) throw new Error('tier must be express, standard, or studio')
  const tier = tierName as TierName
  const hookChosen = boolFlag(input.hookChosen, 'hookChosen', false)
  const rendered = boolFlag(input.rendered, 'rendered', false)
  const wantRealism = boolFlag(input.wantRealism, 'wantRealism', false)
  let qa: QaStatus | undefined
  if (input.qa != null) {
    if (!(QA as readonly string[]).includes(input.qa)) throw new Error('qa must be pass, fail, or override')
    qa = input.qa as QaStatus
  }
  let scenesLeft = 0
  if (input.scenesLeft != null) {
    if (typeof input.scenesLeft !== 'number' || !Number.isInteger(input.scenesLeft) || input.scenesLeft < 0 || input.scenesLeft > 40) {
      throw new Error('scenesLeft must be an integer from 0 to 40')
    }
    scenesLeft = input.scenesLeft
  }
  if (!input.from) return describe(wf.steps.find((s) => s.id === wf.entry)!, tier)
  const from = str(input.from, 'from')
  if (from === 'qa' && !qa) throw new Error('qa is required when leaving the qa step (pass, fail, or override)')
  const idx = wf.steps.findIndex((s) => s.id === from)
  if (idx < 0) throw new Error(`unknown step "${from}"`)
  const state = { hookChosen, qa, scenesLeft, rendered, wantRealism }
  for (const t of wf.transitions) {
    if (t.from === from && matches(t.when, tier, state)) return describe(wf.steps.find((s) => s.id === t.to)!, tier)
  }
  return describe(wf.steps[Math.min(idx + 1, wf.steps.length - 1)], tier)
}

function learnedPath(dir: string) {
  return join(dir, 'learned-rules.json')
}
export function explainerDataDir() {
  return resolve(process.env.DATA_DIR || './data', 'explainer')
}

function readLearned(dir: string): Correction[] {
  const p = learnedPath(dir)
  if (!existsSync(p)) return []
  const raw = JSON.parse(readFileSync(p, 'utf8')) as unknown
  if (!isObj(raw) || !Array.isArray(raw.rules)) throw new Error('learned rules file is corrupt')
  return raw.rules.map((row) => {
    if (!isObj(row)) throw new Error('learned rules file is corrupt')
    const item: Correction = { metric: str(row.metric, 'learned metric'), fix: str(row.fix, 'learned fix') }
    if (row.min != null) item.min = finite(row.min, 'learned min')
    if (row.max != null) item.max = finite(row.max, 'learned max')
    return item
  })
}

function mergeRules(shipped: Rule[], learned: Correction[]): Rule[] {
  const by = new Map<string, Rule>(shipped.map((r) => [r.metric, { ...r }]))
  const extraOrder: string[] = []
  for (const extra of learned) {
    const base = by.get(extra.metric)
    if (!base) {
      by.set(extra.metric, { metric: extra.metric, label: extra.metric, min: extra.min, max: extra.max, fix: extra.fix })
      extraOrder.push(extra.metric)
      continue
    }
    let tightened = false
    if (extra.max != null && (base.max == null || extra.max < base.max)) { base.max = extra.max; tightened = true }
    if (extra.min != null && (base.min == null || extra.min > base.min)) { base.min = extra.min; tightened = true }
    if (tightened) base.fix = extra.fix
  }
  return [...shipped.map((r) => by.get(r.metric)!), ...extraOrder.map((m) => by.get(m)!)]
}

function measurement(bag: Record<string, unknown>, metric: string): number | undefined {
  if (!Object.prototype.hasOwnProperty.call(bag, metric)) return undefined
  const v = bag[metric]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

export function evaluateQa(measurements: unknown, learnedDir = explainerDataDir()): QaReport {
  const wf = loadWorkflow()
  const bag = isObj(measurements) ? measurements : {}
  const rules = mergeRules(wf.rules, readLearned(learnedDir))
  const fixes: string[] = []
  for (const rule of rules) {
    const value = measurement(bag, rule.metric)
    if (value == null) {
      fixes.push(`No measurement was supplied for ${rule.label}. This checker does not inspect video files.`)
      continue
    }
    if ((rule.min != null && value < rule.min) || (rule.max != null && value > rule.max)) fixes.push(rule.fix)
  }
  return fixes.length ? { status: 'fail', fixes } : { status: 'pass', fixes: [] }
}

export function lookupAssets(query: unknown) {
  const wf = loadWorkflow()
  const text = str(query, 'query').toLowerCase()
  const tokens = [...new Set(text.split(/[^a-z0-9]+/).filter((t) => t.length >= 2))].slice(0, 12)
  if (!tokens.length) throw new Error('query needs at least one word')
  const matches = wf.assets.filter((a) => {
    const hay = [a.id, a.name, ...a.tags].join(' ').toLowerCase()
    return tokens.some((t) => hay.includes(t) || a.tags.some((tag) => t.includes(tag.toLowerCase())))
  }).slice(0, 8)
  return {
    matches,
    placeholderCatalog: true,
    note: 'Placeholder catalog only. A match is not a file. Remote fetch is the stub tool asset_library_fetch and stays unregistered until configured.'
  }
}

function cleanCorrection(row: unknown, i: number): Correction {
  if (!isObj(row)) throw new Error(`correction ${i} is not an object`)
  const metric = str(row.metric, `correction ${i} metric`)
  if (!/^[a-z][A-Za-z0-9]{0,40}$/.test(metric)) throw new Error(`bad metric ${metric}`)
  const fix = str(row.fix, `correction ${i} fix`).replace(/\s+/g, ' ').slice(0, 240)
  if (fix.length < 8) throw new Error(`correction ${i} fix is too short`)
  const item: Correction = { metric, fix }
  if (row.min != null) item.min = finite(row.min, `correction ${i} min`)
  if (row.max != null) item.max = finite(row.max, `correction ${i} max`)
  if (item.min == null && item.max == null) throw new Error(`correction ${i} needs min or max`)
  if (item.min != null && item.max != null && item.min > item.max) throw new Error(`correction ${i} min is above max`)
  return item
}

export type LearnInput = { videoId?: unknown; topic?: unknown; tier?: unknown; mediaUrl?: unknown; corrections?: unknown }

export function recordLearning(input: LearnInput, dir = explainerDataDir()) {
  const videoId = str(input.videoId, 'videoId')
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(videoId)) throw new Error('videoId must be letters, digits, underscore, or hyphen')
  const topic = str(input.topic, 'topic').replace(/\s+/g, ' ').slice(0, 200)
  let tier = 'express'
  if (input.tier != null) {
    tier = str(input.tier, 'tier')
    if (!(TIERS as readonly string[]).includes(tier)) throw new Error('tier must be express, standard, or studio')
  }
  let mediaUrl: string | undefined
  if (input.mediaUrl != null && String(input.mediaUrl).trim()) {
    mediaUrl = String(input.mediaUrl).trim()
    if (mediaUrl.includes('..') || mediaUrl.length > 500 || !/^(\/outputs\/[A-Za-z0-9._-]+|https:\/\/[^\s]+)$/.test(mediaUrl)) {
      throw new Error('mediaUrl must be an /outputs path or an https URL from the renderer')
    }
  }
  loadWorkflow()
  const corrections = Array.isArray(input.corrections) ? input.corrections.map(cleanCorrection) : []
  if (corrections.length > 10) throw new Error('at most 10 corrections per call')
  mkdirSync(dir, { recursive: true })
  const rules = readLearned(dir)
  if (rules.length + corrections.length > 100) throw new Error('learned rule cap reached')
  writeFileSync(learnedPath(dir), JSON.stringify({ rules: [...rules, ...corrections] }, null, 2))
  const ref = join(dir, 'references.jsonl')
  if (existsSync(ref) && statSync(ref).size > 1_000_000) throw new Error('reference pool is full')
  appendFileSync(ref, JSON.stringify({ at: new Date().toISOString(), videoId, topic, tier, mediaUrl: mediaUrl ?? null }) + '\n')
  const referenceCount = readFileSync(ref, 'utf8').split('\n').filter(Boolean).length
  return {
    saved: true,
    referenceCount,
    rulesAdded: corrections.length,
    note: 'Saved to the local reference pool. Shipped checks were not loosened.'
  }
}

export function readSkill(): string {
  return readFileSync(loadWorkflow().skillPath, 'utf8')
}

// mcp is the admin call_tool identity. Everyone else, including concierge (tools *), is refused.
export const canReadSkill = (agentId: string) => agentId === 'explainer_planner' || agentId === 'mcp'
