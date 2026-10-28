import { randomUUID } from 'node:crypto'

process.env.INTEGRATION_ENCRYPTION_KEY = 'integration-logic-test-key-'.padEnd(32, 'x')

const { db, now } = await import('../server/agent/db')
const { sealIntegrationSecret } = await import('../server/agent/integration-secrets')
const { registerNotionTools } = await import('../server/agent/notion')
const { registerSalesTools } = await import('../server/agent/sales')
const { canvaConfiguration, canvaIntegrationStatus, registerCanvaTools } = await import('../server/agent/canva')
const { linkedinConfiguration, linkedinIntegrationStatus, registerLinkedInTools } = await import('../server/agent/linkedin')
const { allTools } = await import('../server/agent/tools')

const userId = `integration-test-${randomUUID()}`
const check = (condition: unknown, name: string) => {
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`)
  if (!condition) throw new Error(name)
}
const jsonResponse = (body: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

registerNotionTools()
registerSalesTools()
registerCanvaTools()
registerLinkedInTools()
const tools = allTools()
const getTool = (name: string) => {
  const tool = tools.find((item) => item.name === name)
  if (!tool) throw new Error(`Missing registered tool ${name}`)
  return tool
}
const ctx = { userId, agentId: 'integration-test', threadId: 'integration-test', depth: 0, store: {} as any, delegate: async () => '' }
const secret = (value: string) => sealIntegrationSecret(value)
const tokenRow = (access: string, refresh = 'refresh-test') => secret(JSON.stringify({ access_token: access, refresh_token: refresh, expires_at: now() + 60 * 60_000 }))

const originalNodeEnv = process.env.NODE_ENV
const originalPublicUrl = process.env.PUBLIC_URL
process.env.NODE_ENV = 'production'
delete process.env.PUBLIC_URL
check(canvaConfiguration().missing.includes('PUBLIC_URL (HTTPS OAuth callback origin)') && canvaIntegrationStatus(userId, { protocol: 'http', headers: { host: 'localhost' } }).callbackUrl === null, 'Canva status reports missing production callback origin without failing')
check(linkedinConfiguration().missing.includes('PUBLIC_URL (HTTPS OAuth callback origin)') && linkedinIntegrationStatus(userId, { protocol: 'http', headers: { host: 'localhost' } }).callbackUrl === null, 'LinkedIn status reports missing production callback origin without failing')
if (originalNodeEnv === undefined) delete process.env.NODE_ENV
else process.env.NODE_ENV = originalNodeEnv
if (originalPublicUrl === undefined) delete process.env.PUBLIC_URL
else process.env.PUBLIC_URL = originalPublicUrl

db.prepare('insert into notion_connections(user_id,workspace_name,bot_name,token_cipher,updated_at) values(?,?,?,?,?)')
  .run(userId, 'Test workspace', 'Test integration', secret('notion-secret'), now())
db.prepare('insert into apollo_connections(user_id,api_key_cipher,acting_user,updated_at) values(?,?,?,?)')
  .run(userId, secret('apollo-test-key'), 'Apollo test workspace', now())
db.prepare('insert into stripe_connections(user_id,secret_cipher,account_id,account_label,livemode,updated_at) values(?,?,?,?,?,?)')
  .run(userId, secret('sk_test_unit'), 'acct_test', 'Stripe test account', 0, now())
db.prepare('insert into canva_connections(user_id,token_cipher,expires_at,updated_at) values(?,?,?,?)')
  .run(userId, tokenRow('canva-access'), now() + 60 * 60_000, now())
db.prepare('insert into linkedin_connections(user_id,token_cipher,person_urn,display_name,expires_at,updated_at) values(?,?,?,?,?,?)')
  .run(userId, secret(JSON.stringify({ access_token: 'linkedin-access' })), 'urn:li:person:test-member', 'Test Member', now() + 60 * 60_000, now())

const originalFetch = globalThis.fetch
let notionChildPageRequests = 0
const calls: { url: string; init: RequestInit }[] = []
globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = new URL(String(input))
  calls.push({ url: url.toString(), init })
  if (url.hostname === 'api.notion.com') {
    check(new Headers(init.headers).get('Notion-Version') === '2026-03-11', 'Notion uses the current supported API version')
    if (url.pathname === '/v1/search') return jsonResponse({
      results: [{ object: 'data_source', id: 'data-source-id', title: [{ plain_text: 'Editorial calendar' }], url: 'https://notion.so/editorial' }],
      has_more: false
    })
    if (url.pathname === '/v1/pages/0123456789abcdef0123456789abcdef') return jsonResponse({
      id: 'page-id', object: 'page', url: 'https://notion.so/page',
      properties: { Name: { type: 'title', title: [{ plain_text: 'Project notes' }] } }
    })
    if (url.pathname === '/v1/blocks/0123456789abcdef0123456789abcdef/children') {
      notionChildPageRequests++
      if (url.searchParams.get('start_cursor') === 'next') return jsonResponse({
        results: [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Second page text' }] } }],
        has_more: false,
        next_cursor: null
      })
      return jsonResponse({
        results: [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'First page text' }] } }],
        has_more: true,
        next_cursor: 'next'
      })
    }
    if (url.pathname === '/v1/pages' && init.method === 'POST') return jsonResponse({ id: 'created-page', url: 'https://notion.so/created', properties: { Name: { type: 'title', title: [{ plain_text: 'Created' }] } } })
    throw new Error(`Unexpected Notion request: ${url}`)
  }
  if (url.hostname === 'api.apollo.io') {
    check(new Headers(init.headers).get('x-api-key') === 'apollo-test-key', 'Apollo API key is decrypted only for the provider call')
    check(init.method === 'POST' && url.searchParams.get('q_keywords') === 'founder' && url.searchParams.get('per_page') === '10', 'Apollo search uses its documented POST query parameters')
    return jsonResponse({
      total_entries: 1,
      people: [{ id: 'person-1', first_name: 'Jordan', last_name_obfuscated: 'Ex***', title: 'Founder', organization: { name: 'Example Co' }, city: 'Seattle', email: 'private@example.com', phone_number: '+15555550123' }]
    })
  }
  if (url.hostname === 'api.stripe.com') {
    check(new Headers(init.headers).get('authorization') === 'Bearer sk_test_unit', 'Stripe secret is decrypted only for the provider call')
    if (url.pathname.endsWith('/customers/search')) return jsonResponse({ data: [{ id: 'cus_1', name: 'Jordan', email: 'jordan@example.com', created: 123 }] })
    if (url.pathname === '/v1/invoices' && init.method === 'POST') return jsonResponse({ id: 'in_draft_1', status: 'draft' })
    if (url.pathname === '/v1/invoiceitems' && init.method === 'POST') return jsonResponse({ id: 'ii_1' })
    throw new Error(`Unexpected Stripe request: ${url}`)
  }
  if (url.hostname === 'api.canva.com') {
    check(new Headers(init.headers).get('authorization') === 'Bearer canva-access', 'Canva user access token is decrypted only for the provider call')
    if (url.pathname === '/rest/v1/designs' && init.method !== 'POST') return jsonResponse({ items: [{ id: 'design-1', title: 'Launch', urls: { edit_url: 'https://canva.com/design/1' } }], continuation: 'next-page' })
    if (url.pathname === '/rest/v1/designs' && init.method === 'POST') return jsonResponse({ design: { id: 'design-2', title: 'Presentation', urls: { edit_url: 'https://canva.com/design/2' } } })
    if (url.pathname === '/rest/v1/exports' && init.method === 'POST') return jsonResponse({ job: { id: 'export-1', status: 'in_progress' } })
    if (url.pathname === '/rest/v1/exports/export-1') return jsonResponse({ job: { id: 'export-1', status: 'success', urls: ['https://download.canva.com/temporary'] } })
    throw new Error(`Unexpected Canva request: ${url}`)
  }
  if (url.hostname === 'api.linkedin.com') {
    check(new Headers(init.headers).get('authorization') === 'Bearer linkedin-access', 'LinkedIn member token is decrypted only for the provider call')
    return new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:post-1' } })
  }
  throw new Error(`Unexpected external request: ${url}`)
}) as typeof fetch

try {
  const notionSearch = await getTool('notion_search').run({ query: 'Editorial' }, ctx) as any
  check(notionSearch.results[0]?.type === 'data_source' && notionSearch.results[0]?.title === 'Editorial calendar', 'Notion search supports current data-source results')
  const notionRead = await getTool('notion_read_page').run({ pageId: '01234567-89ab-cdef-0123-456789abcdef' }, ctx) as any
  check(notionRead.content === 'First page text\nSecond page text' && notionChildPageRequests === 2, 'Notion page reader follows child-block cursors')
  const notionCreated = await getTool('notion_create_page').run({ parentPageId: '01234567-89ab-cdef-0123-456789abcdef', title: 'Created', content: 'New page' }, ctx) as any
  check(notionCreated.created && notionCreated.id === 'created-page', 'Notion approved page tool creates a child page')

  const prospects = await getTool('apollo_people_search').run({ keywords: 'founder' }, ctx) as any
  check(prospects.people[0]?.name === 'Jordan Ex***' && prospects.totalEntries === 1 && !('email' in prospects.people[0]) && !('phone_number' in prospects.people[0]), 'Apollo results use documented partial names and omit email/phone fields')

  const customers = await getTool('stripe_search_customers').run({ email: 'jordan@example.com' }, ctx) as any
  check(customers.customers[0]?.id === 'cus_1', 'Stripe exact-email customer search works')
  const draft = await getTool('stripe_create_invoice_draft').run({ customerId: 'cus_1', amountMinor: 1250, currency: 'usd', description: 'Approved work' }, ctx) as any
  const invoiceRequest = calls.find((call) => new URL(call.url).pathname === '/v1/invoices')
  const itemRequest = calls.find((call) => new URL(call.url).pathname === '/v1/invoiceitems')
  check(draft.status === 'draft' && !draft.finalized && !draft.sent && !draft.charged, 'Stripe invoice tool only returns a draft, never a charge')
  check(String(invoiceRequest?.init.body).includes('auto_advance=false') && String(itemRequest?.init.body).includes('amount=1250'), 'Stripe draft and fixed line item use the requested amount')

  const designs = await getTool('canva_list_designs').run({ query: 'Launch' }, ctx) as any
  check(designs.designs[0]?.id === 'design-1' && designs.continuation === 'next-page', 'Canva design listing returns metadata and continuation')
  const createdDesign = await getTool('canva_create_design').run({ title: 'Presentation', preset: 'presentation' }, ctx) as any
  check(createdDesign.created && createdDesign.designId === 'design-2', 'Canva approved create-design tool uses the preset API')
  const exportJob = await getTool('canva_create_export_job').run({ designId: 'design-2', format: 'pdf' }, ctx) as any
  const exportStatus = await getTool('canva_get_export_job').run({ jobId: exportJob.jobId }, ctx) as any
  check(exportStatus.status === 'success' && exportStatus.urls.length === 1, 'Canva export job status returns provider URLs')

  const published = await getTool('linkedin_publish_text').run({ text: 'Approved message', confirmPublish: true }, ctx) as any
  const postCall = calls.find((call) => new URL(call.url).pathname === '/rest/posts')
  const postBody = JSON.parse(String(postCall?.init.body))
  check(published.published && published.postId === 'urn:li:share:post-1', 'LinkedIn publish returns the provider post identifier')
  check(postBody.author === 'urn:li:person:test-member' && postBody.lifecycleState === 'PUBLISHED' && postBody.commentary === 'Approved message', 'LinkedIn sends one explicit public text post')
} finally {
  globalThis.fetch = originalFetch
  for (const table of ['notion_connections', 'apollo_connections', 'stripe_connections', 'canva_connections', 'linkedin_connections']) {
    db.prepare(`delete from ${table} where user_id=?`).run(userId)
  }
  db.close()
}

console.log('ALL PASSED')
