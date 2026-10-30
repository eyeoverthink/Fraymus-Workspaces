// Shopify -> credits. orders/paid grants CREDITS_PER_PACK per pack unit to the buyer's email;
// refunds/create and orders/cancelled take back what is unspent. HMAC-verified, idempotent per order and per event.
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { normEmail, type Store } from './store'

export const shopCfg = () => ({
  secret: process.env.SHOPIFY_WEBHOOK_SECRET || '',
  shop: (process.env.SHOPIFY_SHOP_DOMAIN || 'eyeoverthink.myshopify.com').toLowerCase(),
  productIds: String(process.env.SHOPIFY_PACK_PRODUCT_ID || '8843401527492').split(',').map((s) => s.trim()).filter(Boolean),
  perPack: Number(process.env.SHOPIFY_CREDITS_PER_PACK || 25)
})

export function verifyShopifyHmac(raw: Buffer, header: string | undefined, secret: string) {
  if (!header || !secret) return false
  const digest = createHmac('sha256', secret).update(raw).digest()
  const given = Buffer.from(header, 'base64')
  return given.length === digest.length && timingSafeEqual(given, digest)
}

const isPack = (li: any, ids: string[]) => li && ids.includes(String(li.product_id))

export default async function shopifyWebhooks(app: FastifyInstance, opts: { store: Store }) {
  const { store } = opts
  // Scoped to this plugin: keep the raw bytes for the HMAC check
  app.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 2 * 1024 * 1024 }, (_req, body, done) => done(null, body))

  app.post('/webhooks/shopify', async (req, reply) => {
    const cfg = shopCfg()
    if (!cfg.secret) return reply.status(503).send({ error: 'SHOPIFY_WEBHOOK_SECRET not configured' })
    const raw = req.body as Buffer
    if (!Buffer.isBuffer(raw) || !verifyShopifyHmac(raw, req.headers['x-shopify-hmac-sha256'] as string, cfg.secret)) {
      return reply.status(401).send({ error: 'bad signature' })
    }
    if (String(req.headers['x-shopify-shop-domain'] || '').toLowerCase() !== cfg.shop) return reply.status(401).send({ error: 'wrong shop' })

    let body: any
    try { body = JSON.parse(raw.toString('utf8')) } catch { return reply.status(400).send({ error: 'bad json' }) }
    const topic = String(req.headers['x-shopify-topic'] || '')
    const eventId = String(req.headers['x-shopify-webhook-id'] || req.headers['x-shopify-event-id'] || '')
    if (eventId && !(await store.markEvent(`shopify:${eventId}`))) return { ok: true, duplicate: true }

    if (topic === 'orders/paid') {
      const orderId = String(body.id)
      const email = normEmail(body.email || body.contact_email || body.customer?.email)
      const qty = (body.line_items || []).filter((li: any) => isPack(li, cfg.productIds)).reduce((n: number, li: any) => n + Number(li.quantity || 0), 0)
      if (!email || !qty) return { ok: true, ignored: !email ? 'no email' : 'no pack in order' } // 200 so Shopify stops retrying
      const g = await store.grantOrder({ orderId, email, credits: qty * cfg.perPack, orderName: body.name })
      req.log.info({ orderId, granted: g.granted, credits: g.credits }, 'shopify grant')
      return { ok: true, granted: g.granted, credits: g.granted ? g.credits : 0, duplicate: !g.granted }
    }
    if (topic === 'refunds/create') {
      const orderId = String(body.order_id)
      const refundKey = `refund:${body.id}`
      if (body.id && !(await store.markEvent(refundKey))) return { ok: true, duplicate: true }
      const units = (body.refund_line_items || []).filter((r: any) => isPack(r.line_item, cfg.productIds)).reduce((n: number, r: any) => n + Number(r.quantity || 0), 0)
      if (!units) return { ok: true, ignored: 'no pack units refunded' } // e.g. money-only refund; handle by hand
      const r = await store.revokeOrder(orderId, units * cfg.perPack)
      req.log.warn({ orderId, ...r }, 'shopify refund revoke')
      return { ok: true, ...r }
    }
    if (topic === 'orders/cancelled') {
      const r = await store.revokeOrder(String(body.id), null)
      req.log.warn({ orderId: body.id, ...r }, 'shopify cancel revoke')
      return { ok: true, ...r }
    }
    return { ok: true, ignored: `topic ${topic}` }
  })
}
