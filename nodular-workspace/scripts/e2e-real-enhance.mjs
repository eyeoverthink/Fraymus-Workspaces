// Real end-to-end buyer run: temp SQLite server, signed test webhook grants credits, buyer login, one strict enhancement.
// Uses real keys from the environment (HF_TOKEN, OPENAI_* / GROQ). Usage: node --env-file=.env scripts/e2e-real-enhance.mjs [out.png]
import { spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
const SECRET = 'e2e_' + Math.random().toString(36).slice(2), SHOP = 'eyeoverthink.myshopify.com', PACK = 8843401527492
const port = String(3900 + Math.floor(Math.random() * 90)), dataDir = mkdtempSync(join(tmpdir(), 'e2e-'))
const p = spawn('npx', ['tsx', 'server/index.ts'], { env: { ...process.env, PORT: port, HOST: '127.0.0.1', DATA_DIR: dataDir, SCHEDULER: 'off',
  SHOPIFY_WEBHOOK_SECRET: SECRET, BUYER_CODE_DEV_ECHO: '1', NODE_ENV: 'test', CLERK_SECRET_KEY: '', SUPABASE_URL: '', FREE_CREDITS: '' }, stdio: process.env.DEBUG ? 'inherit' : 'ignore' })
const base = `http://127.0.0.1:${port}`
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/health')).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }
  const body = JSON.stringify({ id: 9001, name: '#9001', email: 'e2e@example.com', financial_status: 'paid', line_items: [{ id: 90010, product_id: PACK, quantity: 1 }] })
  const h = await fetch(base + '/webhooks/shopify', { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'X-Shopify-Topic': 'orders/paid',
    'X-Shopify-Shop-Domain': SHOP, 'X-Shopify-Hmac-Sha256': createHmac('sha256', SECRET).update(body).digest('base64'), 'X-Shopify-Webhook-Id': 'e2e-1' } })
  console.log('webhook', h.status, await h.text())
  const post = async (path, b, t) => (await fetch(base + path, { method: 'POST', body: JSON.stringify(b), headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) } })).json()
  const s = await post('/buyer/login/start', { email: 'e2e@example.com' })
  const tok = (await post('/buyer/login/verify', { email: 'e2e@example.com', code: s.devCode })).token
  const t0 = Date.now()
  const r = await fetch(base + '/buyer/enhance', { method: 'POST', body: JSON.stringify({ prompt: process.env.E2E_PROMPT || 'matte black ceramic coffee mug with gold rim, product shot' }), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok } })
  const j = await r.json(); const ms = Date.now() - t0
  console.log('enhance', r.status, `${ms} ms`, JSON.stringify({ status: j.status, refunded: j.refunded, credits: j.credits, steps: j.steps }, null, 1))
  if (j.imageUrl) {
    const img = Buffer.from(await (await fetch(j.imageUrl)).arrayBuffer()); const m = await sharp(img).metadata()
    console.log(`output ${m.width}x${m.height} alpha=${m.hasAlpha} ${img.length} bytes`)
    if (process.argv[2]) { writeFileSync(process.argv[2], img); console.log('saved', process.argv[2]) }
  }
  process.exitCode = r.status === 200 ? 0 : 1
} finally { p.kill(); setTimeout(() => rmSync(dataDir, { recursive: true, force: true }), 800) }
