import { registerTools, safeFetch } from './tools'
import type { Tool, ToolCtx } from './tools'

const userAgent = 'NodularFreeFleet/1.0 (read-only research)'
const queryText = (value: unknown, label = 'query') => {
  const text = String(value || '').trim()
  if (!text || text.length > 500) throw new Error(`${label} must contain 1-500 characters`)
  return text
}

async function getText(url: string) {
  const response = await safeFetch(url, { headers: { 'User-Agent': userAgent } })
  if (!response.ok) throw new Error(`request failed (${response.status}): ${new URL(url).hostname}`)
  return response.text()
}

async function getJson(url: string) {
  const response = await safeFetch(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' } })
  if (!response.ok) throw new Error(`request failed (${response.status}): ${new URL(url).hostname}`)
  return response.json() as Promise<any>
}

const stripMarkup = (text: string) => text
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  .replace(/\s+/g, ' ').trim()

async function duckDuckGo(query: string) {
  const html = await getText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`)
  const results: Array<{ title: string; url: string; snippet?: string }> = []
  const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(html)) && results.length < 6) {
    let url = match[1].startsWith('//') ? `https:${match[1]}` : match[1]
    try { url = new URL(url).searchParams.get('uddg') || url } catch {}
    results.push({ title: stripMarkup(match[2]), url, snippet: stripMarkup(match[3]) })
  }
  return results
}

async function hackerNews(query: string) {
  const result = await getJson(`https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=5&query=${encodeURIComponent(query)}`)
  return (result.hits || []).map((hit: any) => ({
    title: hit.title || hit.story_title,
    url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
    points: hit.points,
    createdAt: hit.created_at
  }))
}

async function arxiv(query: string) {
  const xml = await getText(`https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=5`)
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, entry]) => {
    const tag = (name: string) => new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`).exec(entry)?.[1]?.trim() || ''
    return {
      title: stripMarkup(tag('title')),
      summary: stripMarkup(tag('summary')),
      url: tag('id'),
      published: tag('published')
    }
  })
  return entries
}

const searchTool = (name: string, description: string, search: (query: string) => Promise<unknown>): Tool => ({
  name, risk: 'safe', description,
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  async run(args) { return { query: queryText(args.query), results: await search(queryText(args.query)) } }
})

const tools: Tool[] = [
  searchTool('duckduckgo_search', 'Search public DuckDuckGo results, Hacker News stories, and arXiv papers. Returns real links and source labels.', async (query) => {
    const sources = await Promise.all([
      duckDuckGo(query).then((results) => ({ source: 'DuckDuckGo', results })),
      hackerNews(query).then((results) => ({ source: 'Hacker News', results })),
      arxiv(query).then((results) => ({ source: 'arXiv', results }))
    ])
    return sources
  }),
  searchTool('searxng_search', 'Compatibility entry for the fleet SearXNG skill. Uses public DuckDuckGo search; it does not connect to or require a SearXNG server.', duckDuckGo),
  {
    name: 'sherlock_username', risk: 'safe',
    description: 'Check a small set of public profile endpoints for a username. HTTP errors and rate limits are reported as inconclusive, not as proof that an account is absent.',
    parameters: { type: 'object', properties: { username: { type: 'string', pattern: '^[A-Za-z0-9_.-]{1,39}$' } }, required: ['username'] },
    async run(args) {
      const username = queryText(args.username, 'username')
      if (!/^[A-Za-z0-9_.-]{1,39}$/.test(username)) throw new Error('username contains unsupported characters')
      const checks = [
        { site: 'GitHub', url: `https://api.github.com/users/${encodeURIComponent(username)}`, exists: (v: any) => !!v.login },
        { site: 'GitLab', url: `https://gitlab.com/api/v4/users?username=${encodeURIComponent(username)}`, exists: (v: any) => Array.isArray(v) && v.length > 0 },
        { site: 'Codeberg', url: `https://codeberg.org/api/v1/users/${encodeURIComponent(username)}`, exists: (v: any) => !!v.login }
      ]
      const results = await Promise.all(checks.map(async ({ site, url, exists }) => {
        try {
          const response = await safeFetch(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' } })
          if (response.status === 404) return { site, status: 'not_found' }
          if (!response.ok) return { site, status: 'inconclusive', detail: `HTTP ${response.status}` }
          return { site, status: exists(await response.json()) ? 'found' : 'not_found' }
        } catch (error) {
          return { site, status: 'inconclusive', detail: error instanceof Error ? error.message : String(error) }
        }
      }))
      return { username, checked: results.length, results, caveat: 'Only these public endpoints were checked; results are not exhaustive identity verification.' }
    }
  },
  {
    name: 'osint_investigation', risk: 'safe',
    description: 'Search public GitHub, Wayback Machine, GDELT news, Crossref, and Hacker News data for a query.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    async run(args) {
      const query = queryText(args.query)
      const sources: Array<{ source: string; results?: unknown; error?: string }> = await Promise.all([
        getJson(`https://api.github.com/search/users?q=${encodeURIComponent(query)}&per_page=5`).then((v) => ({ source: 'GitHub users', results: v.items?.map((x: any) => ({ login: x.login, url: x.html_url, type: x.type })) })).catch((e) => ({ source: 'GitHub users', error: String(e) })),
        getJson(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(query)}&output=json&filter=statuscode:200&collapse=urlkey&limit=5`).then((v) => ({ source: 'Wayback Machine', results: v })).catch((e) => ({ source: 'Wayback Machine', error: String(e) })),
        getJson(`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=ArtList&format=json&maxrecords=5`).then((v) => ({ source: 'GDELT', results: v.articles })).catch((e) => ({ source: 'GDELT', error: String(e) })),
        getJson(`https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=5`).then((v) => ({ source: 'Crossref', results: v.message?.items?.map((x: any) => ({ title: x.title?.[0], doi: x.DOI, url: x.URL, published: x.created?.['date-time'] })) })).catch((e) => ({ source: 'Crossref', error: String(e) })),
        hackerNews(query).then((results) => ({ source: 'Hacker News', results })).catch((e) => ({ source: 'Hacker News', error: String(e) }))
      ])
      return { query, sources }
    }
  },
  {
    name: 'oss_forensics', risk: 'safe',
    description: 'Inspect public npm, PyPI, or crates.io package metadata, versions, maintainers, and tags.',
    parameters: { type: 'object', properties: { ecosystem: { type: 'string', enum: ['npm', 'pypi', 'crates'] }, package: { type: 'string' } }, required: ['ecosystem', 'package'] },
    async run(args) {
      const ecosystem = String(args.ecosystem)
      const pkg = queryText(args.package, 'package')
      const endpoints: Record<string, string> = {
        npm: `https://registry.npmjs.org/${encodeURIComponent(pkg)}`,
        pypi: `https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`,
        crates: `https://crates.io/api/v1/crates/${encodeURIComponent(pkg)}`
      }
      if (!endpoints[ecosystem]) throw new Error('ecosystem must be npm, pypi, or crates')
      const raw = await getJson(endpoints[ecosystem])
      if (ecosystem === 'npm') {
        const latest = raw['dist-tags']?.latest
        const v = raw.versions?.[latest] || {}
        return { ecosystem, package: raw.name, version: latest, description: raw.description, license: v.license, maintainers: raw.maintainers?.map((m: any) => m.name), repository: raw.repository, tags: raw.keywords || [], publishedAt: raw.time?.[latest] }
      }
      if (ecosystem === 'pypi') return { ecosystem, package: raw.info?.name, version: raw.info?.version, summary: raw.info?.summary, license: raw.info?.license, maintainers: [raw.info?.maintainer].filter(Boolean), repository: raw.info?.project_urls, tags: raw.info?.classifiers, publishedAt: raw.urls?.[0]?.upload_time_iso_8601 }
      const c = raw.crate
      return { ecosystem, package: c.name, version: c.newest_version, description: c.description, license: c.license, maintainers: raw.owners?.map((o: any) => o.login), repository: c.repository, downloads: c.downloads, updatedAt: c.updated_at }
    }
  }
]

const securityAudit = async (args: any) => {
  if (args.confirmOwned !== true) throw new Error('Confirm that you own or are authorized to assess this site before requesting its public security headers.')
  const url = queryText(args.url, 'url')
  const response = await safeFetch(url, { method: 'GET', headers: { 'User-Agent': userAgent } })
  const headers = Object.fromEntries([
    'strict-transport-security', 'content-security-policy', 'x-content-type-options',
    'x-frame-options', 'referrer-policy', 'permissions-policy'
  ].map((name) => [name, response.headers.get(name)]))
  const missing = Object.entries(headers).filter(([, value]) => !value).map(([name]) => name)
  return { url: response.url, status: response.status, headers, missing, method: 'GET; passive response-header review only', note: 'This did not test for vulnerabilities or probe API operations.' }
}

for (const name of ['web_pentest_headers', 'rest_graphql_debug_headers']) {
  tools.push({
    name,
    risk: 'approval',
    description: 'Passively fetch one user-owned or authorized URL and report common browser security headers. No vulnerability exploitation or API probing.',
    parameters: { type: 'object', properties: { url: { type: 'string' }, confirmOwned: { type: 'boolean', description: 'Confirm you own or are authorized to assess this site.' } }, required: ['url', 'confirmOwned'] },
    async run(args) { return securityAudit(args) }
  })
}

const rssItems = (xml: string, limit = 10) => [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].slice(0, limit).map(([, , body]) => {
  const field = (tag: string) => {
    const value = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(body)?.[1] || ''
    return stripMarkup(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))
  }
  const link = /<link\b[^>]*href="([^"]+)"[^>]*\/?>/i.exec(body)?.[1] || field('link')
  return { title: field('title'), url: link, published: field('pubDate') || field('published'), summary: field('description') || field('summary') }
})

tools.push(
  {
    name: 'reddit_reading', risk: 'safe',
    description: 'Read public hot posts from a named subreddit via its public JSON feed. No login, voting, or posting.',
    parameters: { type: 'object', properties: { subreddit: { type: 'string', pattern: '^[A-Za-z0-9_]{1,21}$' }, limit: { type: 'integer', minimum: 1, maximum: 25 } }, required: ['subreddit'] },
    async run(args) {
      const subreddit = queryText(args.subreddit, 'subreddit')
      if (!/^[A-Za-z0-9_]{1,21}$/.test(subreddit)) throw new Error('invalid subreddit name')
      const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 25)
      const data = await getJson(`https://www.reddit.com/r/${encodeURIComponent(subreddit)}/hot.json?limit=${limit}`)
      return { subreddit, posts: (data.data?.children || []).map((x: any) => ({ title: x.data.title, url: x.data.url, permalink: `https://www.reddit.com${x.data.permalink}`, score: x.data.score, comments: x.data.num_comments, createdAt: x.data.created_utc })) }
    }
  },
  {
    name: 'rss_feeds', risk: 'safe',
    description: 'Read public RSS or Atom URLs (read-only; local/private addresses are blocked).',
    parameters: { type: 'object', properties: { urls: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 } }, required: ['urls'] },
    async run(args) {
      if (!Array.isArray(args.urls) || args.urls.length < 1 || args.urls.length > 5) throw new Error('provide 1-5 feed URLs')
      const feeds = await Promise.all(args.urls.map(async (value: unknown) => {
        const url = queryText(value, 'feed URL')
        const xml = await getText(url)
        return { url, items: rssItems(xml) }
      }))
      return { feeds }
    }
  },
  {
    name: 'blogwatcher', risk: 'safe',
    description: 'Fetch recent public entries from Hacker News and Reddit RSS feeds. This is a one-time read, not a persistent watcher.',
    parameters: { type: 'object', properties: { subreddit: { type: 'string' } } },
    async run(args) {
      const subreddit = String(args.subreddit || 'technology')
      if (!/^[A-Za-z0-9_]{1,21}$/.test(subreddit)) throw new Error('invalid subreddit name')
      const [hnXml, redditXml] = await Promise.all([
        getText('https://hnrss.org/frontpage'),
        getText(`https://www.reddit.com/r/${encodeURIComponent(subreddit)}/.rss`)
      ])
      return { recurringWatch: false, feeds: [{ source: 'Hacker News', items: rssItems(hnXml) }, { source: `r/${subreddit}`, items: rssItems(redditXml) }] }
    }
  },
  {
    name: 'scrapling_fetch', risk: 'safe',
    description: 'Fetch a public web page and extract readable text. This basic reader does not run JavaScript or evade access controls.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    async run(args) {
      const url = queryText(args.url, 'url')
      const html = await getText(url)
      return { url, text: stripMarkup(html).slice(0, 12000), engine: 'basic HTML text extraction; no browser rendering' }
    }
  },
  {
    name: 'parallel_cli_fetch', risk: 'safe',
    description: 'Fetch up to five public web pages concurrently and return readable text. This does not execute commands or run a shell CLI.',
    parameters: { type: 'object', properties: { urls: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 } }, required: ['urls'] },
    async run(args) {
      if (!Array.isArray(args.urls) || args.urls.length < 1 || args.urls.length > 5) throw new Error('provide 1-5 URLs')
      const results = await Promise.all(args.urls.map(async (value: unknown) => {
        const url = queryText(value, 'url')
        try { return { url, text: stripMarkup(await getText(url)).slice(0, 5000) } }
        catch (error) { return { url, error: error instanceof Error ? error.message : String(error) } }
      }))
      return { results }
    }
  },
  {
    name: 'research_paper_writing', risk: 'safe',
    description: 'Find arXiv papers for a research query and return their citation metadata plus a NeurIPS-style LaTeX starting template. Does not write or submit a paper.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    async run(args) {
      const query = queryText(args.query)
      const papers = await arxiv(query)
      const citations = papers.map((p: any) => `\\bibitem{${String(p.url).split('/').pop()}} ${p.title}. arXiv. ${p.url}`).join('\n')
      return { query, papers, latexTemplate: '\\documentclass{article}\n\\usepackage{neurips_2024}\n\\title{Research Title}\n\\author{Author Name}\n\\begin{document}\\maketitle\n\\begin{abstract}...\\end{abstract}\n\\section{Introduction}\n...\n\\bibliographystyle{plain}\n\\begin{thebibliography}{9}\n' + citations + '\n\\end{thebibliography}\n\\end{document}', note: 'Verify every citation and use the venue’s current template before submission.' }
    }
  },
  {
    name: 'bioinformatics_sequence_stats', risk: 'safe',
    description: 'Calculate basic nucleotide counts, GC percentage, and reverse complement from pasted DNA/RNA sequence text. This is not medical interpretation.',
    parameters: { type: 'object', properties: { sequence: { type: 'string', minLength: 1, maxLength: 50000 } }, required: ['sequence'] },
    async run(args) {
      const sequence = String(args.sequence || '').replace(/\s|[0-9]/g, '').toUpperCase()
      if (!sequence || sequence.length > 50000 || !/^[ACGTUN]+$/.test(sequence)) throw new Error('sequence must contain 1-50000 characters from A, C, G, T, U, N (whitespace and line numbers are ignored)')
      const counts = Object.fromEntries(['A', 'C', 'G', 'T', 'U', 'N'].map((base) => [base, [...sequence].filter((x) => x === base).length]))
      const known = sequence.length - Number(counts.N)
      return { length: sequence.length, counts, gcPercent: known ? Math.round((Number(counts.G) + Number(counts.C)) / known * 10000) / 100 : null, reverseComplement: [...sequence].reverse().map((base) => ({ A: 'T', T: 'A', U: 'A', C: 'G', G: 'C', N: 'N' }[base])).join(''), note: 'Basic sequence arithmetic only; not a diagnostic or clinical interpretation.' }
    }
  },
  {
    name: 'unbroker_optout_kit', risk: 'safe',
    description: 'Draft a data-broker opt-out checklist and generic letter templates. This does not contact brokers or submit requests.',
    parameters: { type: 'object', properties: { brokers: { type: 'array', items: { type: 'string' }, maxItems: 20 } } },
    async run(args) {
      const brokers = Array.isArray(args.brokers) ? args.brokers.map((x: unknown) => String(x).trim()).filter(Boolean).slice(0, 20) : []
      return {
        contacted: false,
        checklist: ['Identify the broker’s official privacy or opt-out page.', 'Review what identity information the broker requires and its retention policy.', 'Submit only through the broker’s verified channel.', 'Save the confirmation and note the date to check for re-listing.'],
        letterTemplate: 'Subject: Request to delete and suppress my personal information\\n\\nHello,\\n\\nPlease provide the process for verifying my identity and removing my personal information from your service and affiliated listings. I also request that you suppress future sale or publication of this information where applicable.\\n\\nName: [your name]\\nProfile URL or reference: [URL]\\n\\nPlease confirm completion and any applicable retention limits.\\n\\nThank you,\\n[your name]',
        brokers,
        note: 'Template only. No broker was contacted; verify current law, broker identity, and official opt-out instructions.'
      }
    }
  }
)

export function registerFleetSkills() {
  registerTools(tools)
}

export const fleetSkillNames = tools.map((tool) => tool.name)
