// Boots a throwaway server (mock LLM, temp data dir), runs every e2e suite against it, and tears it down.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = String(3100 + Math.floor(Math.random() * 500))
const base = `http://localhost:${port}`
const dataDir = mkdtempSync(join(tmpdir(), 'nodular-test-'))
const win = process.platform === 'win32'
// Throwaway owner identity. "local" (open mode) is intentionally not listed, so the
// HTTP suites still see approval prompts. MCP_ADMIN_TOKEN runs act as user_owner_test.
const env = {
  ...process.env,
  PORT: port,
  DATA_DIR: dataDir,
  LLM_PROVIDERS: 'none',
  BASE: base,
  BASE_URL: base,
  MCP_ADMIN_TOKEN: 'nodular-test-owner-admin-token-0001',
  MCP_ADMIN_USER: 'user_owner_test',
  OWNER_USER_IDS: 'user_owner_test',
  OWNER_USER_ID: ''
}
const server = spawn(win ? 'npx.cmd' : 'npx', ['tsx', 'server/index.ts'], { env, stdio: 'ignore', shell: win })
const stop = () => { if (win) spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); else server.kill() }

async function ready() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/health`)).ok) return } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('server did not start')
}
const run = (file) => new Promise((res) => spawn(process.execPath, [file], { env, stdio: 'inherit' }).on('close', res))

let failed = 0
try {
  await ready()
  console.log('\n== scripts/test-owner.ts')
  if (await new Promise((res) => spawn(win ? 'npx.cmd' : 'npx', ['tsx', 'scripts/test-owner.ts'], { env, stdio: 'inherit', shell: win }).on('close', res))) failed++
  for (const f of ['scripts/test-agent.mjs', 'scripts/test-mcp-server.mjs', 'scripts/test-workflow.mjs', 'scripts/test-automations.mjs']) {
    console.log(`\n== ${f}`)
    if (await run(f)) failed++
  }
} catch (e) { console.error(e.message); failed++ } finally {
  stop()
  setTimeout(() => { try { rmSync(dataDir, { recursive: true, force: true }) } catch {} process.exit(failed ? 1 : 0) }, 1500)
}
