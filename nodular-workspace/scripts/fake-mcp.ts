import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const s = new McpServer({ name: 'fake', version: '1.0.0' })
s.tool('echo', 'Echo text back', { text: z.string() }, async ({ text }) => ({ content: [{ type: 'text', text: `echo:${text}` }] }))
s.tool('boom', 'Always fails', {}, async () => ({ isError: true, content: [{ type: 'text', text: 'kaboom' }] }))
await s.connect(new StdioServerTransport())
