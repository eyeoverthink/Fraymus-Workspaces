// Self-contained: boots its own servers (temp SQLite) and checks webhook -> credits -> buyer login -> spend/refund.
import { spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

const SECRET = 'test_whsec_' + Math.random().toString(36).slice(2)
const SHOP = 'eyeoverthink.myshopify.com'
const PACK = 8843401527492
let failures = 0
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) failures++ }

async function boot(extra) {
  const port = String(3600 + Math.floor(Math.random() * 300))
  const dataDir = mkdtempSync(join(tmpdir(), 'shopify-test-'))
  const env = { ...process.env, PORT: port, HOST: '127.0.0.1', DATA_DIR: dataDir, LLM_PROVIDERS: 'none', SCHEDULER: 'off',
    SHOPIFY_WEBHOOK_SECRET: SECRET, BUYER_CODE_DEV_ECHO: '1', NODE_ENV: 'test',
    GROQ_API_KEY: '', HF_TOKEN: '', REPLICATE_API_TOKEN: '', OPENAI_API_KEY: '', OPENAI_BASE_URL: '', CLERK_SECRET_KEY: '', SUPABASE_URL: '', FREE_CREDITS: '', ...extra }
  const p = spawn('npx', ['tsx', 'server/index.ts'], { env, stdio: process.env.DEBUG ? 'inherit' : 'ignore' })
  const base = `http://127.0.0.1:${port}`
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/health')).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }
  return { base, stop: () => { p.kill(); setTimeout(() => rmSync(dataDir, { recursive: true, force: true }), 800) } }
}

const sign = (body, secret = SECRET) => createHmac('sha256', secret).update(body).digest('base64')
async function hook(base, topic, payload, { secret, shop = SHOP, id = String(Math.random()) } = {}) {
  const body = JSON.stringify(payload)
  const r = await fetch(base + '/webhooks/shopify', { method: 'POST', body, headers: {
    'Content-Type': 'application/json', 'X-Shopify-Topic': topic, 'X-Shopify-Shop-Domain': shop,
    'X-Shopify-Hmac-Sha256': sign(body, secret), 'X-Shopify-Webhook-Id': id } })
  return { status: r.status, j: await r.json().catch(() => ({})) }
}
const post = async (base, path, body, token) => {
  const r = await fetch(base + path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } })
  return { status: r.status, j: await r.json().catch(() => ({})) }
}
const me = async (base, t) => (await (await fetch(base + '/buyer/me', { headers: { Authorization: 'Bearer ' + t } })).json())
async function login(base, email) {
  const s = await post(base, '/buyer/login/start', { email })
  const v = await post(base, '/buyer/login/verify', { email, code: s.j.devCode })
  return v.j.token
}
const order = (id, email, qty = 1, extra = []) => ({ id, name: '#' + id, email, financial_status: 'paid',
  line_items: [{ id: id * 10, product_id: PACK, quantity: qty }, ...extra] })

// ---------- Server A: strict (default) with no model keys -> paid runs must fail and refund ----------
let A = await boot({})
try {
  const base = A.base
  ok((await fetch(base + '/health')).ok, 'server A up')
  const local = await (await fetch(base + '/api/me')).json()
  ok(local.credits === 0, `new users get 0 free credits (got ${local.credits})`)

  // signature / shop checks
  const body = JSON.stringify(order(1001, 'Buyer@Example.com'))
  let r = await fetch(base + '/webhooks/shopify', { method: 'POST', body: body.replace('1001', '1002'), headers: { 'Content-Type': 'application/json', 'X-Shopify-Topic': 'orders/paid', 'X-Shopify-Shop-Domain': SHOP, 'X-Shopify-Hmac-Sha256': sign(body) } })
  ok(r.status === 401, 'tampered body -> 401')
  ok((await hook(base, 'orders/paid', order(1003, 'x@y.com'), { secret: 'wrong' })).status === 401, 'wrong secret -> 401')
  ok((await hook(base, 'orders/paid', order(1004, 'x@y.com'), { shop: 'evil.myshopify.com' })).status === 401, 'other shop domain -> 401')

  // grant + idempotency (same order, new webhook id = Shopify retry/duplicate topic)
  r = await hook(base, 'orders/paid', order(1001, 'Buyer@Example.com', 2))
  ok(r.status === 200 && r.j.granted && r.j.credits === 50, `orders/paid qty 2 grants 50 (${JSON.stringify(r.j)})`)
  r = await hook(base, 'orders/paid', order(1001, 'Buyer@Example.com', 2))
  ok(r.status === 200 && r.j.granted === false, 'same order again -> no second grant')
  r = await hook(base, 'orders/paid', order(1005, 'buyer@example.com', 1), { id: 'dup-1' })
  r = await hook(base, 'orders/paid', order(1006, 'buyer@example.com', 1), { id: 'dup-1' })
  ok(r.j.duplicate === true, 'same X-Shopify-Webhook-Id -> ignored')
  r = await hook(base, 'orders/paid', { id: 1007, email: 'other@example.com', line_items: [{ product_id: 1, quantity: 1 }] })
  ok(r.status === 200 && r.j.ignored, 'order without the pack -> 200 ignored')

  // buyer login (anti-enumeration + wrong code + lock)
  const unknown = await post(base, '/buyer/login/start', { email: 'nobody@example.com' })
  ok(unknown.status === 200 && !unknown.j.devCode, 'unknown email gets the same generic answer, no code')
  const s = await post(base, '/buyer/login/start', { email: 'buyer@example.com' })
  ok(/^\d{6}$/.test(s.j.devCode || ''), 'code issued for buyer (dev echo)')
  const wrong = s.j.devCode === '000000' ? '111111' : '000000'
  ok((await post(base, '/buyer/login/verify', { email: 'buyer@example.com', code: wrong })).status === 401, 'wrong code -> 401')
  const v = await post(base, '/buyer/login/verify', { email: 'BUYER@example.com', code: s.j.devCode })
  ok(v.status === 200 && v.j.token?.startsWith('bs_') && v.j.credits === 75, `verify -> session, 75 credits (${v.j.credits})`)
  ok((await post(base, '/buyer/login/verify', { email: 'buyer@example.com', code: s.j.devCode })).status === 401, 'code is single-use')
  const tok = v.j.token
  ok((await post(base, '/buyer/enhance', { prompt: 'x' }, 'bs_forged')).status === 401, 'forged session -> 401')

  // strict paid run with no HF/LLM keys -> fails, credit refunded
  r = await post(base, '/buyer/enhance', { prompt: 'red sneaker product shot' }, tok)
  ok(r.status === 502 && r.j.refunded && r.j.credits === 75, `strict run w/o keys fails + refunds (status ${r.status}, credits ${r.j.credits})`)
  console.log('     steps:', JSON.stringify(r.j.steps))

  // refunds/create: 1 pack unit of order 1001 -> -25; cancel 1005 -> -25; refund replay ignored
  r = await hook(base, 'refunds/create', { id: 9001, order_id: 1001, refund_line_items: [{ quantity: 1, line_item: { product_id: PACK } }] })
  ok(r.j.revoked === 25 && r.j.clawedBack === 25, `refund 1 unit revokes 25 (${JSON.stringify(r.j)})`)
  r = await hook(base, 'refunds/create', { id: 9001, order_id: 1001, refund_line_items: [{ quantity: 1, line_item: { product_id: PACK } }] })
  ok(r.j.duplicate === true, 'same refund id again -> ignored')
  r = await hook(base, 'orders/cancelled', { id: 1005 })
  ok(r.j.revoked === 25, `cancel order 1005 revokes its 25 (${JSON.stringify(r.j)})`)
  ok((await me(base, tok)).credits === 25, 'balance after refund + cancel = 25')
} finally { A.stop() }

// ---------- Server B: BUYER_PIPELINE_STRICT=0 (mocks allowed, local only) -> credit-spend success run ----------
const B = await boot({ BUYER_PIPELINE_STRICT: '0' })
try {
  const base = B.base
  await hook(base, 'orders/paid', order(2001, 'spend@example.com', 1))
  const tok = await login(base, 'spend@example.com')
  ok((await me(base, tok)).credits === 25, 'B: buyer has 25')
  const t0 = Date.now()
  const r = await post(base, '/buyer/enhance', { prompt: 'blue ceramic mug' }, tok)
  ok(r.status === 200 && r.j.credits === 24 && !r.j.refunded, `B: successful run spends 1 -> 24 (status ${r.status}, ${Date.now() - t0} ms)`)
  console.log('     steps:', JSON.stringify(r.j.steps))
  if (r.j.imageUrl) {
    const img = Buffer.from(await (await fetch(r.j.imageUrl)).arrayBuffer())
    const m = await sharp(img).metadata()
    ok(m.width === 4096 && m.hasAlpha, `B: output ${m.width}x${m.height} alpha=${m.hasAlpha}`)
  }
  // out of credits path
  const z = await hook(base, 'orders/cancelled', { id: 2001 })
  ok(z.j.revoked === 25 && z.j.clawedBack === 24 && z.j.shortfall === 1, `B: cancel after spending claws back 24, shortfall 1 (${JSON.stringify(z.j)})`)
  ok((await post(base, '/buyer/enhance', { prompt: 'x' }, tok)).status === 402, 'B: 0 credits -> 402')
} finally { B.stop() }

setTimeout(() => process.exit(failures ? 1 : 0), 1000)
console.log(failures ? `\n${failures} FAILED` : '\nall shopify/buyer checks passed')
