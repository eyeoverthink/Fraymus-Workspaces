import { writeFileSync } from 'node:fs'
import { allTools, matchesTool } from '../server/agent/tools'
import { initMcp, mcpStatus } from '../server/agent/mcp'

const cfg = './data-test/mcp-test.json'
writeFileSync(cfg, JSON.stringify([
  { name: 'fake', command: 'npx', args: ['tsx', 'scripts/fake-mcp.ts'], safeTools: ['echo'] },
  { name: 'dead', url: 'http://127.0.0.1:9/mcp' },
  { name: 'gated', command: 'x', requires: ['NOPE_NOT_SET'] }
]))
await initMcp(cfg)
const ok = (c: boolean, m: string) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }
const st = Object.fromEntries(mcpStatus().map((x) => [x.name, x.status]))
ok(st.fake === 'connected' && st.dead === 'error' && st.gated === 'skipped', `status ${JSON.stringify(st)}`)
const echo = allTools().find((t) => t.name === 'fake__echo')!
const boom = allTools().find((t) => t.name === 'fake__boom')!
ok(echo?.risk === 'safe' && boom?.risk === 'approval', 'risk mapping')
ok((await echo.run({ text: 'hi' }, {} as any)) === 'echo:hi', 'call echo')
ok(await boom.run({}, {} as any).then(() => false, (e) => /kaboom/.test(e.message)), 'isError surfaces')
ok(matchesTool(['fake__*'], 'fake__echo') && !matchesTool(['fake__*'], 'other__echo'), 'wildcard')
process.exit()
