import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'nodular-live-drafts-'))
process.env.DATA_DIR = dir
process.env.SCHEDULER = 'off'
const { db } = await import('../server/agent/db')
const { createStore } = await import('../server/store')
const { initAgents, runAgentAndWait, getThread } = await import('../server/agent/runtime')
const { saveLabSettings } = await import('../server/agent/idea-lab')
const { listIdeaReports } = await import('../server/agent/idea-finder')
const store = await createStore()
initAgents(store)
saveLabSettings('synthetic-model-test', { mission: 'Audience: independent bakeries. Explore human-reviewed pickup-order reconciliation using synthetic examples. No validated savings or revenue. Propose reversible zero-budget experiments.' })
try {
  const result = await runAgentAndWait('synthetic-model-test', 'morgan_idea_finder',
    'Explicit autonomous local drafting test. Read idea_lab_context and time_audit_search with its default 48-hour range (omit date arguments). Create exactly ten distinct AI business, career, skill, service or product hypotheses for the mission audience. Save them using idea_lab_save_draft with all required fields. SourceIds must be empty because there are no external sources. No new searches or idea_lab_research; no approval requests, publishing, outreach, spending, or income claims. Only say saved after the tool succeeds.',
    undefined, 600000)
  assert.equal(result.status, 'done', JSON.stringify(result))
  const reports = listIdeaReports('synthetic-model-test')
  assert.equal(reports.length, 1, JSON.stringify(getThread('synthetic-model-test', result.threadId)?.messages.filter((message) => message.role === 'tool').map(({ name, content }) => ({ name, content: content.slice(0, 500) }))))
  assert.equal(reports[0].ideas.length, 10)
  assert.equal(new Set(reports[0].ideas.map((idea) => idea.title)).size, 10)
  console.log(`PASS real autonomous agent: ${result.provider}:${result.model} saved ten distinct human-reviewable drafts through tools without external research or side effects.`)
} finally {
  store.close?.()
  db.close()
  rmSync(dir, { recursive: true, force: true })
}
