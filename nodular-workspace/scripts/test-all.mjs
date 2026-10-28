// Boots a throwaway server (mock LLM, temp data dir), runs every e2e suite against it, and tears it down.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = String(3100 + Math.floor(Math.random() * 500))
const base = `http://localhost:${port}`
const dataDir = mkdtempSync(join(tmpdir(), 'nodular-test-'))
const env = {
  ...process.env, PORT: port, DATA_DIR: dataDir, LLM_PROVIDERS: 'none', BASE: base, BASE_URL: base,
  GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', INTEGRATION_ENCRYPTION_KEY: '',
  CANVA_CLIENT_ID: '', CANVA_CLIENT_SECRET: '', LINKEDIN_CLIENT_ID: '', LINKEDIN_CLIENT_SECRET: '',
  WHISPER_CPP_PATH: '', WHISPER_MODEL_PATH: '', IDEA_VISION_MODEL: '', IDEA_MODEL: ''
}
const server = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], { env, stdio: 'ignore' })
const stop = async () => {
  if (server.exitCode === null) {
    server.kill()
    await new Promise((resolve) => {
      if (server.exitCode !== null) return resolve()
      const timer = setTimeout(resolve, 3000)
      server.once('exit', () => { clearTimeout(timer); resolve() })
    })
  }
}

async function ready() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/health`)).ok) return } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('server did not start')
}
const run = (file) => new Promise((res) => spawn(process.execPath, file.endsWith('.ts') ? ['node_modules/tsx/dist/cli.mjs', file] : [file], { env, stdio: 'inherit' }).on('close', res))

let failed = 0
try {
  await ready()
  for (const f of ['scripts/test-agent.mjs', 'scripts/test-mcp-server.mjs', 'scripts/test-google.mjs', 'scripts/test-integrations.mjs', 'scripts/test-integration-logic.ts', 'scripts/test-workflow.mjs', 'scripts/test-automations.mjs', 'scripts/test-time-audit.mjs', 'scripts/test-idea-finder.mjs', 'scripts/test-idea-lab.ts', 'scripts/test-models-capture.ts', 'scripts/test-mega.ts', 'scripts/test-mega-http.mjs']) {
    console.log(`\n== ${f}`)
    if (await run(f)) failed++
  }
} catch (e) { console.error(e.message); failed++ } finally {
  await stop()
  try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
}
process.exitCode = failed ? 1 : 0
