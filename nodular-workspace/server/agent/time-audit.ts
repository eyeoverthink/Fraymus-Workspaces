import { db, now } from './db'
import { randomUUID } from 'node:crypto'

export const WEEKEND_TASKS = [
  'Log Saturday in 30-minute blocks',
  'Log Sunday in 30-minute blocks',
  'Review energy, time leaks, and repeated complaints',
  'Combine evidence into three business hypotheses',
  'Choose one idea and define a 12-hour MVP',
  'Run one customer-validation experiment and record what happened'
]

function weekendKey(value: unknown) {
  const key = String(value || '')
  const date = new Date(`${key}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== key || date.getUTCDay() !== 6) {
    throw new Error('weekend must be the Saturday date in YYYY-MM-DD format')
  }
  return key
}

export function listWeekendTasks(userId: string, weekend: unknown) {
  const key = weekendKey(weekend)
  const tasks = db.prepare('select id,title,done,notes,updated_at from weekend_tasks where user_id=? and weekend=? order by rowid')
    .all(userId, key).map((row) => ({ id: String(row.id), title: String(row.title), done: !!row.done, notes: String(row.notes), updated_at: Number(row.updated_at) }))
  const completed = tasks.filter((task) => task.done).length
  return { weekend: key, tasks, completed, total: tasks.length, progress: tasks.length ? Math.round(completed / tasks.length * 100) : 0 }
}

export function startWeekend(userId: string, weekend: unknown) {
  const key = weekendKey(weekend)
  const existing = listWeekendTasks(userId, key)
  const missing = WEEKEND_TASKS.filter((_title, index) => !existing.tasks.some((task) => task.id === `default-${index + 1}`)).length
  if (existing.total + missing > 50) throw new Error('a weekend can contain at most 50 tasks')
  for (const [index, title] of WEEKEND_TASKS.entries()) {
    db.prepare('insert or ignore into weekend_tasks(id,user_id,weekend,title,updated_at) values(?,?,?,?,?)')
      .run(`default-${index + 1}`, userId, key, title, now())
  }
  return listWeekendTasks(userId, key)
}

export function saveWeekendTask(userId: string, weekend: unknown, input: { title: string; done?: boolean; notes?: string }, id?: string) {
  const key = weekendKey(weekend)
  const title = String(input.title || '').trim()
  const existing = id ? db.prepare('select done,notes from weekend_tasks where user_id=? and weekend=? and id=?').get(userId, key, id) : undefined
  if (id && !existing) throw new Error('weekend task not found')
  const notes = input.notes === undefined ? String(existing?.notes || '') : String(input.notes).trim()
  const done = input.done === undefined ? !!existing?.done : input.done
  if (!title || title.length > 240) throw new Error('task title must contain 1-240 characters')
  if (notes.length > 2000) throw new Error('task notes must be 2000 characters or fewer')
  if (input.done !== undefined && typeof input.done !== 'boolean') throw new Error('done must be a boolean')
  if (id) {
    const result = db.prepare('update weekend_tasks set title=?,done=?,notes=?,updated_at=? where user_id=? and weekend=? and id=?')
      .run(title, done ? 1 : 0, notes, now(), userId, key, id)
    if (!result.changes) throw new Error('weekend task not found')
  } else {
    const count = db.prepare('select count(*) as n from weekend_tasks where user_id=? and weekend=?').get(userId, key)
    if (Number(count?.n) >= 50) throw new Error('a weekend can contain at most 50 tasks')
    db.prepare('insert into weekend_tasks(id,user_id,weekend,title,done,notes,updated_at) values(?,?,?,?,?,?,?)')
      .run(randomUUID(), userId, key, title, input.done ? 1 : 0, notes, now())
  }
  return listWeekendTasks(userId, key)
}

export function deleteWeekendTask(userId: string, weekend: unknown, id: string) {
  const result = db.prepare('delete from weekend_tasks where user_id=? and weekend=? and id=?').run(userId, weekendKey(weekend), id)
  if (!result.changes) throw new Error('weekend task not found')
  return listWeekendTasks(userId, weekend)
}

export type TimeAuditInput = {
  startedAt: string | number
  activity: string
  energy: number
  valueUsd: number
  complaint?: string
}

function timestamp(value: string | number): number {
  const result = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(result) || result <= 0) throw new Error('startedAt must be a valid ISO date or timestamp')
  return Math.trunc(result)
}

function validate(input: TimeAuditInput) {
  const activity = String(input.activity || '').trim()
  const energy = Number(input.energy)
  const valueUsd = Number(input.valueUsd)
  const complaint = String(input.complaint || '').trim()
  if (!activity || activity.length > 240) throw new Error('activity is required and must be 240 characters or fewer')
  if (!Number.isInteger(energy) || energy < 1 || energy > 10) throw new Error('energy must be an integer from 1 to 10')
  if (!Number.isFinite(valueUsd) || valueUsd < 0 || valueUsd > 1_000_000) throw new Error('valueUsd must be between 0 and 1000000')
  if (complaint.length > 1000) throw new Error('complaint must be 1000 characters or fewer')
  return { startedAt: timestamp(input.startedAt), activity, energy, valueUsd, complaint }
}

export function saveTimeAuditEntry(userId: string, input: TimeAuditInput, id?: number) {
  const entry = validate(input)
  if (id !== undefined) {
    if (!Number.isInteger(id) || id < 1) throw new Error('invalid time-audit entry id')
    const existing = db.prepare('select id from time_audit_entries where id=? and user_id=?').get(id, userId)
    if (!existing) throw new Error('time-audit entry not found')
  }
  const overlap = db.prepare('select id from time_audit_entries where user_id=? and started_at<? and started_at>? and id!=? limit 1')
    .get(userId, entry.startedAt + 30 * 60_000, entry.startedAt - 30 * 60_000, id ?? -1)
  if (overlap) throw new Error('time-audit blocks cannot overlap; edit the existing entry instead')
  if (id !== undefined) {
    const updated = db.prepare('update time_audit_entries set started_at=?,activity=?,energy=?,value_usd=?,complaint=? where id=? and user_id=?')
      .run(entry.startedAt, entry.activity, entry.energy, entry.valueUsd, entry.complaint, id, userId)
    if (!Number(updated.changes)) throw new Error('time-audit entry not found')
    return db.prepare('select id,started_at,activity,energy,value_usd,complaint,created_at from time_audit_entries where id=? and user_id=?').get(id, userId)
  }
  try {
    db.prepare('insert into time_audit_entries(user_id,started_at,activity,energy,value_usd,complaint,created_at) values(?,?,?,?,?,?,?)')
      .run(userId, entry.startedAt, entry.activity, entry.energy, entry.valueUsd, entry.complaint, now())
  } catch (e: any) {
    if (e?.code === 'ERR_SQLITE_CONSTRAINT_UNIQUE') throw new Error('this 30-minute block is already recorded; edit the existing entry instead')
    throw e
  }
  return db.prepare('select id,started_at,activity,energy,value_usd,complaint,created_at from time_audit_entries where user_id=? and started_at=?').get(userId, entry.startedAt)
}

function rangeBound(value: string | undefined, fallback: number, label: string) {
  if (value === undefined) return fallback
  const result = Date.parse(value)
  if (!Number.isFinite(result)) throw new Error(`${label} must be a valid ISO date`)
  return result
}

export function listTimeAuditEntries(userId: string, from?: string, to?: string) {
  const end = rangeBound(to, now(), 'to')
  const start = rangeBound(from, end - 48 * 60 * 60 * 1000, 'from')
  if (start >= end) throw new Error('from must be earlier than to')
  if (end - start > 31 * 24 * 60 * 60 * 1000) throw new Error('time-audit range cannot exceed 31 days')
  const entries = db.prepare('select id,started_at,activity,energy,value_usd,complaint,created_at from time_audit_entries where user_id=? and started_at>=? and started_at<? order by started_at desc')
    .all(userId, start, end) as any[]
  const grouped = new Map<string, { activity: string; slots: number; energyTotal: number; valueUsd: number }>()
  for (const entry of entries) {
    const key = String(entry.activity)
    const group = grouped.get(key) || { activity: key, slots: 0, energyTotal: 0, valueUsd: 0 }
    group.slots++
    group.energyTotal += Number(entry.energy)
    group.valueUsd += Number(entry.value_usd)
    grouped.set(key, group)
  }
  const trackedMinutes = entries.length * 30
  return {
    from: start,
    to: end,
    entries,
    summary: {
      slots: entries.length,
      trackedMinutes,
      coveragePercent: Math.min(100, Math.round(trackedMinutes / ((end - start) / 60_000) * 100)),
      valueUsd: entries.reduce((sum, entry) => sum + Number(entry.value_usd), 0),
      lowEnergySlots: entries.filter((entry) => Number(entry.energy) <= 3).length,
      activities: [...grouped.values()]
        .map((group) => ({ ...group, minutes: group.slots * 30, averageEnergy: Math.round(group.energyTotal / group.slots * 10) / 10 }))
        .sort((a, b) => b.minutes - a.minutes)
    }
  }
}
