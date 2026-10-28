import { randomUUID } from 'node:crypto'
import { db, now } from './db'
import { listTimeAuditEntries } from './time-audit'

export type IdeaFinderInput = { audience: string; pain?: string }

const stopWords = new Set(['about', 'after', 'again', 'also', 'because', 'been', 'being', 'between', 'could', 'doing', 'from', 'have', 'having', 'into', 'just', 'more', 'most', 'other', 'over', 'same', 'some', 'that', 'their', 'them', 'there', 'these', 'they', 'this', 'those', 'through', 'very', 'were', 'what', 'when', 'where', 'which', 'while', 'with', 'would', 'your'])
const words = (value: string) => value.toLowerCase().match(/[a-z0-9]{3,}/g)?.filter((word) => !stopWords.has(word)) || []
const normalize = (value: string) => words(value).sort().join(' ')

function clusterComplaints(entries: any[]) {
  const grouped = new Map<string, { complaint: string; slots: number; lowEnergySlots: number }>()
  for (const entry of entries) {
    const complaint = String(entry.complaint || '').trim()
    const key = normalize(complaint)
    if (!key) continue
    const group = grouped.get(key) || { complaint, slots: 0, lowEnergySlots: 0 }
    group.slots++
    if (Number(entry.energy) <= 3) group.lowEnergySlots++
    grouped.set(key, group)
  }
  return [...grouped.values()].sort((a, b) => b.slots - a.slots || b.lowEnergySlots - a.lowEnergySlots).slice(0, 5)
}

function safeLabel(value: string, fallback: string) {
  const result = value.trim().replace(/\s+/g, ' ')
  if (!result || result.length > 120) throw new Error(`${fallback} must contain 1-120 characters`)
  return result
}

export function buildIdeaReport(userId: string, input: IdeaFinderInput) {
  const audience = safeLabel(String(input.audience || ''), 'audience')
  const userPain = String(input.pain || '').trim()
  if (userPain.length > 300) throw new Error('pain must be 300 characters or fewer')

  const audit = listTimeAuditEntries(userId)
  const complaints = clusterComplaints(audit.entries)
  const topActivity = audit.summary.activities[0]
  const focusPain = userPain || complaints[0]?.complaint || topActivity?.activity || ''
  if (!focusPain) throw new Error('Log at least one time-audit block or enter a pain point before generating ideas')

  const selectedComplaint = complaints.find((complaint) => normalize(complaint.complaint) === normalize(focusPain))
  const evidence = {
    periodFrom: audit.from,
    periodTo: audit.to,
    auditedBlocks: audit.summary.slots,
    trackedHours: audit.summary.trackedMinutes / 60,
    topActivity: topActivity ? { activity: topActivity.activity, hours: topActivity.minutes / 60, averageEnergy: topActivity.averageEnergy } : null,
    complaintGroups: complaints,
    focus: {
      pain: focusPain,
      source: userPain ? 'user-stated' : selectedComplaint ? 'repeated-time-audit-complaint' : 'most-logged-activity',
      matchingBlocks: selectedComplaint?.slots || 0,
      matchingLowEnergyBlocks: selectedComplaint?.lowEnergySlots || 0
    }
  }

  const pain = focusPain.replace(/[.!?]+$/, '')
  const ideas = [
    {
      title: `A focused AI workflow for ${audience}`,
      format: 'Nodular agent/workflow',
      problem: `Help ${audience} reduce the specific friction: “${pain}.”`,
      evidence: selectedComplaint
        ? `This exact complaint appeared in ${selectedComplaint.slots} self-reported 30-minute block${selectedComplaint.slots === 1 ? '' : 's'}; ${selectedComplaint.lowEnergySlots} were logged at energy 1–3.`
        : 'This is a user-stated pain hypothesis; the audit does not contain a matching repeated complaint.',
      twelveHourMvp: 'Interview 3 people in the audience, define one repeated input/output, build one narrow agent workflow, and test it with sample data plus explicit human review.',
      validation: 'Ask 5 target users to walk through their current workaround. Continue only if several describe the same costly step and agree to try the prototype.',
      risks: ['The workflow may need integrations that are not connected.', 'A time-saving demo is not proof that customers will pay.']
    },
    {
      title: `A done-with-you ${audience} workflow setup`,
      format: 'Productized service',
      problem: `Deliver a bounded setup that removes one repetitive step related to “${pain}.”`,
      evidence: `The time audit contains ${audit.summary.slots} self-reported blocks over ${audit.summary.trackedMinutes / 60} hours; the selected problem is ${evidence.focus.source === 'user-stated' ? 'user supplied' : 'observed in the audit'}.`,
      twelveHourMvp: 'Write a one-page scope, create a working sample for one customer, define what data and approvals are required, and deliver the setup manually before automating further.',
      validation: 'Offer a clearly scoped pilot to 5 people in the audience. Track paid commitments and actual completion time, not likes or compliments.',
      risks: ['Service delivery may not scale.', 'Do not promise savings or outcomes before measuring a real pilot.']
    },
    {
      title: `A reusable ${audience} playbook for “${pain}”`,
      format: 'Template / starter kit',
      problem: `Package a repeatable checklist, prompts, and workflow starter for people with this same pain.`,
      evidence: complaints.length
        ? `${complaints.length} distinct complaint phrase${complaints.length === 1 ? '' : 's'} were entered in the audit; ${selectedComplaint ? `the leading matching phrase was logged ${selectedComplaint.slots} time(s)` : 'the current focus was entered by the user'}.`
        : 'No complaints were logged; this idea is based on the user-stated pain only.',
      twelveHourMvp: 'Create a small checklist, one example workflow, and a short setup guide. Have 3 target users follow it without coaching and note where they get stuck.',
      validation: 'Test whether users can complete the target task and ask what they would pay for ongoing support. Revise before expanding the kit.',
      risks: ['A template can be easy to copy.', 'Do not describe public search results or a small test as market validation.']
    }
  ]

  return {
    audience,
    createdAt: now(),
    evidence,
    ideas,
    pricingMath: { example: '$500 × 40 sales = $20,000 gross revenue', caveat: 'Arithmetic example only—not a forecast, promise, or evidence that customers will buy.' },
    caveats: [
      'Time-audit entries and complaints are self-reported; this app does not monitor device activity.',
      'These are hypotheses ranked from the supplied pain, not validated opportunities or guaranteed revenue.',
      'The “12-hour MVP” is a scoping target, not a completion estimate or guarantee.'
    ]
  }
}

export type IdeaReport = ReturnType<typeof buildIdeaReport> & {
  research?: { status: 'complete' | 'failed' | 'not_requested'; query?: string; error?: string; result?: unknown }
}

export function saveIdeaReport(userId: string, report: IdeaReport) {
  const id = randomUUID()
  db.prepare('insert into idea_reports(id,user_id,audience,report_json,created_at) values(?,?,?,?,?)')
    .run(id, userId, report.audience, JSON.stringify(report), report.createdAt)
  return { id, ...report }
}

export function listIdeaReports(userId: string) {
  return (db.prepare('select id,audience,report_json,created_at from idea_reports where user_id=? order by created_at desc limit 20').all(userId) as any[])
    .map((row) => ({ id: row.id, audience: row.audience, createdAt: row.created_at, ...JSON.parse(row.report_json) }))
}
