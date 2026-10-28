const BASE = process.env.BASE_URL || 'http://localhost:3001'
const check = (condition, name) => {
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`)
  if (!condition) process.exitCode = 1
}

const integrations = await fetch(`${BASE}/api/integrations`).then((r) => r.json())
const byName = new Map((integrations.integrations || []).map((item) => [item.name, item]))
for (const name of ['notion', 'apollo', 'stripe', 'canva', 'linkedin', 'whisper']) {
  check(byName.has(name), `${name} integration status is exposed`)
}
check(!byName.get('apollo')?.connected && !byName.get('stripe')?.connected, 'sales integrations do not claim a provider connection without credentials')
check(!byName.get('canva')?.connected && !byName.get('linkedin')?.connected, 'OAuth integrations do not claim a provider connection without consent')
check(!byName.get('whisper')?.configured, 'local Whisper reports missing executable/model configuration')

const apollo = await fetch(`${BASE}/api/integrations/apollo`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey: 'apollo-test-key' })
})
check(apollo.status === 400 && /INTEGRATION_ENCRYPTION_KEY/.test((await apollo.json()).error), 'Apollo refuses to store a key without encryption')
const stripe = await fetch(`${BASE}/api/integrations/stripe`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secretKey: 'sk_test_fake_key' })
})
check(stripe.status === 400 && /INTEGRATION_ENCRYPTION_KEY/.test((await stripe.json()).error), 'Stripe refuses to store a key without encryption')

const canvaConnect = await fetch(`${BASE}/api/integrations/canva/connect`, { method: 'POST' })
check(canvaConnect.status === 400 && /CANVA_CLIENT_ID/.test((await canvaConnect.json()).error), 'Canva OAuth reports missing app configuration')
const canvaCallback = await fetch(`${BASE}/api/integrations/canva/callback?state=invalid&code=invalid`, { redirect: 'manual' })
check(canvaCallback.status === 302 && new URL(canvaCallback.headers.get('location')).searchParams.get('canva') === 'error', 'Canva OAuth callback rejects unknown state')
const linkedinConnect = await fetch(`${BASE}/api/integrations/linkedin/connect`, { method: 'POST' })
check(linkedinConnect.status === 400 && /LINKEDIN_CLIENT_ID/.test((await linkedinConnect.json()).error), 'LinkedIn OAuth reports missing app configuration')
const linkedinCallback = await fetch(`${BASE}/api/integrations/linkedin/callback?state=invalid&code=invalid`, { redirect: 'manual' })
check(linkedinCallback.status === 302 && new URL(linkedinCallback.headers.get('location')).searchParams.get('linkedin') === 'error', 'LinkedIn OAuth callback rejects unknown state')

const transcribe = await fetch(`${BASE}/api/integrations/whisper/transcribe`, { method: 'POST' })
check(transcribe.status === 503 && /WHISPER_CPP_PATH/.test((await transcribe.json()).error), 'Whisper transcribe reports the local setup blocker')

const status = await fetch(`${BASE}/api/agent/status`).then((r) => r.json())
const tools = new Map(status.tools.map((tool) => [tool.name, tool]))
const expected = {
  apollo_people_search: 'safe',
  stripe_search_customers: 'safe',
  stripe_create_invoice_draft: 'approval',
  notion_search: 'safe',
  notion_read_page: 'safe',
  notion_create_page: 'approval',
  canva_list_designs: 'safe',
  canva_create_design: 'approval',
  canva_create_export_job: 'approval',
  canva_get_export_job: 'safe',
  linkedin_publish_text: 'approval',
  whisper_transcribe_audio: 'safe'
}
for (const [name, risk] of Object.entries(expected)) check(tools.get(name)?.risk === risk, `${name} is registered as ${risk}`)
console.log(process.exitCode ? 'FAILED' : 'ALL PASSED')
