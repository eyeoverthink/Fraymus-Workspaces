import type { FastifyInstance } from 'fastify'
import { db, now } from './db'
import { integrationEncryptionConfigured, openIntegrationSecret, sealIntegrationSecret } from './integration-secrets'
import { registerTools } from './tools'
import type { Tool } from './tools'

const APOLLO_API = 'https://api.apollo.io/api/v1'
const STRIPE_API = 'https://api.stripe.com/v1'

type CredentialRow = { secret_cipher: string; account_label: string; livemode?: number }

function apolloRow(userId: string) {
  return db.prepare('select api_key_cipher as secret_cipher, acting_user as account_label from apollo_connections where user_id=?').get(userId) as CredentialRow | undefined
}

function stripeRow(userId: string) {
  return db.prepare('select secret_cipher, account_label,livemode from stripe_connections where user_id=?').get(userId) as CredentialRow | undefined
}

async function providerJson(response: Response, provider: string) {
  const text = await response.text()
  let result: any = {}
  try { result = text ? JSON.parse(text) : {} } catch { result = { message: text.slice(0, 300) } }
  if (!response.ok) {
    const detail = result.error?.message || result.message || result.error || 'request rejected'
    throw new Error(`${provider} API ${response.status}: ${String(detail).slice(0, 300)}`)
  }
  return result
}

async function apolloRequest(userId: string, path: string, init?: RequestInit) {
  const row = apolloRow(userId)
  if (!row) throw new Error('Connect Apollo in Connect settings first')
  const key = openIntegrationSecret(row.secret_cipher)
  return providerJson(await fetch(`${APOLLO_API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'x-api-key': key, ...(init?.headers || {}) },
    signal: init?.signal || AbortSignal.timeout(20000)
  }), 'Apollo')
}

async function stripeRequest(userId: string, path: string, init?: RequestInit) {
  const row = stripeRow(userId)
  if (!row) throw new Error('Connect Stripe in Connect settings first')
  const key = openIntegrationSecret(row.secret_cipher)
  return providerJson(await fetch(`${STRIPE_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, ...(init?.headers || {}) },
    signal: init?.signal || AbortSignal.timeout(20000)
  }), 'Stripe')
}

function bounded(value: unknown, name: string, max: number) {
  const result = String(value ?? '').trim()
  if (!result || result.length > max) throw new Error(`${name} must contain 1-${max} characters`)
  return result
}

function redactedError(error: unknown, secret: string) {
  const message = error instanceof Error ? error.message : String(error)
  return secret ? message.split(secret).join('[redacted]') : message
}

function boundedList(value: unknown, name: string, maxItems: number, maxLength: number) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${name} must contain at most ${maxItems} values`)
  return value.map((item) => bounded(item, name, maxLength))
}

const salesTools: Tool[] = [
  {
    name: 'apollo_people_search',
    risk: 'safe',
    description: 'Search Apollo for up to 10 prospects using title, location, organization-domain, and keyword filters. Apollo documents this endpoint as zero-credit; it does not return email addresses or phone numbers.',
    parameters: {
      type: 'object',
      properties: {
        keywords: { type: 'string', maxLength: 100 },
        titles: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 80 } },
        locations: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 80 } },
        page: { type: 'integer', minimum: 1, maximum: 3 },
        perPage: { type: 'integer', minimum: 1, maximum: 10 }
      }
    },
    async run(args, ctx) {
      const keywords = args.keywords ? bounded(args.keywords, 'keywords', 100) : ''
      const titles = boundedList(args.titles, 'titles', 5, 80)
      const locations = boundedList(args.locations, 'locations', 5, 80)
      if (!keywords && !titles.length && !locations.length) throw new Error('provide at least one Apollo search filter')
      const page = Math.min(Math.max(Number(args.page) || 1, 1), 3)
      const perPage = Math.min(Math.max(Number(args.perPage) || 10, 1), 10)
      const url = new URL(`${APOLLO_API}/mixed_people/api_search`)
      if (keywords) url.searchParams.set('q_keywords', keywords)
      for (const title of titles) url.searchParams.append('person_titles[]', title)
      for (const location of locations) url.searchParams.append('person_locations[]', location)
      url.searchParams.set('page', String(page))
      url.searchParams.set('per_page', String(perPage))
      const result = await apolloRequest(ctx.userId, url.pathname + url.search, { method: 'POST' })
      if (!Array.isArray(result.people)) throw new Error('Apollo API returned an invalid people-search response')
      return {
        page,
        perPage,
        totalEntries: result.total_entries ?? result.pagination?.total_entries ?? null,
        people: (result.people || []).slice(0, perPage).map((person: any) => ({
          id: person.id,
          name: person.name || [person.first_name, person.last_name_obfuscated].filter(Boolean).join(' '),
          title: person.title,
          organization: person.organization_name || person.organization?.name || null,
          location: [person.city, person.state, person.country].filter(Boolean).join(', ') || null,
          linkedinUrl: person.linkedin_url || null
        }))
      }
    }
  },
  {
    name: 'stripe_search_customers',
    risk: 'safe',
    description: 'Find Stripe customers by exact email address in the connected Stripe account. Returns only customer ID, name, email, and creation time.',
    parameters: { type: 'object', properties: { email: { type: 'string', maxLength: 320 } }, required: ['email'] },
    async run(args, ctx) {
      const email = bounded(args.email, 'email', 320)
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('email must be one valid email address')
      const result = await stripeRequest(ctx.userId, `/customers/search?query=${encodeURIComponent(`email:'${email.replace(/'/g, "\\'")}'`)}&limit=10`)
      if (!Array.isArray(result.data)) throw new Error('Stripe API returned an invalid customer-search response')
      return { customers: (result.data || []).slice(0, 10).map((customer: any) => ({ id: customer.id, name: customer.name || null, email: customer.email || null, created: customer.created })) }
    }
  },
  {
    name: 'stripe_create_invoice_draft',
    risk: 'approval',
    description: 'Create a Stripe draft invoice for an existing customer with one fixed-amount line item. It is not finalized, sent, or charged; the app approval is required.',
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'string', pattern: '^cus_[A-Za-z0-9]+$' },
        amountMinor: { type: 'integer', minimum: 1, maximum: 100000000, description: 'Amount in the currency minor unit, e.g. cents for USD.' },
        currency: { type: 'string', pattern: '^[a-zA-Z]{3}$' },
        description: { type: 'string', minLength: 1, maxLength: 500 }
      },
      required: ['customerId', 'amountMinor', 'currency', 'description']
    },
    async run(args, ctx) {
      const customerId = bounded(args.customerId, 'customerId', 80)
      if (!/^cus_[A-Za-z0-9]+$/.test(customerId)) throw new Error('customerId must be a Stripe customer ID')
      const amountMinor = Number(args.amountMinor)
      if (!Number.isSafeInteger(amountMinor) || amountMinor < 1 || amountMinor > 100000000) throw new Error('amountMinor must be an integer from 1 to 100000000')
      const currency = bounded(args.currency, 'currency', 3).toLowerCase()
      if (!/^[a-z]{3}$/.test(currency)) throw new Error('currency must be a three-letter ISO currency code')
      const description = bounded(args.description, 'description', 500)
      const invoice = await stripeRequest(ctx.userId, '/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          customer: customerId,
          collection_method: 'send_invoice',
          days_until_due: '30',
          auto_advance: 'false'
        })
      })
      if (typeof invoice.id !== 'string' || !invoice.id.startsWith('in_')) throw new Error('Stripe API returned an invalid invoice response')
      try {
        const item = await stripeRequest(ctx.userId, '/invoiceitems', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            customer: customerId,
            invoice: invoice.id,
            amount: String(amountMinor),
            currency,
            description
          })
        })
        if (typeof item.id !== 'string' || !item.id.startsWith('ii_')) throw new Error('Stripe API returned an invalid invoice-item response')
      } catch (error) {
        try {
          await stripeRequest(ctx.userId, `/invoices/${encodeURIComponent(invoice.id)}`, { method: 'DELETE' })
        } catch (cleanupError) {
          throw new Error(`Stripe created draft ${invoice.id}, but its line item failed and draft cleanup also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`)
        }
        throw error
      }
      return { created: true, invoiceId: invoice.id, customerId, status: 'draft', amountMinor, currency, finalized: false, sent: false, charged: false }
    }
  }
]

export function registerSalesTools() {
  registerTools(salesTools)
}

export function salesIntegrationStatus(userId: string) {
  const apollo = apolloRow(userId)
  const stripe = stripeRow(userId)
  return [
    {
      name: 'apollo',
      configured: integrationEncryptionConfigured(),
      missing: integrationEncryptionConfigured() ? [] : ['INTEGRATION_ENCRYPTION_KEY (32+ characters)'],
      connected: !!apollo && integrationEncryptionConfigured(),
      credentialStored: !!apollo,
      account: apollo?.account_label || null,
      capabilities: ['Search people (Apollo states 0 credits; account eligibility and rate limits apply)']
    },
    {
      name: 'stripe',
      configured: integrationEncryptionConfigured(),
      missing: integrationEncryptionConfigured() ? [] : ['INTEGRATION_ENCRYPTION_KEY (32+ characters)'],
      connected: !!stripe && integrationEncryptionConfigured(),
      credentialStored: !!stripe,
      account: stripe?.account_label || null,
      livemode: !!stripe?.livemode,
      capabilities: ['Search customers by exact email', 'Create an approved draft invoice only']
    }
  ]
}

export function registerSalesRoutes(app: FastifyInstance) {
  app.get('/api/integrations/apollo', async (req) => salesIntegrationStatus((req as any).userId)[0])
  app.post('/api/integrations/apollo', async (req, reply) => {
    const apiKey = String(((req.body as any) || {}).apiKey || '').trim()
    if (!integrationEncryptionConfigured()) return reply.status(400).send({ error: 'Set INTEGRATION_ENCRYPTION_KEY (at least 32 characters) on the server before connecting Apollo' })
    if (apiKey.length < 10 || apiKey.length > 512) return reply.status(400).send({ error: 'Enter a valid Apollo API key' })
    try {
      const result = await providerJson(await fetch(`${APOLLO_API}/auth/health`, {
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(15000)
      }), 'Apollo')
      const user = result.user || result
      const actingUser = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || 'Apollo workspace'
      db.prepare('insert into apollo_connections(user_id,api_key_cipher,acting_user,updated_at) values(?,?,?,?) on conflict(user_id) do update set api_key_cipher=excluded.api_key_cipher,acting_user=excluded.acting_user,updated_at=excluded.updated_at')
        .run((req as any).userId, sealIntegrationSecret(apiKey), String(actingUser).slice(0, 200), now())
      return salesIntegrationStatus((req as any).userId)[0]
    } catch (error) {
      return reply.status(400).send({ error: redactedError(error, apiKey) })
    }
  })
  app.delete('/api/integrations/apollo', async (req) => {
    const result = db.prepare('delete from apollo_connections where user_id=?').run((req as any).userId)
    return { ok: true, disconnected: Number(result.changes) > 0 }
  })

  app.get('/api/integrations/stripe', async (req) => salesIntegrationStatus((req as any).userId)[1])
  app.post('/api/integrations/stripe', async (req, reply) => {
    const secret = String(((req.body as any) || {}).secretKey || '').trim()
    if (!integrationEncryptionConfigured()) return reply.status(400).send({ error: 'Set INTEGRATION_ENCRYPTION_KEY (at least 32 characters) on the server before connecting Stripe' })
    if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(secret)) return reply.status(400).send({ error: 'Enter a Stripe secret or restricted key (sk_* or rk_*); publishable keys cannot be used by the server' })
    try {
      const account = await providerJson(await fetch(`${STRIPE_API}/account`, {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(15000)
      }), 'Stripe')
      if (typeof account.id !== 'string' || !account.id.startsWith('acct_')) throw new Error('Stripe API returned an invalid account response')
      const label = account.business_profile?.name || account.settings?.dashboard?.display_name || account.email || account.id
      db.prepare('insert into stripe_connections(user_id,secret_cipher,account_id,account_label,livemode,updated_at) values(?,?,?,?,?,?) on conflict(user_id) do update set secret_cipher=excluded.secret_cipher,account_id=excluded.account_id,account_label=excluded.account_label,livemode=excluded.livemode,updated_at=excluded.updated_at')
        .run((req as any).userId, sealIntegrationSecret(secret), String(account.id), String(label || 'Stripe account').slice(0, 200), account.livemode ? 1 : 0, now())
      return salesIntegrationStatus((req as any).userId)[1]
    } catch (error) {
      return reply.status(400).send({ error: redactedError(error, secret) })
    }
  })
  app.delete('/api/integrations/stripe', async (req) => {
    const result = db.prepare('delete from stripe_connections where user_id=?').run((req as any).userId)
    return { ok: true, disconnected: Number(result.changes) > 0 }
  })
}
