# Morgan playbook: implemented scope

This project translates the supplied playbook into editable Nodular agent manifests and simple first-party workflows. It does not replicate the named third-party services. The archive's README says it contains 40 individual agent documents, but its contents are a small set of playbook documents; the playbook itself supplies the 40-role department list. Those roles are represented in `agents/morgan_40_roster.json`.

## Roster

- **House (5):** House Manager, Calendar Coordinator, Inbox Triage, Kids & Family Coordinator, Health Routine Planner.
- **Content (10):** Hook Generator, Transcript to Post, Visual Draft Builder, Content Repurposer, SEO Researcher, Newsletter Editor, Short-Form Social Writer, LinkedIn Draft Writer, Short Video Scriptwriter, Content Metrics Analyst.
- **Revenue (10):** Lead Researcher, Outreach Draft Writer, Booking Coordinator, Proposal Writer, Invoice Preparation Assistant, Follow-up Planner, Testimonial Organizer, Affiliate Planner, Partnership Researcher, Customer Value Planner.
- **Operations (10):** SOP Writer, Hiring Workflow Assistant, Finance Organizer, Legal Document Issue Spotter, Customer Support Drafter, Data Dashboard Analyst, Project Manager, Research Analyst, Travel Planner, Shopping Researcher.
- **Growth (5):** Business Idea Finder, Competitor Researcher, Trend Researcher, Product Spec Builder, Launch Planner.

The playbook separately calls out three starter agents. House Manager is already one of the 40; the roster also includes dedicated **Content Engine** and **Revenue Agent** personas, making 42 new manifests in total. The repository's earlier 16 agents remain available.

## Real capabilities and limits

The agents are prompt-backed, on-demand runs through the existing Nodular runtime. They are not independent persistent workers. Their access is limited to the exact registered tools listed per persona. Depending on the persona, those tools can search public sources, inspect user memories and the action log, read the user's manually entered time audit, or generate a single image. Tool results are evidence; agent prose alone is not proof of an action.

Google Gmail and Calendar now have a real per-user OAuth connector: search returns bounded message snippets, draft creation and single-email sending require approval, and calendar reads/events are exposed as separate operations (calendar writes require approval). App setup needs a Google OAuth client plus `INTEGRATION_ENCRYPTION_KEY`; tokens are encrypted at rest. The connector does not send bulk outreach, fetch attachments, edit/delete calendar events, or receive event-change push notifications. Notion, Apollo, Stripe invoicing, Whisper, Canva bulk, Repurpose.io, general social publishing, and Lovable/Replit are still unavailable; model instructions are not integrations. Public lead research is not a qualified pipeline, and no agent promises a revenue outcome. Voice, family, health, financial, hiring, and legal tasks have extra limits encoded in their prompts.

External, approval-required, and potentially billable operations are gated in the runtime. Approval-required tools cannot be invoked through MCP `call_tool`, imported MCP tools always ask before each invocation, and pending approvals are resolved in the authenticated app. Unattended automations reject approval-required direct tools and never approve an agent's pending action. The append-only action log records action names, status, timestamps, and optional run/thread IDs without retaining full arguments or private outputs.

## Time-audit exercise

Use the **Time audit** tab to manually record one row per 30-minute block: start time, activity, energy from 1–10, estimated dollar value, and any complaint or friction. The dashboard aggregates the latest 48 hours; it does not monitor the device or infer missing entries. The Business Idea Finder can analyze those rows and public research when asked, but ideas and revenue figures remain hypotheses until independently validated.

The morning briefing, daily content, and revenue templates are installed disabled. Cron is five-field UTC, so convert the desired local time yourself before enabling a schedule. Calendar, inbox, revenue pipeline, and publication details remain blank unless the user supplies them or a real connector is implemented and explicitly configured.
