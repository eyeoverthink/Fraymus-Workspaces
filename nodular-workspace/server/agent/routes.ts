import type { FastifyInstance } from 'fastify'
import { providerStatus } from './llm'
import { allTools } from './tools'
import { mcpStatus } from './mcp'
import {
  listAgents, saveCustomAgent, startRun, decideApproval, listThreads, getThread, deleteThread, listMemories, deleteMemory
} from './runtime'

const fail = (reply: any, e: any, code = 400) => reply.status(code).send({ error: e.message || String(e) })

export function registerAgentRoutes(app: FastifyInstance) {
  app.get('/api/agent/status', async () => ({
    ...(await providerStatus()),
    mcp: mcpStatus(),
    tools: allTools().map((t) => ({ name: t.name, risk: t.risk, description: t.description }))
  }))

  app.get('/api/agents', async (req) =>
    listAgents((req as any).userId).map(({ systemPrompt, ...a }) => a))

  app.post('/api/agents', async (req, reply) => {
    try { return saveCustomAgent((req as any).userId, req.body) } catch (e) { return fail(reply, e) }
  })

  app.post('/api/agent/runs', async (req, reply) => {
    const { agentId, message, threadId } = (req.body as any) || {}
    try { return startRun((req as any).userId, String(agentId || 'concierge'), message, threadId) } catch (e) { return fail(reply, e) }
  })

  app.get('/api/agent/threads', async (req) => listThreads((req as any).userId))

  app.get('/api/agent/threads/:id', async (req, reply) => {
    const t = getThread((req as any).userId, (req.params as any).id)
    return t || reply.status(404).send({ error: 'Not found' })
  })

  app.delete('/api/agent/threads/:id', async (req, reply) =>
    deleteThread((req as any).userId, (req.params as any).id) ? { ok: true } : reply.status(404).send({ error: 'Not found' }))

  app.post('/api/agent/approvals/:id', async (req, reply) => {
    try { return await decideApproval((req as any).userId, (req.params as any).id, !!((req.body as any) || {}).approve) } catch (e) { return fail(reply, e) }
  })

  app.get('/api/agent/memories', async (req) => listMemories((req as any).userId))
  app.delete('/api/agent/memories/:id', async (req, reply) =>
    deleteMemory((req as any).userId, Number((req.params as any).id)) ? { ok: true } : reply.status(404).send({ error: 'Not found' }))
}
