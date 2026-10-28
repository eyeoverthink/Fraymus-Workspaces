const base = process.env.BASE_URL || 'http://localhost:3001'
let fails = 0
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) fails++ }
const api = async (m, p, b) => {
  const r = await fetch(base + p, { method: m, headers: m === 'GET' || m === 'DELETE' ? {} : { 'content-type': 'application/json' }, body: m === 'GET' || m === 'DELETE' ? undefined : JSON.stringify(b || {}) })
  return { status: r.status, body: await r.json().catch(() => null) }
}

const bad = await api('POST', '/api/automations', { name: 'x', cron: '61 * * * *', agentId: 'eye_sovereign', prompt: 'hi' })
ok(bad.status >= 400, 'invalid cron rejected')
const bad2 = await api('POST', '/api/automations', { name: 'x', cron: '* * * *', agentId: 'eye_sovereign', prompt: 'hi' })
ok(bad2.status >= 400, 'wrong field count rejected')
const bad3 = await api('POST', '/api/automations', { name: 'x', cron: '* * * * *', agentId: 'nope', prompt: 'hi' })
ok(bad3.status >= 400, 'unknown agent rejected')

const a = await api('POST', '/api/automations', { name: 'Daily', cron: '0 8 * * *', agentId: 'eye_sovereign', prompt: 'Say hello' })
ok(a.status === 200 && a.body.id, 'agent automation created')
const next = new Date(a.body.nextRun)
ok(next.getUTCMinutes() === 0 && next.getUTCHours() === 8 && next.getTime() > Date.now(), 'nextRun is the next 08:00 UTC')

const hb = await api('POST', '/api/automations', { name: 'HB', cron: '*/5 * * * *', kind: 'tool', tool: 'memory_search', args: { query: 'x' } })
ok(hb.status === 200 && new Date(hb.body.nextRun).getUTCMinutes() % 5 === 0, 'every-5-minutes nextRun aligned')

const run = await api('POST', `/api/automations/${a.body.id}/run`)
ok(run.status === 200 && ['done', 'awaiting_approval'].includes(run.body.status), `agent automation ran (${run.body?.status})`)
const trun = await api('POST', `/api/automations/${hb.body.id}/run`)
ok(trun.status === 200 && trun.body.status === 'done', 'tool automation ran')
const missing = await api('POST', '/api/automations/nope/run')
ok(missing.status >= 400, 'run of unknown automation fails')

const runs = await api('GET', `/api/automations/${a.body.id}/runs`)
ok(Array.isArray(runs.body) && runs.body.length === 1 && runs.body[0].trigger === 'manual', 'run history recorded')

const tpl = await api('POST', '/api/automations/template/daily-report')
ok(tpl.status === 200 && tpl.body.enabled === false, 'template installs disabled')
const list = await api('GET', '/api/automations')
ok(list.body.automations.length === 3 && list.body.templates.length >= 3, 'list returns automations and templates')

const del = await api('DELETE', `/api/automations/${a.body.id}`)
ok(del.body.ok === true && (await api('GET', '/api/automations')).body.automations.length === 2, 'delete works')

process.exit(fails ? 1 : 0)
