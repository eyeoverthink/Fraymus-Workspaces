// Portal bridge e2e against a running Workspaces server (BASE, default http://localhost:3001) and a
// running Fraymus Portal (`node portal/src/server.js --http` in Fraymus-OS-One, branch fraymus-portal).
// Set EXPECT_PORTAL_DOWN=1 to check the "unreachable" error path instead.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const BASE = process.env.BASE || 'http://localhost:3001'
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }
const post = (p, body) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json())

const tok = (await post('/api/access/tokens', { name: 't-portal', scopes: ['admin'] })).token
const c = new Client({ name: 'test-portal', version: '1' })
await c.connect(new StreamableHTTPClientTransport(new URL(BASE + '/mcp'), { requestInit: { headers: { Authorization: `Bearer ${tok}` } } }))
const call = async (name, args = {}) => {
  const r = await c.callTool({ name: 'call_tool', arguments: { name, arguments: args } })
  const text = r.content.map((x) => x.text).join('')
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { error: !!r.isError, text, json }
}

const listed = JSON.parse((await c.callTool({ name: 'list_tools', arguments: {} })).content[0].text)
const risk = Object.fromEntries(listed.filter((t) => t.name.startsWith('portal_')).map((t) => [t.name, t.risk]))
ok(risk.portal_list_tools === 'safe' && risk.portal_call === 'safe' && risk.portal_call_write === 'approval', `bridge tools registered ${JSON.stringify(risk)}`)

if (process.env.EXPECT_PORTAL_DOWN) {
  const r = await call('portal_call', { tool: 'studio_health' })
  console.log('  ', r.text.slice(0, 300))
  ok(r.error && /unreachable/.test(r.text), 'clear error when the portal is not running')
} else {
  const lt = await call('portal_list_tools')
  ok(!lt.error && lt.json?.tools?.length >= 16, `portal_list_tools: ${lt.json?.tools?.length} tools via ${lt.json?.portal}`)
  const h = await call('portal_call', { tool: 'studio_health' })
  console.log('   studio_health ->', JSON.stringify({ ok: h.json?.ok, health: h.json?.result?.health, platform: h.json?.result?.system?.platform, receipt: h.json?.receipt?.hash }))
  ok(!h.error && h.json?.ok === true && h.json?.receipt?.hash?.length === 64, 'portal_call studio_health')
  for (const goal of ['6 * 7', '100 - 37', '8 / 2']) {
    const t = await call('portal_call', { tool: 'brain_think', args: { goal } })
    const r = t.json?.result || {}
    console.log(`   brain_think "${goal}" -> verdict=${r.verdict} got=${r.got} expected=${r.expected} steps=${(r.steps || []).length} persisted=${r.persisted} receipt=${t.json?.receipt?.hash?.slice(0, 16)}`)
    ok(!t.error && t.json?.ok && r.got === r.expected && r.persisted === false, `portal_call brain_think "${goal}"`)
  }
  const w = await call('portal_call', { tool: 'site_publish', args: {} })
  ok(w.error && /portal_call_write/.test(w.text), 'write tool refused by portal_call')
  const p = await call('portal_call', { tool: 'brain_think', args: { goal: '1 + 1', persist: true } })
  ok(p.error && /persist/.test(p.text), 'brain_think persist=true refused by portal_call')
  const bad = await call('portal_call_write', { tool: 'no_such_tool' })
  ok(bad.error && /unknown portal tool/.test(bad.text), 'unknown portal tool reported')
}
await c.close()
