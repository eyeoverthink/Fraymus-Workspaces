const BASE = process.env.BASE_URL || 'http://localhost:3001'
const check = (condition, name) => {
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`)
  if (!condition) process.exitCode = 1
}

const statusResponse = await fetch(`${BASE}/api/integrations/google`)
const status = await statusResponse.json()
check(statusResponse.ok && status.name === 'google' && !status.configured && !status.connected, 'Google status reports missing config without claiming a connection')
check(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'INTEGRATION_ENCRYPTION_KEY (32+ characters)'].every((item) => status.missing.includes(item)), 'Google status lists required server settings')
check(!JSON.stringify(status).includes('access_token') && !JSON.stringify(status).includes('refresh_token'), 'Google status never returns OAuth tokens')

const connect = await fetch(`${BASE}/api/integrations/google/connect`, { method: 'POST' })
const connectBody = await connect.json()
check(connect.status === 400 && /GOOGLE_CLIENT_ID/.test(connectBody.error), 'OAuth initiation fails visibly until provider credentials are configured')

const callback = await fetch(`${BASE}/api/integrations/google/callback?state=not-a-valid-state&code=invalid`, { redirect: 'manual' })
check(callback.status === 302 && new URL(callback.headers.get('location')).searchParams.get('google') === 'error', 'OAuth callback rejects an unknown state')

const apiStatus = await fetch(`${BASE}/api/agent/status`).then((r) => r.json())
const byName = new Map(apiStatus.tools.map((tool) => [tool.name, tool]))
check(['google_gmail_search', 'google_gmail_create_draft', 'google_gmail_send', 'google_calendar_list_events', 'google_calendar_create_event'].every((name) => byName.has(name)), 'Gmail and Calendar tools are registered')
check(byName.get('google_gmail_search')?.risk === 'safe' && byName.get('google_calendar_list_events')?.risk === 'safe', 'Google read operations are safe')
check(['google_gmail_create_draft', 'google_gmail_send', 'google_calendar_create_event'].every((name) => byName.get(name)?.risk === 'approval'), 'Google writes require app approval')
check(apiStatus.tools.length >= 33, 'Google tools are included in app agent status')
console.log(process.exitCode ? 'FAILED' : 'ALL PASSED')
