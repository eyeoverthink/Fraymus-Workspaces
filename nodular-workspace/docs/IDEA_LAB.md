# Weekend tracker and creative idea lab

## Weekend checklist

Open **Time audit** to start a checklist for a Saturday in your local calendar. On Sunday the default remains that weekend's Saturday; on weekdays it selects the upcoming weekend. Each weekend is saved separately per user. The six exercise steps cover Saturday/Sunday logging, reviewing friction, combining hypotheses, scoping an MVP and running a validation experiment. Tasks support completion, editing, evidence notes, custom additions and removal. Reinstalling the default tasks preserves existing progress; no device activity is monitored.

The REST surface is `/api/time-audit/weekend/:weekend`: GET the checklist, POST `/start`, POST `/tasks`, and PUT/DELETE `/tasks/:id`. Dates are Saturday `YYYY-MM-DD`; a weekend is limited to 50 tasks. MCP exposes read-scoped `list_weekend_checklist` and admin-scoped `start_weekend_checklist` / `save_weekend_task`.

## Mixed-source combinations

Open **Idea Finder** or `?view=idea-finder`. Enter an audience, a natural-language brief, and any combination of:

- Business URLs: optional public HTML/text fetching, bounded to 2 MB per response and 6,000 extracted characters. No browser rendering, login, private-network access by default, or access-control bypass.
- GitHub profile/repository URLs: public metadata via GitHub's unauthenticated API. Rate limits apply; this is not a full source-code audit.
- Instagram links: recorded but not scraped. Paste content you are permitted to share, or describe a screenshot.
- Dun & Bradstreet: a nine-digit D-U-N-S identifier and/or permitted report excerpts. Identifiers are context only. No credit score, paid report, entity verification or proprietary D&B API access is supplied.
- Pasted text and keywords: up to 12,000 characters, combined with the user's manually logged 48-hour time audit.
- Images: PNG/JPEG/WebP, at most 8 MiB / 25 megapixels. The browser previews the image locally. The analysis button requires explicit consent. The server decodes/re-encodes it with Sharp, stripping embedded metadata, and sends it only to the exact `IDEA_VISION_MODEL=provider:model` if configured. The model must genuinely support images; there is no silent provider fallback. Without that setting, the server reports dimensions and requests a manual description rather than inventing image understanding. Image bytes are not retained; review the description before generating ideas.

Source fetching, web search, YouTube search and model synthesis each have separate opt-in checkboxes. Search transmits the brief/audience, not full pasted notes; common emails, phone-like numbers and URLs are redacted from search queries, but this is not guaranteed anonymization. Model synthesis sends collected evidence, audit summary, mission and recent human feedback through the configured local/hosted model chain. Do not opt in for confidential or unauthorized material.

**Browser / capture** can supply a user-selected tab/window screenshot: the user
chooses the screen in the native permission picker, reviews/redacts locally, then
separately consents to vision analysis in Idea Finder. No background capture,
cross-origin DOM read, cookie access or framing/login restriction bypass exists.
Run `npm run models:configure` to select already-installed local text/tool and
vision models, followed by `npm run models:test`; restart after configuration.
`IDEA_MODEL` selects structured synthesis, while `IDEA_VISION_MODEL` selects the
exact image-capable model. See the [complete app guide](../README.md).

Generation saves either three or ten hypotheses, with a specific problem, evidence, 12-hour prototype scope, validation experiment, risks and source IDs. With model synthesis off, a deterministic local combinator uses the actual supplied evidence across different business/skills/career angles. It is labeled accordingly, not advertised as AI-authored market analysis. A configured LLM can produce structured original synthesis; malformed output, duplicate titles or invented source IDs are rejected. If no model is configured, the local fallback is explicitly labeled. Real provider failures surface as errors instead of a success-shaped report.

The source ledger includes dates, extracted evidence, blocked content and failed requests. Search snippets and self-reported notes are hypotheses, not validation. No video transcript is read.

## Goals and human monitoring

Expand **Mission, moonshot goals and creativity monitoring** to save a creative mission, stretch gross-revenue goal, horizon, weekly experiment target, budget ceiling and public trend topics. Actual gross revenue is a separate self-reported value. Large targets are welcome as aspirations, but models do not have financial motivation and these numbers are not forecasts or authorization to spend.

Score each idea's creativity and usefulness from 1-10, shortlist it, track an experiment, reject it, or mark it validated with written evidence. These are human judgments, not an automatic business-verification service. Reviews persist per user/report/idea and feed later AI synthesis together with the reviewed idea's title/problem. Saving goals/reviews never publishes, contacts people, charges a card or changes external accounts.

## Trend radar and autonomous creative drafts

**Search YouTube + web now** saves up to ten public YouTube video results plus related web signals using selected predefined topic labels: AI agents, agencies, agentic workflows, businesses, careers, employees, skills, marketing engineering, vertical AI and evaluation. Dates, channels and public view labels are recorded when available. Search-ranked results are not a top-earning ranking, a watched/fact-checked video, exhaustive trend coverage or a prediction.

YouTube is read from its public search page, without authentication or evasion. Consent/rate limits or page changes can prevent extraction; errors remain visible. Web search uses the existing DuckDuckGo/SearXNG tool. Failed snapshots are saved honestly; agent context uses the latest snapshot containing results, with its original dates.

Two optional templates install **disabled**:

- `ai-trend-radar`: daily 08:00 UTC, searches only predefined public labels and saves a radar snapshot. No private mission/notes are sent to search.
- `creative-idea-briefing`: daily 08:30 UTC, runs the Business Idea Finder agent against saved mission, reviews, audit and dated radar results, then saves original structured drafts for scoring. A real configured LLM is required; the offline mock does not autonomously create reports.

Enable them in **Automations** after reviewing their scope. The server and scheduler must stay running. The draft agent may choose an explicitly provisional audience if the mission supplies none; this is not customer validation. `idea_lab_context` and `idea_lab_save_draft` read/write only local user data. `idea_lab_research` requires approval before any optional external collection/model synthesis; MCP direct calls and unattended tool automations cannot bypass this. Existing publish/send/payment approvals remain unchanged.

Settings/reviews/scans are available at GET `/api/idea-finder/lab`, PUT `/api/idea-finder/settings`, PUT `/api/idea-finder/:id/reviews/:index`, POST `/api/idea-finder/trends`, and POST `/api/idea-finder/image`. Existing GET/POST `/api/idea-finder` lists/saves reports. MCP `get_idea_lab` is read-scoped; registered tool schemas are discoverable in MCP `list_tools`.

## YouTube research snapshot: October 28, 2026

The implementation session searched YouTube for `AI business agency agentic AI skills make money 2026`. The following were the first ten extracted public video results, not a vetted recommendation or earnings ranking. Only search metadata was inspected, not the videos or their income claims.

| Video | Channel |
|---|---|
| [AI Agents: The Most Valuable Skill You Can Learn in 2026 (Full Course)](https://www.youtube.com/watch?v=5p-sq8v3OXw) | Open Residency and AI with Remy |
| [Give Us 20 Minutes, We'll Teach You 5 AI Side Hustles for 2026](https://www.youtube.com/watch?v=1dvM89NMK3s) | Higgsfield AI and Iman Gadzhi |
| [AI Agents Full Course 2026: Master Agentic AI (2 Hours)](https://www.youtube.com/watch?v=EsTrWCV0Ph4) | Nick Saraev |
| [Most Valuable Skill of 2026: Managing AI Agents](https://www.youtube.com/watch?v=vJEy3nP2_C8) | Greg Isenberg |
| [How to Build & Sell AI Agents in 2026: Ultimate Beginner's Guide](https://www.youtube.com/watch?v=AYQtRqW1xX4) | Liam Ottley |
| [The EASIEST Way To Make Money With AI (Copy This)](https://www.youtube.com/watch?v=HKWLH1Zh79A) | The Diary Of A CEO Clips |
| [AI AGENTS MASTERCLASS 4 HOURS: Build & Sell (2026)](https://www.youtube.com/watch?v=0C6xYvQhjwQ) | Michele Torti |
| [Marketing Engineer: The $1M Job with AI Agents](https://www.youtube.com/watch?v=8ZC1G1ezN5o) | Greg Isenberg |
| [The Only 14 Ways to Make Money with AI in 2026](https://www.youtube.com/watch?v=K8Ros5RhJW4) | Dan Martell |
| [He Asked AI To Make Money. It Did.](https://www.youtube.com/watch?v=l0Vqm0ZIySc) | Chris Koerner on The Koerner Office Podcast and The Koerner Office Highlights |

Ten testable directions to investigate, synthesized as hypotheses rather than claims about video contents: vertical workflow agents, fixed-scope AI implementation agencies, portfolio-based AI career training, human-reviewed AI employee copilots, agent evaluation services, marketing engineering workflows, data reconciliation automation, practical skill kits, focused micro-SaaS portals, and agent operations/exception monitoring. The lab combines these angles with the user's actual inputs; a small paid pilot or observed customer task is stronger evidence than any title or view count.
