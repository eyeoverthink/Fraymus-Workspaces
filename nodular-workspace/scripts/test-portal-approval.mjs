// Approval-path e2e for portal_call_write: an agent asks for a write, the run stops at
// awaiting_approval with nothing sent to the portal, then a reject and an approve are checked.
// Needs a running Workspaces server (BASE), the Fraymus Portal, the studio, and a working LLM provider.
// Run: node --env-file=.env scripts/test-portal-approval.mjs
// The approve step runs brain_think with persist:true, which saves the studio's mind (test goal only).
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const BASE = process.env.BASE || 'http://localhost:3001'
const AGENT = process.env.AGENT || 'genesis'
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }
const post = (p, body) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json())
const tok = (await post('/api/access/tokens', { name: 't-portal-approval', scopes: ['admin'] })).token
const c = new Client({ name: 'test-portal-approval', version: '1' })
await c.connect(new StreamableHTTPClientTransport(new URL(BASE + '/mcp'), { requestInit: { headers: { Authorization: `Bearer ${tok}` } } }))
const tool = async (name, args = {}) => {
  const r = await c.callTool({ name, arguments: args }, undefined, { timeout: 300_000 })
  const text = r.content.map((x) => x.text).join('')
  try { return JSON.parse(text) } catch { return { raw: text, isError: r.isError } }
}
// Receipt count straight from the portal (run with --env-file=.env so PORTAL_TOKEN is set).
const PORTAL = (process.env.PORTAL_URL || 'http://127.0.0.1:4191').replace(/\/$/, '')
const receipts = async () => (await fetch(PORTAL + '/receipts/verify', { headers: process.env.PORTAL_TOKEN ? { Authorization: `Bearer ${process.env.PORTAL_TOKEN}` } : {} }).then((r) => r.json())).count

async function ask(goal) {
  const msg = `Use the portal_call_write tool exactly once with {"tool":"brain_think","args":{"goal":"${goal}","persist":true}}. Do not call any other tool first. After it returns, reply with the result's got and persisted fields.`
  return tool('run_agent', { agentId: AGENT, message: msg, waitSeconds: 180 })
}
const pendingFor = (r) => (r.pendingApprovals || []).find((a) => a.tool === 'portal_call_write')

// 1) reject
let afterReject
const before = await receipts()
const r1 = await ask('4 * 4')
const p1 = pendingFor(r1)
console.log(`   run 1 status=${r1.status} provider=${r1.provider} model=${r1.model} pending=${JSON.stringify(p1?.args)}`)
ok(r1.status === 'awaiting_approval' && p1, 'portal_call_write stops at awaiting_approval')
const mid = await receipts()
ok(Number.isInteger(before) && mid === before, `nothing reached the portal while pending (receipts ${before} -> ${mid})`)
if (p1) {
  const d = await tool('decide_approval', { approvalId: p1.id, approve: false })
  ok(d.status === 'rejected', 'reject recorded')
  await new Promise((r) => setTimeout(r, 1500))
  const t = await tool('get_thread', { id: r1.threadId })
  const msg = t.messages.find((m) => m.role === 'tool' && m.name === 'portal_call_write')
  ok(msg && /rejected/.test(msg.content), 'agent got "The user rejected this action."')
  ok((await receipts()) === mid, 'rejected call never reached the portal')
  afterReject = await receipts()
}

// 2) approve
const r2 = await ask('3 * 5')
const p2 = pendingFor(r2)
console.log(`   run 2 status=${r2.status} pending=${JSON.stringify(p2?.args)}`)
ok(r2.status === 'awaiting_approval' && p2, 'second request awaiting approval')
if (p2) {
  const d = await tool('decide_approval', { approvalId: p2.id, approve: true })
  ok(d.status === 'approved', 'approve recorded')
  let t
  for (let i = 0; i < 120; i++) {
    t = await tool('get_thread', { id: r2.threadId })
    if (t.run?.status !== 'running') break
    await new Promise((r) => setTimeout(r, 1000))
  }
  const msg = t.messages.find((m) => m.role === 'tool' && m.name === 'portal_call_write')
  let res = {}
  try { res = JSON.parse(msg.content) } catch {}
  const r = res.result || {}
  console.log(`   approved -> ok=${res.ok} got=${r.got} expected=${r.expected} persisted=${r.persisted} startedFromStaged=${r.startedFromStaged} receipt=${res.receipt?.hash?.slice(0, 16)} run=${t.run?.status}`)
  ok(res.ok && r.persisted === true && r.got === r.expected && res.receipt?.hash?.length === 64, 'approved portal_call_write ran brain_think persist:true')
  ok(t.run?.status === 'done', 'run finished after approval')
  ok((await receipts()) === afterReject + 1, 'approved call wrote exactly one receipt')
  const last = [...t.messages].reverse().find((m) => m.role === 'assistant' && m.content)
  console.log('   agent reply:', (last?.content || '').slice(0, 200).replace(/\s+/g, ' '))
}
await c.close()
