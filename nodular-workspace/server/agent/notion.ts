import type { FastifyInstance } from 'fastify'
import { db, now } from './db'
import { integrationEncryptionConfigured, openIntegrationSecret, sealIntegrationSecret } from './integration-secrets'
import { registerTools } from './tools'
import type { Tool } from './tools'

const API = 'https://api.notion.com/v1'
const VERSION = '2022-06-28'
type NotionConnection = { workspace_name: string; bot_name: string; token_cipher: string }

function rowFor(userId: string) {
  return db.prepare('select workspace_name,bot_name,token_cipher from notion_connections where user_id=?').get(userId) as NotionConnection | undefined
}

function pageId(value: unknown) {
  const id = String(value || '').trim()
  if (!/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(id)) throw new Error('pageId must be a Notion page UUID')
  return id.replace(/-/g, '').toLowerCase()
}

function titleOf(result: any) {
  if (result.object === 'database') return (result.title || []).map((part: any) => part.plain_text || part.text?.content || '').join('')
  const properties = Object.values(result.properties || {}) as any[]
  const title = properties.find((property) => property.type === 'title')?.title || []
  return title.map((part: any) => part.plain_text || part.text?.content || '').join('')
}

async function notionRequest(token: string, path: string, init?: RequestInit) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': VERSION,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {})
    },
    signal: init?.signal || AbortSignal.timeout(20000)
  })
  const text = await response.text()
  let result: any = {}
  try { result = text ? JSON.parse(text) : {} } catch { result = { message: text.slice(0, 300) } }
  if (!response.ok) {
    const message = result.message || result.error || 'request rejected'
    throw new Error(`Notion API ${response.status}: ${String(message).slice(0, 300)}`)
  }
  return result
}

async function withToken<T>(userId: string, run: (token: string) => Promise<T>): Promise<T> {
  const connection = rowFor(userId)
  if (!connection) throw new Error('Connect a Notion integration in Connect settings first')
  return run(openIntegrationSecret(connection.token_cipher))
}

function blocksText(block: any) {
  const value = block[block.type] || {}
  if (Array.isArray(value.rich_text)) return value.rich_text.map((part: any) => part.plain_text || part.text?.content || '').join('')
  if (Array.isArray(value.title)) return value.title.map((part: any) => part.plain_text || part.text?.content || '').join('')
  return value.title || value.url || ''
}

const notionTools: Tool[] = [
  {
    name: 'notion_search', risk: 'safe',
    description: 'Search pages and databases shared with the connected Notion integration. Returns titles and page IDs, not page contents.',
    parameters: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 200 }, pageSize: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['query'] },
    async run(args, ctx) {
      const query = String(args.query || '').trim()
      if (!query || query.length > 200) throw new Error('query must contain 1-200 characters')
      const pageSize = Math.min(Math.max(Number(args.pageSize) || 10, 1), 10)
      return withToken(ctx.userId, async (token) => {
        const result = await notionRequest(token, '/search', { method: 'POST', body: JSON.stringify({ query, page_size: pageSize, sort: { direction: 'descending', timestamp: 'last_edited_time' } }) })
        return {
          query,
          results: (result.results || []).map((item: any) => ({ id: item.id, type: item.object, title: titleOf(item), url: item.url, lastEditedTime: item.last_edited_time })),
          hasMore: !!result.has_more
        }
      })
    }
  },
  {
    name: 'notion_read_page', risk: 'safe',
    description: 'Read one Notion page shared with the connected integration, returning title and up to 12,000 characters of direct child-block text.',
    parameters: { type: 'object', properties: { pageId: { type: 'string' } }, required: ['pageId'] },
    async run(args, ctx) {
      const id = pageId(args.pageId)
      return withToken(ctx.userId, async (token) => {
        const [page, children] = await Promise.all([
          notionRequest(token, `/pages/${encodeURIComponent(id)}`),
          notionRequest(token, `/blocks/${encodeURIComponent(id)}/children?page_size=100`)
        ])
        let text = ''
        for (const block of children.results || []) {
          const value = blocksText(block).trim()
          if (!value) continue
          const next = `${text}${text ? '\n' : ''}${value}`
          if (next.length > 12000) {
            text = next.slice(0, 12000)
            break
          }
          text = next
        }
        return { id: page.id, title: titleOf(page), url: page.url, lastEditedTime: page.last_edited_time, content: text, truncated: !!children.has_more || text.length >= 12000 }
      })
    }
  },
  {
    name: 'notion_create_page', risk: 'approval',
    description: 'Create a child page in a user-selected Notion page with plain-text content. Requires app approval; it does not edit or delete existing pages.',
    parameters: { type: 'object', properties: { parentPageId: { type: 'string' }, title: { type: 'string', minLength: 1, maxLength: 200 }, content: { type: 'string', minLength: 1, maxLength: 20000 } }, required: ['parentPageId', 'title', 'content'] },
    async run(args, ctx) {
      const parentPage = pageId(args.parentPageId)
      const title = String(args.title || '').trim()
      const content = String(args.content || '').trim()
      if (!title || title.length > 200) throw new Error('title must contain 1-200 characters')
      if (!content || content.length > 20000) throw new Error('content must contain 1-20000 characters')
      const paragraphs = content.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
      const chunks: string[] = []
      for (const paragraph of paragraphs) {
        for (let offset = 0; offset < paragraph.length; offset += 1800) chunks.push(paragraph.slice(offset, offset + 1800))
      }
      if (chunks.length > 100) throw new Error('content would exceed Notion’s 100 child-block limit')
      return withToken(ctx.userId, async (token) => {
        const page = await notionRequest(token, '/pages', {
          method: 'POST',
          body: JSON.stringify({
            parent: { page_id: parentPage },
            properties: { title: { title: [{ text: { content: title } }] } },
            children: chunks.map((part) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: part } }] } }))
          })
        })
        return { created: true, id: page.id, title: titleOf(page), url: page.url, parentPageId: parentPage }
      })
    }
  }
]

export function registerNotionTools() {
  registerTools(notionTools)
}

export function notionIntegrationStatus(userId: string) {
  const connection = rowFor(userId)
  return {
    name: 'notion',
    configured: integrationEncryptionConfigured(),
    missing: integrationEncryptionConfigured() ? [] : ['INTEGRATION_ENCRYPTION_KEY (32+ characters)'],
    connected: !!connection,
    workspace: connection?.workspace_name || null,
    integrationName: connection?.bot_name || null,
    capabilities: ['Search shared pages', 'Read page text', 'Create an approved child page']
  }
}

export function registerNotionRoutes(app: FastifyInstance) {
  app.get('/api/integrations/notion', async (req) => notionIntegrationStatus((req as any).userId))
  app.post('/api/integrations/notion', async (req, reply) => {
    const token = String(((req.body as any) || {}).token || '').trim()
    if (!integrationEncryptionConfigured()) return reply.status(400).send({ error: 'Set INTEGRATION_ENCRYPTION_KEY (at least 32 characters) on the server before connecting Notion' })
    if (!token || token.length > 300) return reply.status(400).send({ error: 'Enter a valid Notion internal integration secret' })
    try {
      const user = await notionRequest(token, '/users/me')
      const workspace = user.bot?.workspace_name || 'Notion workspace'
      db.prepare('insert into notion_connections(user_id,workspace_name,bot_name,token_cipher,updated_at) values(?,?,?,?,?) on conflict(user_id) do update set workspace_name=excluded.workspace_name,bot_name=excluded.bot_name,token_cipher=excluded.token_cipher,updated_at=excluded.updated_at')
        .run((req as any).userId, String(workspace).slice(0, 200), String(user.name || user.type || 'Integration').slice(0, 200), sealIntegrationSecret(token), now())
      return notionIntegrationStatus((req as any).userId)
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : String(error) })
    }
  })
  app.delete('/api/integrations/notion', async (req) => {
    const result = db.prepare('delete from notion_connections where user_id=?').run((req as any).userId)
    return { ok: true, disconnected: Number(result.changes) > 0, note: 'Also revoke the integration secret in Notion if it should no longer have access.' }
  })
}
