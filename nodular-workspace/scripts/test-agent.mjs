// End-to-end agent test. Start the server with LLM_PROVIDERS=none to force the deterministic mock model.
const BASE = process.env.BASE_URL || 'http://localhost:3001'
const J = { 'Content-Type': 'application/json' }
const api = async (path, method = 'GET', body) => {
  const r = await fetch(BASE + path, { method, headers: body ? J : {}, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => ({}))
  return { ...j, status: r.status, body: j }
}
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1) } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(threadId, statuses) {
  for (let i = 0; i < 60; i++) {
    const t = await api('/api/agent/threads/' + threadId)
    if (statuses.includes(t.run?.status)) return t
    await sleep(250)
  }
  throw new Error('timeout waiting for ' + statuses)
}
const toolMsgs = (t, name) => t.messages.filter((m) => m.role === 'tool' && m.name === name)

const st = await api('/api/agent/status')
assert(st.mockFallback === true, 'expected mock fallback (start server with LLM_PROVIDERS=none)')
const skills = await fetch(BASE + '/api/skills').then((r) => r.json())
const fleet = skills.filter((skill) => skill.group === 'free-fleet')
assert(fleet.length === 34 && fleet.filter((skill) => skill.status === 'available').length === 15 && fleet.filter((skill) => skill.status === 'prompt_only').length === 19, 'fleet skills distinguish 15 runnable skills from 19 prompt-only skills')
const agents = await fetch(BASE + '/api/agents').then((r) => r.json())
assert(agents.length >= 15 && agents.some((a) => a.id === 'concierge') && !agents[0].systemPrompt, 'agents listed without prompts')
const morganAgents = agents.filter((a) => a.id.startsWith('morgan_'))
assert(morganAgents.length === 42 && ['morgan_house_manager', 'morgan_content_engine', 'morgan_revenue_agent'].every((id) => morganAgents.some((a) => a.id === id)), '40-role roster plus the two additional core agents is runnable')
const registeredTools = new Set(st.tools.map((tool) => tool.name))
assert(morganAgents.every((agent) => Array.isArray(agent.tools) && agent.tools.every((tool) => registeredTools.has(tool))), 'every roster persona references registered tools')
const contentEngine = morganAgents.find((a) => a.id === 'morgan_content_engine')
assert(!contentEngine.tools.includes('http_get') && !contentEngine.tools.includes('run_workflow'), 'content engine cannot directly fetch pages or run paid workflows')
console.log('1 status/agents/skills ok', agents.length, 'agents,', st.tools.length, 'tools,', fleet.length, 'fleet skills')

let r = await api('/api/agent/runs', 'POST', { agentId: 'concierge', message: 'remember that my favourite colour is teal' })
let t = await until(r.threadId, ['done', 'error'])
assert(t.run.status === 'done' && toolMsgs(t, 'memory_save').length === 1, 'memory_save run')
const mem = await fetch(BASE + '/api/agent/memories').then((r) => r.json())
assert(mem.some((m) => m.text.includes('teal')), 'memory persisted')
const actionLog = await fetch(BASE + '/api/agent/action-log?limit=200').then((r) => r.json())
assert(actionLog.some((entry) => entry.agent_id === 'concierge' && entry.action === 'memory_save' && entry.status === 'succeeded'), 'successful agent actions are audited')
assert(actionLog.every((entry) => !('args' in entry) && !('output' in entry)), 'audit entries omit arguments and private outputs')
console.log('2 tool loop + memory ok')

r = await api('/api/agent/runs', 'POST', { agentId: 'concierge', message: 'generate an image of a red fox' })
t = await until(r.threadId, ['awaiting_approval', 'done', 'error'])
if (t.run.status === 'awaiting_approval') {
  for (const approval of t.approvals) await api('/api/agent/approvals/' + approval.id, 'POST', { approve: true })
  t = await until(r.threadId, ['done', 'error'])
}
const img = JSON.parse(toolMsgs(t, 'generate_image')[0].content)
assert(t.run.status === 'done' && img.imageUrl, 'approved image tool')
assert((await fetch(BASE + img.imageUrl)).status === 200, 'image served')
console.log('3 generate_image ok', img.imageUrl)

r = await api('/api/agent/runs', 'POST', { agentId: 'concierge', message: 'fetch https://example.com' })
t = await until(r.threadId, ['awaiting_approval', 'done', 'error'])
assert(t.run.status === 'awaiting_approval' && t.approvals.length === 1 && t.approvals[0].tool === 'http_get', 'approval requested')
assert((await api('/api/agent/runs', 'POST', { agentId: 'concierge', message: 'hi', threadId: r.threadId })).status === 400, 'second run blocked while awaiting')
const ap = t.approvals[0]
const pendingLog = await fetch(BASE + '/api/agent/action-log?agentId=concierge&limit=200').then((r) => r.json())
assert(pendingLog.some((entry) => entry.action === 'http_get' && entry.status === 'approval_requested'), 'approval request is recorded')
const ok = await api('/api/agent/approvals/' + ap.id, 'POST', { approve: true })
assert(ok.status === 200, 'approve ok')
assert((await api('/api/agent/approvals/' + ap.id, 'POST', { approve: true })).status === 400, 'double approve rejected')
t = await until(r.threadId, ['done', 'error'])
assert(t.run.status === 'done' && /Example Domain/.test(toolMsgs(t, 'http_get')[0].content), 'approved fetch executed')
const approvedLog = await fetch(BASE + '/api/agent/action-log?agentId=concierge&limit=200').then((r) => r.json())
assert(approvedLog.some((entry) => entry.action === 'http_get' && entry.status === 'approved') && approvedLog.some((entry) => entry.action === 'http_get' && entry.status === 'succeeded'), 'approval and execution are separately audited')
console.log('4 approve flow ok')

r = await api('/api/agent/runs', 'POST', { agentId: 'concierge', message: 'fetch https://example.org' })
t = await until(r.threadId, ['awaiting_approval'])
await api('/api/agent/approvals/' + t.approvals[0].id, 'POST', { approve: false })
t = await until(r.threadId, ['done', 'error'])
assert(/rejected/i.test(toolMsgs(t, 'http_get')[0].content), 'rejection recorded')
console.log('5 reject flow ok')

r = await api('/api/agent/runs', 'POST', { agentId: 'concierge', message: 'fetch http://127.0.0.1:3001/health' })
t = await until(r.threadId, ['awaiting_approval'])
await api('/api/agent/approvals/' + t.approvals[0].id, 'POST', { approve: true })
t = await until(r.threadId, ['done', 'error'])
assert(/blocked/.test(toolMsgs(t, 'http_get')[0].content), 'SSRF blocked')
console.log('6 SSRF guard ok')

r = await api('/api/agent/runs', 'POST', { agentId: 'helix', message: 'generate an image of a cat' })
t = await until(r.threadId, ['done', 'error'])
assert(toolMsgs(t, 'generate_image').length === 0, 'helix has no image tool')
console.log('7 per-agent tool scoping ok')

r = await api('/api/agent/runs', 'POST', { agentId: 'genesis', message: 'ask lumen to generate an image of a lighthouse' })
t = await until(r.threadId, ['done', 'error'])
const d = JSON.parse(toolMsgs(t, 'delegate_to_agent')[0].content)
const delegatedLog = await fetch(BASE + '/api/agent/action-log?agentId=lumen&limit=200').then((r) => r.json())
assert(t.run.status === 'done' && /cannot be used in a delegated run/.test(d.answer) && delegatedLog.some((entry) => entry.action === 'generate_image' && entry.status === 'rejected'), 'delegation cannot bypass approval for billable tools')
console.log('8 delegation approval boundary ok')

const ca = await api('/api/agents', 'POST', { id: 'Shop Helper', name: 'Shop Helper', systemPrompt: 'You help with product shots.', tools: ['generate_image', 'nope'] })
assert(ca.id === 'shop_helper' && ca.tools.length === 1, 'custom agent')
r = await api('/api/agent/runs', 'POST', { agentId: 'shop_helper', message: 'draw a mug' })
t = await until(r.threadId, ['awaiting_approval', 'done', 'error'])
assert(t.run.status === 'awaiting_approval' && t.approvals.some((approval) => approval.tool === 'generate_image'), 'custom agent billable image action requires approval')
for (const approval of t.approvals) await api('/api/agent/approvals/' + approval.id, 'POST', { approve: true })
t = await until(r.threadId, ['done', 'error'])
assert(toolMsgs(t, 'generate_image').length === 1, 'approved custom agent image generation')
assert((await api('/api/agent/runs', 'POST', { agentId: 'concierge', message: 'x', threadId: r.threadId })).status === 400, 'thread/agent mismatch')
assert((await api('/api/agents', 'POST', { id: 'genesis', name: 'x', systemPrompt: 'x' })).status === 400, 'reserved id')
assert((await api('/api/agent/threads/' + r.threadId, 'DELETE')).ok, 'delete thread')
console.log('9 custom agents + thread rules ok')
console.log('ALL PASSED')
