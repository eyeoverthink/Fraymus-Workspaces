type ListedTool = { name: string }
type Integration = { name: string; status: string; detail?: string }

type SkillDefinition = {
  id: string
  name: string
  description: string
  tools: string[]
  group?: 'free-fleet' | 'app-native' | 'optional-integration'
  execution: 'local' | 'external-service' | 'mixed'
  requirements?: string[]
  note?: string
}

const fleetSkills: SkillDefinition[] = ([
  { id: 'duckduckgo-search', name: 'DuckDuckGo search', description: 'Public DuckDuckGo results, Hacker News stories, and arXiv papers.', tools: ['duckduckgo_search'], execution: 'external-service' },
  { id: 'searxng-search', name: 'SearXNG search', description: 'Compatibility search using public DuckDuckGo; no SearXNG server is involved.', tools: ['searxng_search'], execution: 'external-service' },
  { id: 'sherlock', name: 'Sherlock username lookup', description: 'Checks a small set of public profile endpoints; inconclusive responses are not treated as absence.', tools: ['sherlock_username'], execution: 'external-service' },
  { id: 'osint-investigation', name: 'OSINT investigation', description: 'Searches public GitHub, Wayback, GDELT, Crossref, and Hacker News sources.', tools: ['osint_investigation'], execution: 'external-service' },
  { id: 'oss-forensics', name: 'OSS package forensics', description: 'Reads public npm, PyPI, or crates.io package metadata.', tools: ['oss_forensics'], execution: 'external-service' },
  { id: 'web-pentest', name: 'Web security headers', description: 'Passive response-header review only; target ownership confirmation and human approval required.', tools: ['web_pentest_headers'], execution: 'external-service', note: 'Does not exploit vulnerabilities or probe endpoints.' },
  { id: 'rest-graphql-debug', name: 'REST/GraphQL endpoint headers', description: 'Passive security-header review for one authorized endpoint; human approval required.', tools: ['rest_graphql_debug_headers'], execution: 'external-service', note: 'Does not send API operations or test for vulnerabilities.' },
  { id: 'reddit-reading', name: 'Reddit reading', description: 'Reads public subreddit hot posts; no login, posting, or voting.', tools: ['reddit_reading'], execution: 'external-service' },
  { id: 'rss-feeds', name: 'RSS feeds', description: 'Reads supplied public RSS or Atom URLs.', tools: ['rss_feeds'], execution: 'external-service' },
  { id: 'blogwatcher', name: 'Blog watcher snapshot', description: 'Fetches current Hacker News and Reddit RSS feeds once; not a persistent watcher.', tools: ['blogwatcher'], execution: 'external-service' },
  { id: 'scrapling', name: 'Readable page extraction', description: 'Basic public HTML text extraction without JavaScript rendering or access-control evasion.', tools: ['scrapling_fetch'], execution: 'external-service' },
  { id: 'parallel-cli', name: 'Parallel page fetch', description: 'Fetches up to five public pages concurrently; this is not shell command execution.', tools: ['parallel_cli_fetch'], execution: 'external-service' },
  { id: 'research-paper-writing', name: 'Research paper references', description: 'Finds arXiv papers and returns citation metadata plus a LaTeX starter template.', tools: ['research_paper_writing'], execution: 'mixed', note: 'Returns a template and references, not a finished or submitted paper.' },
  { id: 'bioinformatics', name: 'Sequence statistics', description: 'Calculates basic nucleotide counts, GC percentage, and reverse complement locally.', tools: ['bioinformatics_sequence_stats'], execution: 'local', note: 'Not a diagnostic or clinical interpretation.' },
  { id: 'unbroker', name: 'Data-broker opt-out kit', description: 'Drafts a checklist and generic letter; does not contact brokers.', tools: ['unbroker_optout_kit'], execution: 'local' }
] satisfies SkillDefinition[]).map((skill) => ({ ...skill, group: 'free-fleet' }))

const promptOnlyNames = [
  '1password', 'ast-grep', 'canvas', 'cloudflare-temporary-deploy', 'code-wiki', 'gitnexus-explorer', 'godmode',
  'grill-me', 'har-derived-api-client', 'heartmula-music', 'here-now', 'live-dashboard', 'page-agent',
  'pinecone-research', 'pr-lens', 'scrollcraft', 'shopify', 'subagent-driven-development', 'telephony'
]

const promptOnlySkills: SkillDefinition[] = promptOnlyNames.map((id) => ({
  id,
  name: id,
  description: 'AI-written guidance only. It does not install, call, deploy, publish, or otherwise execute this capability.',
  tools: [],
  group: 'free-fleet',
  execution: 'local',
  note: 'Prompt-only; no runnable implementation is registered.'
}))

const appSkills: SkillDefinition[] = [
  {
    id: 'memory',
    name: 'Persistent memory',
    description: 'Search and save user-scoped memories stored in the local SQLite database.',
    tools: ['memory_search', 'memory_save'],
    group: 'app-native',
    execution: 'local'
  },
  {
    id: 'web-research',
    name: 'Web research',
    description: 'Search the public web with DuckDuckGo or a configured SearXNG instance.',
    tools: ['web_search'],
    group: 'app-native',
    execution: 'external-service',
    requirements: ['Internet access; optional SEARXNG_URL']
  },
  {
    id: 'image-generation',
    name: 'Image generation',
    description: 'Generate images with Hugging Face inference when configured; without HF_TOKEN the tool returns a labeled placeholder.',
    tools: ['generate_image'],
    group: 'app-native',
    execution: 'mixed',
    requirements: ['HF_TOKEN for model-generated images']
  },
  {
    id: 'background-removal',
    name: 'Background removal',
    description: 'Remove image backgrounds with the installed local @imgly/background-removal-node engine.',
    tools: ['remove_background'],
    group: 'app-native',
    execution: 'local',
    requirements: ['Model assets must be available to the local runtime']
  },
  {
    id: 'image-upscaling',
    name: 'Image upscaling',
    description: 'Upscale locally with Sharp; when configured, Replicate Real-ESRGAN is tried first.',
    tools: ['upscale_image'],
    group: 'app-native',
    execution: 'mixed',
    requirements: ['Optional REPLICATE_API_TOKEN for Real-ESRGAN; the local Sharp scaler is the default']
  },
  {
    id: 'workflow-execution',
    name: 'Workflow execution',
    description: 'Run a saved workflow. The tool requires approval and consumes a workflow credit.',
    tools: ['run_workflow'],
    group: 'app-native',
    execution: 'local',
    requirements: ['A saved workflow and an available credit']
  },
  {
    id: 'video-rendering',
    name: 'Video rendering',
    description: 'Render HyperFrames HTML compositions to video using the local renderer.',
    tools: ['hyperframes_render'],
    group: 'app-native',
    execution: 'local',
    requirements: ['Node.js 22+, Chrome, and FFmpeg on PATH'],
    note: 'Rendering requires approval.'
  }
]

const optionalSkills: Array<SkillDefinition & { integration: string }> = [
  {
    id: 'voice-studio',
    name: 'VoiceStudio',
    description: 'Use VoiceStudio tools through its configured MCP server.',
    tools: [],
    group: 'optional-integration',
    execution: 'external-service',
    requirements: ['VOICESTUDIO_MCP_URL and a reachable VoiceStudio MCP server'],
    integration: 'voicestudio'
  },
  {
    id: 'photocraft',
    name: 'PhotoCraft',
    description: 'Use PhotoCraft tools through its configured local MCP server.',
    tools: [],
    group: 'optional-integration',
    execution: 'local',
    requirements: ['PHOTOCRAFT_CLI and a working photocraft-cli binary'],
    integration: 'photocraft'
  },
  {
    id: 'reverse-engineer-anything',
    name: 'Reverse Engineer Anything',
    description: 'Use the optional REA MCP server for binary and application analysis.',
    tools: [],
    group: 'optional-integration',
    execution: 'local',
    requirements: ['REA_MCP=1; the package and its runtime requirements are installed on first use'],
    integration: 'rea'
  }
]

export function listSkills(tools: ListedTool[], integrations: Integration[] = []) {
  const toolNames = new Set(tools.map((tool) => tool.name))
  const native = [...fleetSkills, ...appSkills].map((skill) => {
    const availableTools = skill.tools.filter((name) => toolNames.has(name))
    return {
      ...skill,
      availableTools,
      status: skill.group === 'free-fleet' && skill.tools.length === 0
        ? 'prompt_only'
        : availableTools.length === skill.tools.length ? 'available' : 'unavailable'
    }
  })
  const states = new Map(integrations.map((integration) => [integration.name, integration]))
  const optional = optionalSkills.map((skill) => {
    const integration = states.get(skill.integration)
    const availableTools = tools.filter((tool) => tool.name.startsWith(`${skill.integration}__`)).map((tool) => tool.name)
    return {
      ...skill,
      integration: undefined,
      availableTools,
      status: integration?.status ?? 'not_configured',
      detail: integration?.detail
    }
  })
  return [...native, ...promptOnlySkills.map((skill) => ({ ...skill, availableTools: [], status: 'prompt_only' })), ...optional]
}
