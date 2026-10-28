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
console.log(fails ? `${fails} FAILED` : 'ALL PASSED')
process.exitCode = fails ? 1 : 0
