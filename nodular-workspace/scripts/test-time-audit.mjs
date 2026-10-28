const base = process.env.BASE_URL || 'http://localhost:3001'
let fails = 0
const ok = (condition, label) => { console.log(`${condition ? 'PASS' : 'FAIL'} ${label}`); if (!condition) fails++ }
const api = async (method, path, body) => {
  const response = await fetch(base + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  })
  return { status: response.status, body: await response.json().catch(() => null) }
}

const invalidEnergy = await api('POST', '/api/time-audit', { startedAt: new Date().toISOString(), activity: 'Testing', energy: 11, valueUsd: 0 })
ok(invalidEnergy.status === 400, 'energy outside 1–10 is rejected')
const invalidRange = await api('GET', '/api/time-audit?from=invalid')
ok(invalidRange.status === 400, 'invalid range is rejected')

const startA = new Date(Date.now() - 3 * 60 * 60_000)
const startB = new Date(startA.getTime() - 30 * 60_000)
const first = await api('POST', '/api/time-audit', { startedAt: startA.toISOString(), activity: 'Deep work', energy: 8, valueUsd: 100, complaint: 'Too many interruptions' })
const second = await api('POST', '/api/time-audit', { startedAt: startB.toISOString(), activity: 'Deep work', energy: 2, valueUsd: 0, complaint: 'Too many interruptions' })
ok(first.status === 200 && first.body.id && second.status === 200 && second.body.id, 'two 30-minute blocks are recorded')
const overlap = await api('POST', '/api/time-audit', { startedAt: new Date(startA.getTime() + 15 * 60_000).toISOString(), activity: 'Overlap', energy: 5, valueUsd: 0 })
ok(overlap.status === 400 && /cannot overlap/i.test(overlap.body?.error), 'overlapping blocks are rejected')
const summary = await api('GET', '/api/time-audit')
ok(summary.status === 200 && summary.body.summary.slots >= 2 && summary.body.summary.trackedMinutes >= 60, '48-hour view summarizes logged duration')
ok(summary.body.summary.valueUsd >= 100 && summary.body.summary.lowEnergySlots >= 1 && summary.body.summary.activities.some((a) => a.activity === 'Deep work'), 'summary aggregates value, low energy, and activities')
const edit = await api('PUT', `/api/time-audit/${first.body.id}`, { startedAt: startA.toISOString(), activity: 'Focused work', energy: 7, valueUsd: 80, complaint: '' })
ok(edit.status === 200 && edit.body.activity === 'Focused work', 'owner can edit a recorded block')
const other = await api('PUT', '/api/time-audit/999999', { startedAt: startA.toISOString(), activity: 'No access', energy: 5, valueUsd: 0 })
ok(other.status === 400 && /not found/i.test(other.body?.error), 'missing entry cannot be updated')
const weekend = '/api/time-audit/weekend/2026-11-07'
ok((await api('GET', '/api/time-audit/weekend/2026-11-06')).status === 400, 'weekend tracker requires a Saturday date')
const started = await api('POST', `${weekend}/start`)
ok(started.status === 200 && started.body.total === 6, 'weekend exercise installs six checklist tasks')
const task = started.body.tasks[0]
const completed = await api('PUT', `${weekend}/tasks/${task.id}`, { title: task.title, done: true, notes: 'Recorded eight blocks' })
ok(completed.body.completed === 1 && completed.body.tasks[0].notes === 'Recorded eight blocks', 'completion and notes are stored')
ok((await api('POST', `${weekend}/start`)).body.completed === 1, 'reinstalling checklist never resets saved progress')
const custom = await api('POST', `${weekend}/tasks`, { title: 'Interview a customer' })
const customId = custom.body.tasks.find((item) => item.title === 'Interview a customer').id
ok(custom.body.total === 7 && (await api('DELETE', `${weekend}/tasks/${customId}`)).body.total === 6, 'custom weekend tasks can be added and removed')
ok((await api('GET', '/api/time-audit/weekend/2026-11-14')).body.total === 0, 'weekend checklists remain separated by date')
console.log(fails ? `${fails} FAILED` : 'ALL PASSED')
process.exitCode = fails ? 1 : 0
