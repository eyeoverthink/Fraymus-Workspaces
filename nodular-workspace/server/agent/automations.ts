import { randomUUID } from 'node:crypto'
import { db, now } from './db'
import { getAgent, runAgentAndWait, callToolDirect } from './runtime'

// ---- 5-field cron (UTC): minute hour day-of-month month day-of-week. Supports *, lists, ranges, steps. ----
const RANGES: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]]

function parseField(f: string, [lo, hi]: [number, number]): Set<number> {
  const out = new Set<number>()
  for (const part of f.split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part)
    if (!m) throw new Error(`bad cron field "${f}"`)
    const step = m[2] ? Number(m[2]) : 1
    if (step < 1) throw new Error(`bad step in "${f}"`)
    let a = lo, b = hi
    if (m[1] !== '*') {
      const [x, y] = m[1].split('-').map(Number)
      a = x; b = y ?? (m[2] ? hi : x)
    }
    if (a < lo || b > hi || a > b) throw new Error(`"${f}" is out of range ${lo}-${hi}`)
    for (let v = a; v <= b; v += step) out.add(v)
  }
  return out
}

export type Cron = Set<number>[]
export function parseCron(expr: string): Cron {
  const parts = String(expr).trim().split(/\s+/)
  if (parts.length !== 5) throw new Error('cron needs 5 fields: minute hour day-of-month month day-of-week (UTC)')
  return parts.map((p, i) => parseField(i === 4 ? p.replace(/\b7\b/g, '0') : p, RANGES[i]))
}

export function cronMatches(c: Cron, d: Date, raw?: string): boolean {
  const domStar = raw ? raw.trim().split(/\s+/)[2] === '*' : false
  const dowStar = raw ? raw.trim().split(/\s+/)[4] === '*' : false
  const dom = c[2].has(d.getUTCDate()), dow = c[4].has(d.getUTCDay())
  const day = domStar || dowStar ? dom && dow : dom || dow
  return c[0].has(d.getUTCMinutes()) && c[1].has(d.getUTCHours()) && c[3].has(d.getUTCMonth() + 1) && day
}

export function nextRun(expr: string, from = new Date()): number | null {
  const c = parseCron(expr)
  const t = new Date(Math.floor(from.getTime() / 60000) * 60000 + 60000)
  for (let i = 0; i < 366 * 24 * 60; i++, t.setUTCMinutes(t.getUTCMinutes() + 1)) if (cronMatches(c, t, expr)) return t.getTime()
  return null
}

// ---- CRUD ----
export type AutomationInput = { id?: string; name: string; cron: string; kind?: 'agent' | 'tool'; agentId?: string; tool?: string; prompt?: string; args?: any; enabled?: boolean }

export function saveAutomation(userId: string, a: AutomationInput) {
  if (!a.name) throw new Error('name required')
  parseCron(a.cron)
  const kind = a.kind === 'tool' ? 'tool' : 'agent'
  if (kind === 'agent') {
    if (!a.agentId || !getAgent(userId, a.agentId)) throw new Error('unknown agentId')
    if (!a.prompt?.trim()) throw new Error('prompt required for an agent automation')
  } else if (!a.tool) throw new Error('tool required for a tool automation')
  const id = a.id || randomUUID().slice(0, 8)
  const existing = db.prepare('select user_id from automations where id=?').get(id) as any
  if (existing && existing.user_id !== userId) throw new Error('id already taken')
  const payload = JSON.stringify(kind === 'agent' ? { prompt: String(a.prompt).slice(0, 8000) } : { args: a.args || {} })
  db.prepare(`insert into automations(id,user_id,name,cron,kind,agent_id,tool,payload,enabled,created_at) values(?,?,?,?,?,?,?,?,?,?)
    on conflict(id) do update set name=excluded.name,cron=excluded.cron,kind=excluded.kind,agent_id=excluded.agent_id,tool=excluded.tool,payload=excluded.payload,enabled=excluded.enabled`)
    .run(id, userId, String(a.name).slice(0, 80), a.cron.trim(), kind, a.agentId ?? null, a.tool ?? null, payload, a.enabled === false ? 0 : 1, now())
  return viewOf(db.prepare('select * from automations where id=?').get(id))
}

const viewOf = (r: any) => {
  const last = db.prepare('select id,trigger,status,thread_id,error,started_at,finished_at from automation_runs where automation_id=? order by started_at desc limit 1').get(r.id) as any
  return { id: r.id, name: r.name, cron: r.cron, kind: r.kind, agentId: r.agent_id, tool: r.tool, ...JSON.parse(r.payload), enabled: !!r.enabled, nextRun: r.enabled ? nextRun(r.cron) : null, lastRun: last || null }
}
export const listAutomations = (userId: string) => (db.prepare('select * from automations where user_id=? order by created_at').all(userId) as any[]).map(viewOf)
export const deleteAutomation = (userId: string, id: string) => {
  const r = db.prepare('delete from automations where id=? and user_id=?').run(id, userId)
  if (Number(r.changes)) db.prepare('delete from automation_runs where automation_id=?').run(id)
  return Number(r.changes) > 0
}
export const automationRuns = (userId: string, id: string) =>
  db.prepare('select id,trigger,status,thread_id,substr(output,1,4000) output,error,started_at,finished_at from automation_runs where automation_id=? and user_id=? order by started_at desc limit 30').all(id, userId)

// ---- execution ----
const running = new Set<string>()

export async function runAutomation(userId: string, id: string, trigger: 'schedule' | 'manual' | 'webhook' = 'manual') {
  const a = db.prepare('select * from automations where id=? and user_id=?').get(id, userId) as any
  if (!a) throw new Error('automation not found')
  if (running.has(id)) throw new Error('already running')
  running.add(id)
  const runId = randomUUID()
  db.prepare("insert into automation_runs(id,automation_id,user_id,trigger,status,started_at) values(?,?,?,?,'running',?)").run(runId, id, userId, trigger, now())
  const finish = (status: string, f: { output?: string; error?: string; threadId?: string }) =>
    db.prepare('update automation_runs set status=?,output=?,error=?,thread_id=?,finished_at=? where id=?').run(status, f.output ?? null, f.error ?? null, f.threadId ?? null, now(), runId)
  try {
    const payload = JSON.parse(a.payload)
    if (a.kind === 'agent') {
      // Unattended: approval-risk tools stay pending for a human (status awaiting_approval), they are never auto-approved.
      const r = await runAgentAndWait(userId, a.agent_id, payload.prompt, undefined, 10 * 60_000)
      finish(r.pendingApprovals.length ? 'awaiting_approval' : r.status === 'done' ? 'done' : r.status, { output: r.reply, error: r.error, threadId: r.threadId })
    } else {
      finish('done', { output: await callToolDirect(userId, a.tool, payload.args) })
    }
  } catch (e: any) {
    finish('error', { error: e.message || String(e) })
  } finally {
    running.delete(id)
  }
  return db.prepare('select id,status,thread_id,output,error from automation_runs where id=?').get(runId)
}

let timer: ReturnType<typeof setInterval> | null = null
export function startScheduler() {
  if (timer || process.env.SCHEDULER === 'off') return
  const tick = () => {
    const minute = Math.floor(now() / 60000)
    const d = new Date(minute * 60000)
    for (const a of db.prepare('select * from automations where enabled=1').all() as any[]) {
      if (a.last_minute === minute) continue
      let due = false
      try { due = cronMatches(parseCron(a.cron), d, a.cron) } catch { continue }
      if (!due) continue
      db.prepare('update automations set last_minute=? where id=?').run(minute, a.id)
      void runAutomation(a.user_id, a.id, 'schedule').catch(() => {})
    }
  }
  timer = setInterval(tick, 15_000)
  timer.unref()
  // runs left 'running' by a crash are marked failed so history stays truthful
  db.prepare("update automation_runs set status='error', error='interrupted by restart', finished_at=? where status='running'").run(now())
}

export const TEMPLATES: (AutomationInput & { key: string })[] = [
  { key: 'daily-report', name: 'Daily status report', cron: '0 8 * * *', agentId: 'eye_sovereign', prompt: 'Write a short daily report: what the saved memories say I am working on, open priorities, and one suggested next action. Save the report with memory_save.' },
  { key: 'six-hour-research', name: 'Six-hourly research digest', cron: '0 */6 * * *', agentId: 'dev_archivist', prompt: 'Search the web for notable news in AI agents, MCP and self-hosted LLM tooling from the last day and give a 5-bullet digest with links.' },
  { key: 'heartbeat', name: 'Heartbeat (every 5 minutes)', cron: '*/5 * * * *', kind: 'tool', tool: 'memory_search', args: { query: 'heartbeat' } }
]
export const installTemplate = (userId: string, key: string) => {
  const t = TEMPLATES.find((x) => x.key === key)
  if (!t) throw new Error('unknown template')
  const { key: _k, ...rest } = t
  return saveAutomation(userId, { ...rest, id: `${key}-${userId.replace(/[^a-z0-9]/gi, '').slice(0, 12).toLowerCase()}`, enabled: false })
}
