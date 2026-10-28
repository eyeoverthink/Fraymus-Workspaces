import type { FastifyInstance } from 'fastify'
import { providerStatus } from './llm'
import { allTools } from './tools'
import { listAutomations, saveAutomation, deleteAutomation, runAutomation, automationRuns, installTemplate, TEMPLATES } from './automations'
import { mcpStatus, mcpServers, importServers, removeServer } from './mcp'
import {
  listAgents, getAgent, saveAgentManifest, resetAgentManifest, saveCustomAgent, startRun, decideApproval, listThreads, getThread, deleteThread, listMemories, deleteMemory
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


  app.get('/api/agents/:id', async (req, reply) => getAgent((req as any).userId, (req.params as any).id) || reply.status(404).send({ error: 'Not found' }))
  app.put('/api/agents/:id', async (req, reply) => {
    try { return saveAgentManifest({ ...(req.body as any), id: (req.params as any).id }) } catch (e) { return fail(reply, e) }
  })
  app.delete('/api/agents/:id/override', async (req) => ({ ok: resetAgentManifest((req.params as any).id) }))

  app.get('/api/mcp', async () => mcpServers())
  app.post('/api/mcp/import', async (req, reply) => {
    try { return await importServers(req.body) } catch (e) { return fail(reply, e) }
  })
  app.delete('/api/mcp/:name', async (req, reply) => {
    try { return { ok: await removeServer((req.params as any).name) } } catch (e) { return fail(reply, e) }
  })
  app.get('/api/automations', async (req) => ({ automations: listAutomations((req as any).userId), templates: TEMPLATES.map(({ key, name, cron }) => ({ key, name, cron })) }))
  app.post('/api/automations', async (req, reply) => {
    try { return saveAutomation((req as any).userId, req.body as any) } catch (e) { return fail(reply, e) }
  })
  app.post('/api/automations/template/:key', async (req, reply) => {
    try { return installTemplate((req as any).userId, (req.params as any).key) } catch (e) { return fail(reply, e) }
  })
  app.post('/api/automations/:id/run', async (req, reply) => {
    try { return await runAutomation((req as any).userId, (req.params as any).id, 'manual') } catch (e) { return fail(reply, e) }
  })
  app.post('/api/automations/:id/trigger', async (req, reply) => {
    try { return await runAutomation((req as any).userId, (req.params as any).id, 'webhook') } catch (e) { return fail(reply, e) }
  })
  app.get('/api/automations/:id/runs', async (req) => automationRuns((req as any).userId, (req.params as any).id))
  app.delete('/api/automations/:id', async (req) => ({ ok: deleteAutomation((req as any).userId, (req.params as any).id) }))
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
