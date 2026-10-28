import type { FastifyInstance } from 'fastify'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { can, verifyBearer, type Principal, type Scope } from './auth'
import { allTools } from './tools'
import { listAutomations, saveAutomation, deleteAutomation, runAutomation, automationRuns } from './automations'
import { importServers, mcpServers, removeServer } from './mcp'
import { callToolDirect, decideApproval, getAgent, getThread, listAgents, listThreads, resetAgentManifest, runAgentAndWait, saveAgentManifest } from './runtime'

const out = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] })
const issuer = (req: any) => process.env.PUBLIC_URL || `${req.protocol}://${req.headers.host}`

function buildServer(p: Principal) {
  const s = new McpServer({ name: 'nodular-workspace', version: '1.0.0' })
  // Every tool declares the scope it needs; failures come back as MCP tool errors, not HTTP errors.
  const def = <S extends z.ZodRawShape>(name: string, scope: Scope, description: string, shape: S, fn: (a: any) => any) =>
    (s as any).tool(name, `${description} [scope: ${scope}]`, shape, async (a: any) => {
      if (!can(p, scope)) return { isError: true, ...out(`token lacks the "${scope}" scope`) }
      try { return out(await fn(a)) } catch (e: any) { return { isError: true, ...out(e?.message || String(e)) } }
    })
  const uid = p.userId

  def('list_agents', 'read', 'List all agents (id, role, tools, whether a runtime override exists).', {},
    () => listAgents(uid).map(({ systemPrompt, ...a }) => a))
  def('get_agent', 'read', 'Get one agent including its full system prompt.', { id: z.string() },
    ({ id }) => getAgent(uid, id) ?? (() => { throw new Error('unknown agent') })())
  def('upsert_agent', 'admin', 'Create or change an agent manifest. Stored as an override in DATA_DIR/agents/<id>.md and applied immediately. tools is "*" or a list (wildcards like "voicestudio__*" allowed).',
    { id: z.string(), name: z.string(), systemPrompt: z.string(), role: z.string().optional(), description: z.string().optional(), greeting: z.string().optional(), model: z.string().optional(), tools: z.union([z.literal('*'), z.array(z.string())]).optional() },
    (a) => saveAgentManifest(a))
  def('reset_agent', 'admin', 'Delete the runtime override of an agent, restoring the shipped default (or removing a purely custom one).', { id: z.string() },
    ({ id }) => ({ removed: resetAgentManifest(id) }))
  def('list_tools', 'read', 'List every tool agents can use, with risk level and JSON schema.', {},
    () => allTools().map((t) => ({ name: t.name, risk: t.risk, description: t.description, parameters: t.parameters })))
  def('run_agent', 'run', 'Send a message to an agent and wait for its reply. Runs appear in the app UI as threads. If status is awaiting_approval, approve in the app or call decide_approval (admin).',
    { agentId: z.string(), message: z.string(), threadId: z.string().optional(), waitSeconds: z.number().min(1).max(600).optional() },
    (a) => runAgentAndWait(uid, a.agentId, a.message, a.threadId, (a.waitSeconds ?? 120) * 1000))
  def('list_threads', 'read', 'List recent conversations.', {}, () => listThreads(uid))
  def('get_thread', 'read', 'Get a conversation: messages, run status, pending approvals.', { id: z.string(), lastMessages: z.number().min(1).max(200).optional() },
    ({ id, lastMessages }) => {
      const t = getThread(uid, id)
      if (!t) throw new Error('thread not found')
      return { ...t, messages: t.messages.slice(-(lastMessages ?? 30)) }
    })
  def('decide_approval', 'admin', 'Approve or reject a pending tool call that an agent requested.', { approvalId: z.string(), approve: z.boolean() },
    ({ approvalId, approve }) => decideApproval(uid, approvalId, approve))
  def('call_tool', 'admin', 'Execute any registered tool directly (built-ins, HTTP tools, imported MCP tools) without an agent.', { name: z.string(), arguments: z.record(z.string(), z.any()).optional() },
    async ({ name, arguments: args }) => callToolDirect(uid, name, args))
  def('list_mcp_servers', 'read', 'List MCP servers this workspace is connected to and their status.', {}, () => mcpServers())
  def('import_mcp_server', 'admin', 'Connect another MCP server (http url, or command if ALLOW_STDIO_IMPORT=1). Accepts {name,url|command,args,env,headers,safeTools} or a {mcpServers:{...}} document. Its tools become <name>__<tool>.',
    { name: z.string().optional(), url: z.string().optional(), command: z.string().optional(), args: z.array(z.string()).optional(), env: z.record(z.string(), z.string()).optional(), headers: z.record(z.string(), z.string()).optional(), safeTools: z.array(z.string()).optional(), mcpServers: z.record(z.string(), z.any()).optional() },
    (a) => importServers(a))
  def('remove_mcp_server', 'admin', 'Disconnect and forget an imported MCP server.', { name: z.string() },
    async ({ name }) => ({ removed: await removeServer(name) }))
  def('list_automations', 'read', 'List scheduled automations (cron, UTC) with next run and last result.', {}, () => listAutomations(uid))
  def('upsert_automation', 'admin', 'Create/update a scheduled automation. cron is 5-field UTC (e.g. "0 8 * * *"). kind "agent" needs agentId+prompt; kind "tool" needs tool+args. Unattended agent runs never auto-approve risky tools.',
    { id: z.string().optional(), name: z.string(), cron: z.string(), kind: z.enum(['agent', 'tool']).optional(), agentId: z.string().optional(), prompt: z.string().optional(), tool: z.string().optional(), args: z.record(z.string(), z.any()).optional(), enabled: z.boolean().optional() },
    (a) => saveAutomation(uid, a))
  def('run_automation', 'admin', 'Run an automation now and return its result.', { id: z.string() }, ({ id }) => runAutomation(uid, id, 'manual'))
  def('automation_runs', 'read', 'Recent run history of an automation.', { id: z.string() }, ({ id }) => automationRuns(uid, id))
  def('delete_automation', 'admin', 'Delete an automation and its history.', { id: z.string() }, ({ id }) => ({ removed: deleteAutomation(uid, id) }))
  return s
}

export function registerMcpServer(app: FastifyInstance) {
  app.all('/mcp', async (req, reply) => {
    const p = verifyBearer(req.headers.authorization)
    if (!p) {
      return reply.status(401).header('WWW-Authenticate', `Bearer resource_metadata="${issuer(req)}/.well-known/oauth-protected-resource"`).send({ error: 'unauthorized' })
    }
    if (req.method !== 'POST') return reply.status(405).header('Allow', 'POST').send({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed (stateless server: use POST)' }, id: null })
    const server = buildServer(p)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    reply.hijack()
    reply.raw.on('close', () => { void transport.close(); void server.close() })
    try {
      await server.connect(transport)
      await transport.handleRequest(req.raw, reply.raw, req.body)
    } catch (e: any) {
      if (!reply.raw.headersSent) reply.raw.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: e?.message || 'internal error' }, id: null }))
    }
  })
}
