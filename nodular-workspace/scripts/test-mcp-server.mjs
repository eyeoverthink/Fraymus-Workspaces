import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const BASE = process.env.BASE || 'http://localhost:3001'
let bad = 0
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) { bad++; process.exitCode = 1 } }
const J = (r) => r.json()
const post = (p, body, h = {}) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body) })

async function mcp(token) {
  const c = new Client({ name: 'test', version: '1' })
  await c.connect(new StreamableHTTPClientTransport(new URL(BASE + '/mcp'), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
  const call = async (name, args = {}) => {
    const r = await c.callTool({ name, arguments: args })
    const text = r.content.map((x) => x.text).join('')
    return { error: !!r.isError, text, json: () => JSON.parse(text) }
  }
  return { c, call }
}

ok((await fetch(BASE + '/mcp', { method: 'POST' })).status === 401, '1 /mcp rejects anonymous')
ok((await fetch(BASE + '/.well-known/oauth-protected-resource').then(J)).resource.endsWith('/mcp'), '2 discovery metadata')

const readTok = (await post('/api/access/tokens', { name: 't-read', scopes: ['read', 'run'] }).then(J)).token
const adminTok = (await post('/api/access/tokens', { name: 't-admin', scopes: ['admin'] }).then(J)).token
ok(readTok?.startsWith('nw_') && adminTok?.startsWith('nw_'), '3 tokens issued')

const cl = await post('/api/access/clients', { name: 'openclaw', scopes: ['read', 'run'] }).then(J)
const basic = 'Basic ' + Buffer.from(`${cl.clientId}:${cl.clientSecret}`).toString('base64')
const tokRes = await fetch(BASE + '/oauth/token', { method: 'POST', headers: { authorization: basic, 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' })
const oauth = await tokRes.json()
ok(tokRes.status === 200 && oauth.access_token && oauth.expires_in === 3600, '4 oauth client_credentials (basic auth, form body)')
ok((await fetch(BASE + '/oauth/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'client_credentials', client_id: cl.clientId, client_secret: 'wrong' }) })).status === 401, '5 wrong secret rejected')
ok((await post('/oauth/token', { grant_type: 'client_credentials', client_id: cl.clientId, client_secret: cl.clientSecret, scope: 'admin' })).status === 400, '6 scope escalation rejected')

const o = await mcp(oauth.access_token)
const tools = (await o.c.listTools()).tools.map((t) => t.name)
ok(['list_agents', 'upsert_agent', 'run_agent', 'call_tool', 'import_mcp_server'].every((n) => tools.includes(n)), `7 oauth token lists ${tools.length} MCP tools`)
const agents = (await o.call('list_agents')).json()
ok(agents.length >= 16 && agents.some((a) => a.id === 'video_director'), `8 list_agents (${agents.length})`)
ok((await o.call('upsert_agent', { id: 'x_probe', name: 'X', systemPrompt: 'hi' })).error, '9 read/run token cannot alter agents')
ok((await o.call('call_tool', { name: 'list_workflows' })).error, '10 read/run token cannot call_tool')
const ran = (await o.call('run_agent', { agentId: 'concierge', message: 'hello from openclaw' })).json()
ok(ran.status === 'done' && ran.reply && ran.threadId, `11 run_agent via oauth (${ran.provider})`)

const a = await mcp(adminTok)
const up = await a.call('upsert_agent', { id: 'openclaw_helper', name: 'OpenClaw Helper', role: 'test', systemPrompt: 'You help.\nSecond line.', tools: ['memory_search', 'voicestudio__*', 'bogus_tool'] })
ok(!up.error && up.json().source === 'override', '12 admin creates agent manifest')
const got = (await a.call('get_agent', { id: 'openclaw_helper' })).json()
ok(got.systemPrompt.includes('Second line') && got.tools.join() === 'memory_search,voicestudio__*', '13 manifest round-trips, unknown tool dropped, wildcard kept')
const ui = await fetch(BASE + '/api/agents').then(J)
ok(ui.some((x) => x.id === 'openclaw_helper'), '14 agent visible in the app API')
await a.call('upsert_agent', { id: 'concierge', name: 'Concierge', systemPrompt: 'EDITED PROMPT', tools: '*' })
ok((await a.call('get_agent', { id: 'concierge' })).json().systemPrompt === 'EDITED PROMPT', '15 override replaces shipped default')
await a.call('reset_agent', { id: 'concierge' })
ok((await a.call('get_agent', { id: 'concierge' })).json().systemPrompt !== 'EDITED PROMPT', '16 reset restores default')
await a.call('reset_agent', { id: 'openclaw_helper' })

const wf = await a.call('call_tool', { name: 'list_workflows' })
ok(!wf.error, '17 admin call_tool')

const imp = await a.call('import_mcp_server', { name: 'selfmcp', url: BASE + '/mcp', headers: { Authorization: `Bearer ${adminTok}` } })
ok(!imp.error && imp.json()[0].status === 'connected', '18 import MCP server over http')
const tl = (await a.call('list_tools')).json()
ok(tl.some((t) => t.name === 'selfmcp__list_agents'), '19 imported tools registered as selfmcp__*')
const viaImported = await a.call('call_tool', { name: 'selfmcp__list_agents' })
ok(!viaImported.error && viaImported.text.includes('concierge'), '20 imported tool callable')
ok((await a.call('import_mcp_server', { name: 'evil', command: 'calc.exe' })).error, '21 stdio import blocked by default')
ok((await a.call('import_mcp_server', { mcpServers: { 'Bad Name': { url: 'http://x' } } })).error, '22 bad server name rejected')
ok(!(await a.call('remove_mcp_server', { name: 'selfmcp' })).error, '23 remove imported server')
ok(!(await a.call('list_tools')).json().some((t) => t.name.startsWith('selfmcp__')), '24 tools unregistered')

const pat = await fetch(BASE + '/api/access').then(J)
for (const t of pat.tokens.filter((t) => t.kind === 'pat')) await fetch(`${BASE}/api/access/tokens/${t.id}`, { method: 'DELETE' })
await fetch(`${BASE}/api/access/clients/${cl.clientId}`, { method: 'DELETE' })
ok((await fetch(BASE + '/mcp', { method: 'POST', headers: { authorization: `Bearer ${oauth.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' })).status === 401, '25 revoking a client kills its tokens')
console.log(bad ? `${bad} FAILED` : 'ALL PASSED')
process.exit(bad ? 1 : 0)
