import type { FastifyInstance } from 'fastify'
import { providerStatus } from './llm'
import { allTools } from './tools'
import { listSkills } from './skills'
import { listAutomations, saveAutomation, deleteAutomation, runAutomation, automationRuns, installTemplate, TEMPLATES } from './automations'
import { mcpStatus, mcpServers, importServers, removeServer } from './mcp'
import { listActionLog } from './audit'
import { listTimeAuditEntries, saveTimeAuditEntry, listWeekendTasks, startWeekend, saveWeekendTask, deleteWeekendTask } from './time-audit'
import {
  listAgents, getAgent, saveAgentManifest, resetAgentManifest, saveCustomAgent, startRun, decideApproval, listThreads, getThread, deleteThread, listMemories, deleteMemory
} from './runtime'
import { googleIntegrationStatus } from './google'
import { notionIntegrationStatus } from './notion'
import { listIdeaReports } from './idea-finder'
import { describeIdeaImage, generateLabReport, getLabSettings, saveLabSettings, listIdeaReviews, saveIdeaReview, listTrendScans, scanTrends, TREND_TOPICS } from './idea-lab'
import { salesIntegrationStatus } from './sales'
import { canvaIntegrationStatus } from './canva'
import { linkedinIntegrationStatus } from './linkedin'
import { whisperIntegrationStatus } from './transcription'

const fail = (reply: any, e: any, code = 400) => reply.status(code).send({ error: e.message || String(e) })

export function registerAgentRoutes(app: FastifyInstance) {
  app.get('/api/agent/status', async () => ({
    ...(await providerStatus()),
    mcp: mcpStatus(),
    tools: allTools().map((t) => ({ name: t.name, risk: t.risk, description: t.description })),
    skills: listSkills(allTools(), mcpStatus())
  }))

  app.get('/api/integrations', async (req) => ({
    integrations: [
      googleIntegrationStatus((req as any).userId, req),
      notionIntegrationStatus((req as any).userId),
      ...salesIntegrationStatus((req as any).userId),
      canvaIntegrationStatus((req as any).userId, req),
      linkedinIntegrationStatus((req as any).userId, req),
      whisperIntegrationStatus()
    ]
  }))

  app.get('/api/skills', async () => listSkills(allTools(), mcpStatus()))

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
  app.get('/api/automations', async (req) => ({ automations: listAutomations((req as any).userId), templates: TEMPLATES.map(({ key, name, cron, kind }) => ({ key, name, cron, kind: kind || 'agent' })) }))
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
  app.get('/api/agent/action-log', async (req, reply) => {
    const query = req.query as any
    const agentId = query.agentId ? String(query.agentId) : undefined
    const limit = query.limit === undefined ? 100 : Number(query.limit)
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) return reply.status(400).send({ error: 'limit must be an integer from 1 to 200' })
    return listActionLog((req as any).userId, agentId, limit)
  })
  app.get('/api/time-audit', async (req, reply) => {
    try {
      const query = req.query as any
      return listTimeAuditEntries((req as any).userId, query.from ? String(query.from) : undefined, query.to ? String(query.to) : undefined)
    } catch (e) { return fail(reply, e) }
  })
  app.get('/api/time-audit/weekend/:weekend', async (req, reply) => {
    try { return listWeekendTasks((req as any).userId, (req.params as any).weekend) } catch (e) { return fail(reply, e) }
  })
  app.post('/api/time-audit/weekend/:weekend/start', async (req, reply) => {
    try { return startWeekend((req as any).userId, (req.params as any).weekend) } catch (e) { return fail(reply, e) }
  })
  app.post('/api/time-audit/weekend/:weekend/tasks', async (req, reply) => {
    try { return saveWeekendTask((req as any).userId, (req.params as any).weekend, req.body as any) } catch (e) { return fail(reply, e) }
  })
  app.put('/api/time-audit/weekend/:weekend/tasks/:id', async (req, reply) => {
    try { return saveWeekendTask((req as any).userId, (req.params as any).weekend, req.body as any, (req.params as any).id) } catch (e) { return fail(reply, e) }
  })
  app.delete('/api/time-audit/weekend/:weekend/tasks/:id', async (req, reply) => {
    try { return deleteWeekendTask((req as any).userId, (req.params as any).weekend, (req.params as any).id) } catch (e) { return fail(reply, e) }
  })
  app.post('/api/time-audit', async (req, reply) => {
    try { return saveTimeAuditEntry((req as any).userId, req.body as any) } catch (e) { return fail(reply, e) }
  })
  app.put('/api/time-audit/:id', async (req, reply) => {
    try { return saveTimeAuditEntry((req as any).userId, req.body as any, Number((req.params as any).id)) } catch (e) { return fail(reply, e) }
  })
  app.get('/api/idea-finder', async (req) => ({ reports: listIdeaReports((req as any).userId) }))
  app.get('/api/idea-finder/lab', async (req) => {
    const userId = (req as any).userId
    return { settings: getLabSettings(userId), reviews: listIdeaReviews(userId), scans: listTrendScans(userId), topics: TREND_TOPICS }
  })
  app.put('/api/idea-finder/settings', async (req, reply) => {
    try { return saveLabSettings((req as any).userId, req.body) } catch (e) { return fail(reply, e) }
  })
  app.put('/api/idea-finder/:id/reviews/:index', async (req, reply) => {
    try { return saveIdeaReview((req as any).userId, (req.params as any).id, Number((req.params as any).index), req.body) } catch (e) { return fail(reply, e) }
  })
  app.post('/api/idea-finder/trends', async (req, reply) => {
    try { return await scanTrends((req as any).userId) } catch (e) { return fail(reply, e) }
  })
  app.post('/api/idea-finder/image', async (req, reply) => {
    try {
      if (!req.isMultipart()) throw new Error('Upload an image using multipart/form-data')
      const file = await req.file({ limits: { fileSize: 8 * 1024 * 1024 } })
      if (!file) throw new Error('Select a PNG, JPEG or WebP image')
      // Upload itself is local. A separate affirmative field is required before any model sees image bytes.
      if (String((file.fields.analyze as { value?: string } | undefined)?.value) !== 'true') {
        throw new Error('Explicit image-analysis consent is required; you can describe the image manually instead')
      }
      return await describeIdeaImage(await file.toBuffer())
    } catch (e) { return fail(reply, e) }
  })
  app.post('/api/idea-finder', async (req, reply) => {
    try {
      return await generateLabReport((req as any).userId, req.body)
    } catch (e) { return fail(reply, e) }
  })
}
