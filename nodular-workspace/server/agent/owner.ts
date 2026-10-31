// App-owner identity for tool auto-approval.
// Ids come only from env (never from the request). Blank means nobody is an owner,
// so approval stays required — including the open-mode user id "local".

export type ApprovalTrust = { asOwner?: boolean; unattended?: boolean }

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

export function isAppOwner(userId: string | null | undefined): boolean {
  if (!userId) return false
  return ownerUserIds().includes(userId)
}

// True for an identified owner's own runs, and for a run authenticated with
// MCP_ADMIN_TOKEN (asOwner). Unattended automations stay gated even then.
// Delegated runs do not call this again: they copy the parent run's decision.
export function autoApproveOwnerTools(userId: string | null | undefined, trust: ApprovalTrust = {}): boolean {
  if (trust.unattended) return false
  if (!userId) return false
  if (trust.asOwner) return true
  return isAppOwner(userId)
}
