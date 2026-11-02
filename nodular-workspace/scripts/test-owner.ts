// Policy checks for app-owner tool auto-approval. Env is read on each call.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ok = (c: boolean, m: string) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }

delete process.env.OWNER_USER_IDS
delete process.env.OWNER_USER_ID
delete process.env.MCP_ADMIN_USER
delete process.env.OWNER_EMAILS
delete process.env.CLERK_SECRET_KEY

const { autoApproveOwnerTools, isAppOwner, ownerUserIds, ownerEmails, matchesVerifiedOwnerEmail, verifiedEmailsFromClaims, setClerkEmailLoaderForTests } = await import('../server/agent/owner.ts')

ok(!isAppOwner(null) && !isAppOwner('') && !isAppOwner('local') && !isAppOwner('user_someone_else'), 'blank env: nobody is an owner, including open-mode local')
ok(!autoApproveOwnerTools('local') && !autoApproveOwnerTools('user_other') && !autoApproveOwnerTools(null, { asOwner: true }), 'blank env does not auto-approve')
ok(autoApproveOwnerTools('local', { asOwner: true }) && !autoApproveOwnerTools('local', { asOwner: true, unattended: true }), 'MCP admin token trusts that run only; unattended still gated')

process.env.OWNER_USER_IDS = 'user_owner_test, user_second'
ok(isAppOwner('user_owner_test') && isAppOwner('user_second') && !isAppOwner('local') && !isAppOwner('user_other'), 'OWNER_USER_IDS matches listed ids only')
ok(autoApproveOwnerTools('user_owner_test') && !autoApproveOwnerTools('user_other'), 'listed owner auto-approved; other user gated')
ok(!autoApproveOwnerTools('user_owner_test', { unattended: true }), 'owner automation does not auto-approve')

delete process.env.OWNER_USER_IDS
process.env.OWNER_USER_ID = 'user_single'
ok(isAppOwner('user_single') && !isAppOwner('local'), 'OWNER_USER_ID is a single-id alias')

delete process.env.OWNER_USER_ID
process.env.MCP_ADMIN_USER = 'user_admin_env'
ok(isAppOwner('user_admin_env') && !isAppOwner('local'), 'explicit MCP_ADMIN_USER is an owner; implicit local is not')

process.env.OWNER_USER_IDS = '  user_a\nuser_b,user_c  '
process.env.OWNER_USER_ID = 'user_b'
process.env.MCP_ADMIN_USER = 'user_d'
ok(ownerUserIds().slice().sort().join() === 'user_a,user_b,user_c,user_d', 'ids merge and trim: ' + ownerUserIds().join())
ok(!autoApproveOwnerTools('user_not_listed', { asOwner: false }), 'non-owner flag cannot self-approve')

delete process.env.OWNER_USER_IDS
delete process.env.OWNER_USER_ID
delete process.env.MCP_ADMIN_USER
process.env.OWNER_EMAILS = ' Owner@Example.com , second@example.com '
ok(ownerEmails().join() === 'owner@example.com,second@example.com', 'OWNER_EMAILS trims and lowercases')
ok(!autoApproveOwnerTools('user_email', { unattended: true }, true) && autoApproveOwnerTools('user_email', {}, true), 'verified email auto-approves unless the run is unattended')
ok(!(await matchesVerifiedOwnerEmail('local', { email: 'owner@example.com', email_verified: true })), 'open-mode local is never an email owner')
ok(!(await matchesVerifiedOwnerEmail('user_someone', { email: 'owner@example.com', email_verified: false })), 'unverified email claim refused')
ok(!(await matchesVerifiedOwnerEmail('user_someone', { email: 'owner@example.com' })), 'email claim without a verified flag refused')
ok(!(await matchesVerifiedOwnerEmail('user_someone', { email_addresses: [{ email_address: 'owner@example.com', verification: { status: 'unverified' } }] })), 'unverified address object refused')
ok(verifiedEmailsFromClaims({ email: 'owner@example.com', email_verified: false }).length === 0, 'unverified claim yields no address')
ok(await matchesVerifiedOwnerEmail('user_someone', { email_addresses: [{ email_address: 'Owner@Example.com', verification: { status: 'verified' } }] }), 'verified address object matches')

let lookups = 0
setClerkEmailLoaderForTests(async () => { lookups++; return [{ email: 'nope@example.com', verified: true }] })
ok(await matchesVerifiedOwnerEmail('user_claim', { email: 'owner@example.com', email_verified: true }) && lookups === 0, 'verified claim matches and does not call Clerk')

setClerkEmailLoaderForTests(async (id) => {
  lookups++
  if (id === 'user_api_owner') return [{ email: 'Owner@Example.com', verified: true }]
  if (id === 'user_unverified') return [{ email: 'owner@example.com', verified: false }]
  if (id === 'user_nomatch') return [{ email: 'other@example.com', verified: true }]
  if (id === 'user_missing') return []
  if (id === 'user_down') throw new Error('clerk down')
  return []
})
lookups = 0
ok(await matchesVerifiedOwnerEmail('user_api_owner', { email: 'owner@example.com', email_verified: false }), 'unverified claim falls through to a verified Clerk email')
ok(await matchesVerifiedOwnerEmail('user_api_owner', null) && lookups === 1, 'verified Clerk email is cached')
ok(!(await matchesVerifiedOwnerEmail('user_unverified', null)), 'unverified Clerk email refused')
ok(!(await matchesVerifiedOwnerEmail('user_nomatch', null)), 'verified non-matching email refused')
ok(!(await matchesVerifiedOwnerEmail('user_missing', null)), 'missing email refused')
ok(!(await matchesVerifiedOwnerEmail('user_down', null)), 'Clerk lookup failure refused')

delete process.env.OWNER_EMAILS
ok(!(await matchesVerifiedOwnerEmail('user_api_owner', { email: 'owner@example.com', email_verified: true })), 'blank OWNER_EMAILS grants nobody')

// Delegated inheritance goes through the real run loop. The Clerk user is not an id owner.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'nodular-email-'))
process.env.LLM_PROVIDERS = 'none'
process.env.OWNER_EMAILS = 'owner@example.com'
delete process.env.SUPABASE_URL
delete process.env.SUPABASE_SERVICE_KEY
const { initAgents, runAgentAndWait } = await import('../server/agent/runtime.ts')
const { createStore } = await import('../server/store.ts')
const { db } = await import('../server/agent/db.ts')
await initAgents(await createStore())
setClerkEmailLoaderForTests(async (id) => {
  if (id === 'user_verified_owner') return [{ email: 'owner@example.com', verified: true }]
  if (id === 'user_unverified_owner') return [{ email: 'owner@example.com', verified: false }]
  if (id === 'user_verified_other') return [{ email: 'other@example.com', verified: true }]
  return []
})

const flag = (runId: string) => (db.prepare('select auto_approve from runs where id=?').get(runId) as { auto_approve: number }).auto_approve
const verified = await runAgentAndWait('user_verified_owner', 'concierge', 'fetch https://example.com', undefined, 30_000)
ok(verified.status === 'done' && !verified.pendingApprovals.length && /Example Domain/.test(verified.reply) && flag(verified.runId) === 1, `verified email auto-approved (${verified.status})`)
const unverified = await runAgentAndWait('user_unverified_owner', 'concierge', 'fetch https://example.com', undefined, 30_000)
ok(unverified.status === 'awaiting_approval' && unverified.pendingApprovals[0]?.tool === 'http_get' && flag(unverified.runId) === 0, `unverified email still gated (${unverified.status})`)
const other = await runAgentAndWait('user_verified_other', 'concierge', 'fetch https://example.com', undefined, 30_000)
ok(other.status === 'awaiting_approval' && other.pendingApprovals[0]?.tool === 'http_get' && flag(other.runId) === 0, `non-matching email still gated (${other.status})`)
const missing = await runAgentAndWait('user_missing_email', 'concierge', 'fetch https://example.com', undefined, 30_000)
ok(missing.status === 'awaiting_approval' && flag(missing.runId) === 0, `missing email still gated (${missing.status})`)
const delegated = await runAgentAndWait('user_verified_owner', 'genesis', 'ask concierge to fetch https://example.org', undefined, 30_000)
const child = db.prepare("select r.auto_approve from runs r join threads t on t.id=r.thread_id where t.user_id=? and t.title like '[delegated]%'").get('user_verified_owner') as { auto_approve: number }
ok(delegated.status === 'done' && !delegated.pendingApprovals.length && /Example Domain/.test(delegated.reply) && !/cannot be used in a delegated run/.test(delegated.reply) && child?.auto_approve === 1, `delegated run inherits verified email (${delegated.status}) ${delegated.reply}`)
setClerkEmailLoaderForTests(null)

process.exit(process.exitCode || 0)
