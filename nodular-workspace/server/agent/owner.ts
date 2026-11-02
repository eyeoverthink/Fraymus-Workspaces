// App-owner identity for tool auto-approval.
// Ids and emails come only from env (never from the request). Blank means nobody
// is an owner, so approval stays required — including the open-mode user id "local".
import { createHash } from 'node:crypto'
import { createClerkClient } from '@clerk/backend'

export type ApprovalTrust = { asOwner?: boolean; unattended?: boolean; sessionClaims?: Record<string, unknown> | null }
export type ClerkEmailRecord = { email: string; verified: boolean }

const EMAIL_TTL_MS = 60_000
const EMAIL_FAIL_TTL_MS = 15_000

const splitIds = (raw: string | undefined) => (raw || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)

export function ownerUserIds(): string[] {
  const ids = new Set<string>()
  // MCP_ADMIN_USER counts only when it is actually set. The admin token's
  // implicit fallback user id ("local") is not added here.
  for (const raw of [process.env.OWNER_USER_IDS, process.env.OWNER_USER_ID, process.env.MCP_ADMIN_USER]) {
    for (const id of splitIds(raw)) ids.add(id)
  }
  return [...ids]
}

export function ownerEmails(): string[] {
  const emails = new Set<string>()
  for (const email of splitIds(process.env.OWNER_EMAILS)) emails.add(email.toLowerCase())
  return [...emails]
}

export function isAppOwner(userId: string | null | undefined): boolean {
  if (!userId) return false
  return ownerUserIds().includes(userId)
}

// True for an identified owner's own runs, and for a run authenticated with
// MCP_ADMIN_TOKEN (asOwner). Unattended automations stay gated even then.
// Email matches are applied by the caller after matchesVerifiedOwnerEmail.
// Delegated runs do not call this again: they copy the parent run's decision.
export function autoApproveOwnerTools(userId: string | null | undefined, trust: ApprovalTrust = {}, ownerByEmail = false): boolean {
  if (trust.unattended) return false
  if (!userId) return false
  if (trust.asOwner || ownerByEmail) return true
  return isAppOwner(userId)
}

const normEmail = (s: unknown) => typeof s === 'string' ? s.trim().toLowerCase() : ''
const isEmail = (s: string) => s.includes('@') && !s.includes(' ')
const isVerifiedStatus = (v: unknown) => !!v && typeof v === 'object' && String((v as { status?: unknown }).status || '').toLowerCase() === 'verified'

// Default Clerk session tokens verified by authenticateClerk carry `sub` and do not
// carry email. A customized token can. An address counts only when that same token
// explicitly marks it verified. An unverified address is ignored, not trusted.
export function verifiedEmailsFromClaims(claims: Record<string, unknown> | null | undefined): string[] {
  if (!claims) return []
  const out = new Set<string>()
  for (const key of ['email_addresses', 'emailAddresses']) {
    const list = claims[key]
    if (!Array.isArray(list)) continue
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const row = item as Record<string, unknown>
      const email = normEmail(row.email_address || row.emailAddress || row.email)
      if (isEmail(email) && (isVerifiedStatus(row.verification) || row.verified === true)) out.add(email)
    }
  }
  const single = normEmail(claims.email ?? claims.email_address ?? claims.primary_email_address ?? claims.primaryEmailAddress)
  if (isEmail(single) && (claims.email_verified === true || claims.emailVerified === true)) out.add(single)
  return [...out]
}

type EmailLoader = (userId: string) => Promise<ClerkEmailRecord[]>
let emailLoader: EmailLoader | null = null
let clerkApi: { key: string; client: ReturnType<typeof createClerkClient> } | null = null
const emailCache = new Map<string, { exp: number; emails: string[] }>()

export function setClerkEmailLoaderForTests(loader: EmailLoader | null) {
  emailLoader = loader
  emailCache.clear()
}

export function clearOwnerEmailCache() {
  emailCache.clear()
}

function cacheKey(userId: string) {
  const secret = process.env.CLERK_SECRET_KEY || ''
  const tag = secret ? createHash('sha256').update(secret).digest('hex').slice(0, 12) : 'nosecret'
  return `${userId}:${tag}`
}

async function clerkEmailRecords(userId: string): Promise<ClerkEmailRecord[]> {
  const secretKey = process.env.CLERK_SECRET_KEY
  if (!secretKey) return []
  if (!clerkApi || clerkApi.key !== secretKey) clerkApi = { key: secretKey, client: createClerkClient({ secretKey }) }
  const user = await clerkApi.client.users.getUser(userId)
  return (user.emailAddresses || []).flatMap((e) => {
    const email = normEmail(e.emailAddress)
    if (!isEmail(email)) return []
    return [{ email, verified: String(e.verification?.status || '').toLowerCase() === 'verified' }]
  })
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('clerk email lookup timed out')), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}

// Verified addresses only. Failures cache briefly and never grant owner.
async function verifiedEmailsForUser(userId: string): Promise<string[]> {
  const key = cacheKey(userId)
  const hit = emailCache.get(key)
  if (hit && hit.exp > Date.now()) return hit.emails
  try {
    const rows = await withTimeout((emailLoader ?? clerkEmailRecords)(userId), 8_000)
    const emails = [...new Set(rows.flatMap((r) => r.verified && isEmail(normEmail(r.email)) ? [normEmail(r.email)] : []))]
    emailCache.set(key, { exp: Date.now() + EMAIL_TTL_MS, emails })
    return emails
  } catch (e: any) {
    console.warn(`clerk email lookup failed for ${userId}: ${e?.message || e}`)
    emailCache.set(key, { exp: Date.now() + EMAIL_FAIL_TTL_MS, emails: [] })
    return []
  }
}

// Signed-in Clerk user (id starts with user_). Match is case-insensitive.
// A verified email in the session token is enough. Otherwise load the user from
// the Clerk Backend API with CLERK_SECRET_KEY. Unverified and missing addresses never match.
export async function matchesVerifiedOwnerEmail(userId: string | null | undefined, claims?: Record<string, unknown> | null): Promise<boolean> {
  const allow = new Set(ownerEmails())
  if (!userId || !userId.startsWith('user_') || allow.size === 0) return false
  if (verifiedEmailsFromClaims(claims).some((e) => allow.has(e))) return true
  if (!emailLoader && !process.env.CLERK_SECRET_KEY) return false
  const emails = await verifiedEmailsForUser(userId)
  return emails.some((e) => allow.has(e))
}
