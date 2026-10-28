import type { Store } from './store'

const STRIPE = 'https://api.stripe.com/v1'
const enabled = () => !!process.env.STRIPE_SECRET_KEY

async function stripe(path: string, params: Record<string, string>) {
  const r = await fetch(STRIPE + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params)
  })
  const j: any = await r.json()
  if (!r.ok) throw new Error(`Stripe ${r.status}: ${j.error?.message || 'error'}`)
  return j
}

// Reports one metered unit per successful run; no-op unless Stripe is configured and the user has a customer id.
export async function reportRunUsage(store: Store, userId: string) {
  if (!enabled() || !process.env.STRIPE_METER_EVENT_NAME) return
  const user = await store.getUser(userId)
  if (!user?.stripe_customer_id) return
  try {
    await stripe('/billing/meter_events', {
      event_name: process.env.STRIPE_METER_EVENT_NAME,
      'payload[stripe_customer_id]': user.stripe_customer_id,
      'payload[value]': '1'
    })
  } catch (e) {
    console.error('Stripe usage report failed', e)
  }
}

export async function createCheckout(store: Store, userId: string, returnUrl: string) {
  if (!enabled() || !process.env.STRIPE_PRICE_ID) throw new Error('Stripe not configured (STRIPE_SECRET_KEY, STRIPE_PRICE_ID)')
  const user = await store.ensureUser(userId)
  let customer = user.stripe_customer_id
  if (!customer) {
    customer = (await stripe('/customers', { 'metadata[user_id]': userId })).id as string
    await store.setStripeCustomer(userId, customer)
  }
  const session = await stripe('/checkout/sessions', {
    mode: 'subscription',
    customer,
    'line_items[0][price]': process.env.STRIPE_PRICE_ID,
    success_url: returnUrl,
    cancel_url: returnUrl
  })
  return { url: session.url as string }
}
